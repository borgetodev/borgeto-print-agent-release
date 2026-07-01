import { createHash } from "node:crypto";
import { initializeApp } from "firebase/app";
import {
  addDoc,
  collection,
  getFirestore,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { getDatabase, push, ref, set } from "firebase/database";
import type { AgentConfig, PrintAgentRecord } from "../types";

const COLLECTION_NAME = "print_agent";

let initialized = false;

export function initFirebase(config: AgentConfig["firebase"]) {
  if (initialized) return;

  initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
    databaseURL: config.databaseURL,
  });

  initialized = true;
}

function toFirestorePayload(record: PrintAgentRecord) {
  return {
    companyId: record.companyId ?? null,
    computerName: record.computerName,
    platform: record.platform,
    isPlatformOrder: record.isPlatformOrder,
    customerName: record.customerName ?? null,
    customerPhone: record.customerPhone ?? null,
    address: record.address ?? null,
    products: record.products,
    orderContent: record.orderContent,
    externalOrderId: record.externalOrderId ?? null,
    total: record.total ?? null,
    printerName: record.printerName ?? null,
    spoolFile: record.spoolFile ?? null,
    jobId: record.jobId ?? null,
    rawText: record.rawText,
    status: record.status,
    capturedAt: Timestamp.fromDate(record.capturedAt),
    createdAt: Timestamp.fromDate(record.createdAt),
    updatedAt: Timestamp.fromDate(record.updatedAt),
  };
}

export async function savePrintAgentOrder(
  config: AgentConfig,
  record: PrintAgentRecord
): Promise<string> {
  initFirebase(config.firebase);

  if (config.firebase.useRealtimeDb) {
    if (!config.firebase.databaseURL) {
      throw new Error(
        "Realtime Database için FIREBASE_DATABASE_URL tanımlanmalı."
      );
    }

    const db = getDatabase();
    const listRef = push(ref(db, COLLECTION_NAME));
    await set(listRef, {
      ...toFirestorePayload(record),
      capturedAt: record.capturedAt.toISOString(),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    });
    return listRef.key || "rtdb";
  }

  const db = getFirestore();
  const docRef = await addDoc(collection(db, COLLECTION_NAME), {
    ...toFirestorePayload(record),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return docRef.id;
}

export function buildDedupKey(rawText: string): string {
  return createHash("sha256").update(rawText).digest("hex");
}
