import { BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import type { LocalAgentSettings } from "../types";

type SettingsContext = {
  getComputerName: () => string;
  getSettings: () => LocalAgentSettings;
  getActivePrinterName: () => string | undefined;
  saveSettings: (settings: LocalAgentSettings) => Promise<string | undefined>;
  listPrinters: () => Promise<
    Array<{ name: string; isDefault: boolean }>
  >;
};

let settingsWindow: BrowserWindow | null = null;

function getSettingsHtmlPath(): string {
  return join(__dirname, "..", "ui", "settings.html");
}

function getPreloadPath(): string {
  return join(__dirname, "..", "preload.js");
}

export function registerSettingsIpc(context: SettingsContext): void {
  ipcMain.handle("settings:get", () => ({
    settings: context.getSettings(),
    computerName: context.getComputerName(),
    activePrinterName: context.getActivePrinterName() || "",
  }));

  ipcMain.handle("settings:save", async (_event, settings: LocalAgentSettings) => {
    const activePrinterName = await context.saveSettings(settings);
    return {
      success: true,
      activePrinterName: activePrinterName || "",
    };
  });

  ipcMain.handle("printers:list", () => context.listPrinters());
}

export function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 460,
    height: 560,
    resizable: false,
    maximizable: false,
    minimizable: true,
    autoHideMenuBar: true,
    title: "Borgeto Print Agent Ayarları",
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void settingsWindow.loadFile(getSettingsHtmlPath());

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}
