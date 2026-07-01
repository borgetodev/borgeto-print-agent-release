export type PrintPlatform = "yemeksepeti" | "trendyol" | "getir" | "other";

export interface ParsedOrderItem {
  name: string;
  quantity?: number;
  price?: number;
}

export interface ParsedPrintOrder {
  platform: PrintPlatform;
  customerName?: string;
  customerPhone?: string;
  address?: string;
  products: ParsedOrderItem[];
  orderContent: string;
  externalOrderId?: string;
  total?: number;
}

export interface PrintAgentRecord {
  platform: PrintPlatform;
  customerName?: string;
  customerPhone?: string;
  address?: string;
  products: ParsedOrderItem[];
  orderContent: string;
  externalOrderId?: string;
  total?: number;
  companyId?: string;
  computerName: string;
  printerName?: string;
  spoolFile?: string;
  jobId?: number;
  rawText: string;
  isPlatformOrder: boolean;
  status: "new";
  capturedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentConfig {
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
    databaseURL?: string;
    useRealtimeDb: boolean;
  };
  printerName?: string;
  spoolDir: string;
  pollIntervalMs: number;
  dedupTtlMs: number;
}

export interface LocalAgentSettings {
  companyId: string;
  printerName: string;
}

export interface SpoolJobEvent {
  jobId?: number;
  printerName: string;
  spoolFile?: string;
  rawText: string;
}

export interface SystemPrinter {
  name: string;
  isDefault: boolean;
}
