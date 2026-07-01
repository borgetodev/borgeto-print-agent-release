import { hostname } from "node:os";
import { spawn } from "node:child_process";

export function getComputerName(): string {
  return hostname().trim() || "unknown";
}

export async function getWindowsComputerName(): Promise<string> {
  if (process.platform !== "win32") {
    return getComputerName();
  }

  const script = "$env:COMPUTERNAME";

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
      const name = stdout.trim();
      resolve(name || getComputerName());
    });
    proc.on("error", () => resolve(getComputerName()));
  });
}
