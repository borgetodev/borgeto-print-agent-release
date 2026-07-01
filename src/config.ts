import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentConfig } from "./types";

function loadEnvFiles() {
  const candidates = [
    join(process.cwd(), ".env"),
    join(dirname(process.execPath), ".env"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      loadEnv({ path });
      break;
    }
  }

  loadEnv();
}

function readEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = (process.env[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function readPositiveInt(key: string, fallback: number): number {
  const raw = readEnv(key);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadAgentConfig(): AgentConfig {
  loadEnvFiles();

  const firebase = {
    apiKey: readEnv("FIREBASE_API_KEY", "VITE_apiKey", "VITE_API_KEY"),
    authDomain: readEnv(
      "FIREBASE_AUTH_DOMAIN",
      "VITE_authDomain",
      "VITE_AUTH_DOMAIN"
    ),
    projectId: readEnv(
      "FIREBASE_PROJECT_ID",
      "VITE_projectID",
      "VITE_PROJECT_ID"
    ),
    storageBucket: readEnv(
      "FIREBASE_STORAGE_BUCKET",
      "VITE_storageBucket",
      "VITE_STORAGE_BUCKET"
    ),
    messagingSenderId: readEnv(
      "FIREBASE_MESSAGING_SENDER_ID",
      "VITE_messagingSenderID",
      "VITE_MESSAGING_SENDER_ID"
    ),
    appId: readEnv("FIREBASE_APP_ID", "VITE_appId", "VITE_APP_ID"),
    databaseURL: readEnv("FIREBASE_DATABASE_URL") || undefined,
    useRealtimeDb: readEnv("FIREBASE_USE_REALTIME_DB").toLowerCase() === "true",
  };

  const missing = Object.entries({
    FIREBASE_API_KEY: firebase.apiKey,
    FIREBASE_AUTH_DOMAIN: firebase.authDomain,
    FIREBASE_PROJECT_ID: firebase.projectId,
    FIREBASE_STORAGE_BUCKET: firebase.storageBucket,
    FIREBASE_MESSAGING_SENDER_ID: firebase.messagingSenderId,
    FIREBASE_APP_ID: firebase.appId,
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Eksik Firebase ayarları: ${missing.join(", ")}. .env dosyasını kontrol edin.`
    );
  }

  return {
    firebase,
    spoolDir:
      readEnv("SPOOL_DIR") || "C:\\Windows\\System32\\spool\\PRINTERS",
    pollIntervalMs: readPositiveInt("POLL_INTERVAL_MS", 2000),
    dedupTtlMs: readPositiveInt("DEDUP_TTL_MS", 120_000),
  };
}
