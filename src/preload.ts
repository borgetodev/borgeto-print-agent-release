import { contextBridge, ipcRenderer } from "electron";
import type { LocalAgentSettings, SystemPrinter } from "./types";

contextBridge.exposeInMainWorld("printAgent", {
  getSettings: (): Promise<{
    settings: LocalAgentSettings;
    computerName: string;
    activePrinterName: string;
  }> => ipcRenderer.invoke("settings:get"),

  saveSettings: (
    settings: LocalAgentSettings
  ): Promise<{ success: boolean; activePrinterName: string }> =>
    ipcRenderer.invoke("settings:save", settings),

  listPrinters: (): Promise<SystemPrinter[]> =>
    ipcRenderer.invoke("printers:list"),
});
