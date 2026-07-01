import { app, Menu, Tray, nativeImage } from "electron";
import { join } from "node:path";
import { loadAgentConfig } from "./config";
import {
  buildGenericPrintOrder,
  parsePlatformOrder,
} from "./parser/orderParser";
import { openSettingsWindow, registerSettingsIpc } from "./settings/settingsWindow";
import { buildDedupKey, savePrintAgentOrder } from "./services/firebase";
import { SettingsStore } from "./services/settingsStore";
import { getWindowsComputerName } from "./services/systemInfo";
import {
  getDefaultPrinterName,
  listSystemPrinters,
  WindowsSpoolWatcher,
} from "./spool/spoolWatcher";
import type {
  AgentConfig,
  LocalAgentSettings,
  PrintAgentRecord,
  SpoolJobEvent,
} from "./types";

let tray: Tray | null = null;
let watcher: WindowsSpoolWatcher | null = null;
let config: AgentConfig;
let settingsStore: SettingsStore;
let localSettings: LocalAgentSettings = { companyId: "", printerName: "" };
let computerName = "";
const processedHashes = new Map<string, number>();

function log(message: string, detail?: unknown) {
  const stamp = new Date().toISOString();
  if (detail !== undefined) {
    console.log(`[${stamp}] ${message}`, detail);
    return;
  }
  console.log(`[${stamp}] ${message}`);
}

function getActivePrinterName(): string | undefined {
  return localSettings.printerName || config.printerName;
}

function shouldProcess(hash: string, ttlMs: number): boolean {
  const now = Date.now();
  const expiresAt = processedHashes.get(hash);
  if (expiresAt && expiresAt > now) {
    return false;
  }

  processedHashes.set(hash, now + ttlMs);
  for (const [key, expiry] of processedHashes.entries()) {
    if (expiry <= now) processedHashes.delete(key);
  }
  return true;
}

async function restartWatcher(forceRecreate = false): Promise<void> {
  const printerName = getActivePrinterName();
  config.printerName = printerName;

  if (watcher && !forceRecreate) {
    watcher.updatePrinterName(printerName);
    return;
  }

  if (watcher) {
    await watcher.stop();
    watcher = null;
  }

  watcher = new WindowsSpoolWatcher(config, handleSpoolEvent);
  await watcher.start();
}

async function applySettings(settings: LocalAgentSettings): Promise<string | undefined> {
  localSettings = {
    companyId: settings.companyId.trim(),
    printerName: settings.printerName.trim(),
  };
  settingsStore.save(localSettings);

  if (!localSettings.printerName) {
    localSettings.printerName = (await getDefaultPrinterName()) || "";
    settingsStore.save(localSettings);
  }

  config.printerName = localSettings.printerName || undefined;

  if (watcher) {
    await watcher.stop();
    watcher = null;
  }

  await restartWatcher(true);
  refreshTrayMenu();
  updateTrayTooltip();

  return getActivePrinterName();
}

async function handleSpoolEvent(event: SpoolJobEvent): Promise<void> {
  const dedupKey = buildDedupKey(event.rawText);
  if (!shouldProcess(dedupKey, config.dedupTtlMs)) {
    return;
  }

  const platformParsed = parsePlatformOrder(event.rawText);
  const parsed = platformParsed || buildGenericPrintOrder(event.rawText);
  const now = new Date();

  const record: PrintAgentRecord = {
    platform: parsed.platform,
    customerName: parsed.customerName,
    customerPhone: parsed.customerPhone,
    address: parsed.address,
    products: parsed.products,
    orderContent: parsed.orderContent,
    externalOrderId: parsed.externalOrderId,
    total: parsed.total,
    companyId: localSettings.companyId || undefined,
    computerName,
    printerName: event.printerName || getActivePrinterName(),
    spoolFile: event.spoolFile,
    jobId: event.jobId,
    rawText: parsed.orderContent,
    isPlatformOrder: parsed.platform !== "other",
    status: "new",
    capturedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const id = await savePrintAgentOrder(config, record);
    const label =
      record.platform === "other" ? "yazdırma" : record.platform;
    log(`Kayıt eklendi (${label}) → print_agent/${id}`);
    updateTrayTooltip(`Son: ${label} (${now.toLocaleTimeString("tr-TR")})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("Firebase kayıt hatası", message);
    updateTrayTooltip(`Hata: ${message}`);
  }
}

function buildTrayIcon() {
  const iconPath = join(__dirname, "..", "assets", "tray-icon.png");
  const image = nativeImage.createFromPath(iconPath);
  if (!image.isEmpty()) {
    return image;
  }
  return nativeImage.createEmpty();
}

function updateTrayTooltip(extra?: string) {
  const printer = getActivePrinterName() || "Yazıcı seçilmedi";
  const base = `Borgeto Print Agent — ${printer}`;
  tray?.setToolTip(extra ? `${base}\n${extra}` : base);
}

function refreshTrayMenu() {
  const printer = getActivePrinterName() || "Seçilmedi";
  const company = localSettings.companyId || "Kayıtlı değil";

  const contextMenu = Menu.buildFromTemplate([
    { label: "Borgeto Print Agent", enabled: false },
    { type: "separator" },
    { label: `Bilgisayar: ${computerName}`, enabled: false },
    { label: `Company ID: ${company}`, enabled: false },
    { label: `Yazıcı: ${printer}`, enabled: false },
    { type: "separator" },
    {
      label: "Ayarlar...",
      click: () => openSettingsWindow(),
    },
    { type: "separator" },
    {
      label: "Çıkış",
      click: () => app.quit(),
    },
  ]);

  tray?.setContextMenu(contextMenu);
}

function createTray() {
  tray = new Tray(buildTrayIcon());
  tray.on("double-click", () => openSettingsWindow());
  refreshTrayMenu();
  updateTrayTooltip("Çalışıyor");
}

async function bootstrap() {
  if (process.platform !== "win32") {
    console.error("Bu uygulama yalnızca Windows için tasarlanmıştır.");
    app.quit();
    return;
  }

  config = loadAgentConfig();
  settingsStore = new SettingsStore(app.getPath("userData"));
  localSettings = settingsStore.load();
  computerName = await getWindowsComputerName();

  registerSettingsIpc({
    getComputerName: () => computerName,
    getSettings: () => localSettings,
    getActivePrinterName,
    saveSettings: applySettings,
    listPrinters: listSystemPrinters,
  });

  if (!localSettings.printerName) {
    localSettings.printerName = (await getDefaultPrinterName()) || "";
    settingsStore.save(localSettings);
  }

  config.printerName = localSettings.printerName || undefined;
  await restartWatcher();

  createTray();

  log("Print agent aktif", {
    computerName,
    companyId: localSettings.companyId || "(ayarlanmadı)",
    printer: getActivePrinterName(),
    projectId: config.firebase.projectId,
    collection: "print_agent",
  });

  if (!localSettings.companyId) {
    openSettingsWindow();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    openSettingsWindow();
  });

  app.whenReady().then(() => {
    void bootstrap().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Başlatma hatası:", message);
      app.quit();
    });
  });

  app.on("window-all-closed", () => {
    // Headless: tray'de çalışmaya devam eder
  });

  app.on("before-quit", () => {
    void watcher?.stop();
  });
}
