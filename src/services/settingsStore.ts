import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LocalAgentSettings } from "../types";

const DEFAULT_SETTINGS: LocalAgentSettings = {
  companyId: "",
  printerName: "",
};

export class SettingsStore {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true });
    }
    this.filePath = join(userDataPath, "agent-settings.json");
  }

  load(): LocalAgentSettings {
    if (!existsSync(this.filePath)) {
      return { ...DEFAULT_SETTINGS };
    }

    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<LocalAgentSettings>;
      return {
        companyId: (parsed.companyId || "").trim(),
        printerName: (parsed.printerName || "").trim(),
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  save(settings: LocalAgentSettings): void {
    writeFileSync(this.filePath, JSON.stringify(settings, null, 2), "utf-8");
  }
}
