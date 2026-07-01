import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import chokidar, { type FSWatcher } from "chokidar";
import type { AgentConfig, SpoolJobEvent, SystemPrinter } from "../types";
import { extractReadableTextFromSpool } from "../parser/orderParser";

type PrintJobRow = {
  JobId: number;
  Document: string;
  PrinterName: string;
  Status: string;
};

export class WindowsSpoolWatcher {
  private watcher: FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly seenJobs = new Map<string, number>();
  private readonly seenFiles = new Map<string, number>();
  private running = false;

  constructor(
    private config: AgentConfig,
    private readonly onJobText: (event: SpoolJobEvent) => void | Promise<void>
  ) {}

  updatePrinterName(printerName?: string): void {
    this.config = { ...this.config, printerName };
  }

  async start(): Promise<void> {
    if (process.platform !== "win32") {
      throw new Error("Borgeto Print Agent yalnızca Windows üzerinde çalışır.");
    }

    if (this.running) return;
    this.running = true;

    this.watcher = chokidar.watch(this.config.spoolDir, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 400,
        pollInterval: 100,
      },
      depth: 0,
    });

    this.watcher.on("add", (filePath) => {
      void this.handleSpoolFile(filePath);
    });
    this.watcher.on("change", (filePath) => {
      void this.handleSpoolFile(filePath);
    });

    this.pollTimer = setInterval(() => {
      void this.pollPrintJobs();
    }, this.config.pollIntervalMs);

    await this.pollPrintJobs();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    await this.watcher?.close();
    this.watcher = null;
  }

  private remember(map: Map<string, number>, key: string): boolean {
    const now = Date.now();
    const expiresAt = map.get(key);
    if (expiresAt && expiresAt > now) {
      return false;
    }

    map.set(key, now + this.config.dedupTtlMs);

    for (const [existingKey, existingExpiry] of map.entries()) {
      if (existingExpiry <= now) {
        map.delete(existingKey);
      }
    }

    return true;
  }

  private async handleSpoolFile(filePath: string): Promise<void> {
    if (!filePath.toLowerCase().endsWith(".spl")) return;

    const fileKey = createHash("sha1").update(filePath).digest("hex");
    if (!this.remember(this.seenFiles, fileKey)) return;

    try {
      const buffer = await readFile(filePath);
      if (buffer.length < 32) return;

      const rawText = extractReadableTextFromSpool(buffer);
      if (!rawText || rawText.length < 20) return;

      await this.onJobText({
        printerName: this.config.printerName || "unknown",
        spoolFile: filePath,
        rawText,
      });
    } catch {
      // Dosya kilitli veya silinmiş olabilir
    }
  }

  private async pollPrintJobs(): Promise<void> {
    try {
      const jobs = await this.fetchPrintJobs(this.config.printerName);
      if (jobs.length === 0) return;

      for (const job of jobs) {
        const jobKey = `${job.PrinterName}:${job.JobId}`;
        if (!this.remember(this.seenJobs, jobKey)) continue;
      }

      await this.scanRecentSpoolFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[spool] poll failed:", message);
    }
  }

  private async scanRecentSpoolFiles(): Promise<void> {
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      `$dir = '${escapePowerShell(this.config.spoolDir)}'`,
      "Get-ChildItem -Path $dir -Filter '*.SPL' -File |",
      "Sort-Object LastWriteTime -Descending |",
      "Select-Object -First 8 -ExpandProperty FullName |",
      "ConvertTo-Json -Compress",
    ].join("\n");

    const files = await this.runPowerShellJson<string | string[]>(script);
    const list = !files ? [] : Array.isArray(files) ? files : [files];

    for (const filePath of list) {
      await this.handleSpoolFile(filePath);
    }
  }

  private fetchPrintJobs(printerName?: string): Promise<PrintJobRow[]> {
    const filter = printerName
      ? `| Where-Object { $_.Name -like '${escapePowerShell(printerName)},*' }`
      : "";

    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$jobs = Get-CimInstance Win32_PrintJob ${filter}`,
      "if ($null -eq $jobs) { return }",
      "if ($jobs -isnot [array]) { $jobs = @($jobs) }",
      "$jobs | ForEach-Object {",
      "  $printer = ([string]$_.Name).Split(',')[0].Trim()",
      "  [PSCustomObject]@{",
      "    JobId = [int]$_.JobId",
      "    Document = [string]$_.Document",
      "    PrinterName = $printer",
      "    Status = [string]$_.JobStatus",
      "  }",
      "} | ConvertTo-Json -Compress",
    ].join("\n");

    return this.runPowerShellJson<PrintJobRow | PrintJobRow[]>(script).then(
      (result) => {
        if (!result) return [];
        return Array.isArray(result) ? result : [result];
      }
    );
  }

  private runPowerShellJson<T>(script: string): Promise<T | null> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        { windowsHide: true }
      );

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      proc.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      proc.on("error", reject);
      proc.on("close", (code) => {
        const trimmed = stdout.trim();
        if (!trimmed) {
          if (code === 0) resolve(null);
          else reject(new Error(stderr || `PowerShell exited with ${code}`));
          return;
        }

        try {
          resolve(JSON.parse(trimmed) as T);
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error(`JSON parse failed: ${trimmed}`)
          );
        }
      });
    });
  }
}

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''");
}

export async function getDefaultPrinterName(): Promise<string | undefined> {
  const printers = await listSystemPrinters();
  return printers.find((printer) => printer.isDefault)?.name || printers[0]?.name;
}

export async function listSystemPrinters(): Promise<SystemPrinter[]> {
  if (process.platform !== "win32") return [];

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Get-CimInstance Win32_Printer | ForEach-Object {",
    "  [PSCustomObject]@{",
    "    name = [string]$_.Name",
    "    isDefault = [bool]$_.Default",
    "  }",
    "} | ConvertTo-Json -Compress",
  ].join("\n");

  return new Promise((resolve) => {
    const proc = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true }
    );

    let stdout = "";
    proc.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    proc.on("close", () => {
      const trimmed = stdout.trim();
      if (!trimmed) {
        resolve([]);
        return;
      }

      try {
        const parsed = JSON.parse(trimmed) as
          | SystemPrinter
          | SystemPrinter[];
        resolve(Array.isArray(parsed) ? parsed : [parsed]);
      } catch {
        resolve([]);
      }
    });
    proc.on("error", () => resolve([]));
  });
}
