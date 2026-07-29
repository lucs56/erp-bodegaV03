import "server-only";

import { getD1Database } from "../db";
import {
  recalculatePurchaseSnapshot,
  type PurchaseAnalysisSnapshot,
} from "./purchase-analysis";

const STORAGE_KEY = "purchase_analysis_v1";

function validateSnapshot(value: unknown): PurchaseAnalysisSnapshot {
  if (!value || typeof value !== "object") {
    throw new Error("El análisis recibido no es válido.");
  }
  const candidate = value as Partial<PurchaseAnalysisSnapshot>;
  if (candidate.version !== 1 || !Array.isArray(candidate.items)) {
    throw new Error("La versión del análisis no es compatible.");
  }
  if (candidate.items.length > 10_000) {
    throw new Error("El análisis supera el máximo de 10.000 insumos.");
  }
  const rounding = Number(candidate.rounding);
  if (!Number.isFinite(rounding) || rounding < 1 || rounding > 1_000_000) {
    throw new Error("El redondeo configurado no es válido.");
  }
  for (const item of candidate.items) {
    if (!item?.materialCode || typeof item.materialCode !== "string") {
      throw new Error("Todos los insumos deben tener un código.");
    }
    for (const amount of [
      item.stock,
      item.pendingDetected,
      item.pendingConfirmed,
      item.calculatedNeed,
      item.confirmedNeed,
    ]) {
      if (!Number.isFinite(Number(amount)) || Number(amount) < 0) {
        throw new Error(
          `El insumo ${item.materialCode} contiene una cantidad inválida.`,
        );
      }
    }
  }
  return recalculatePurchaseSnapshot(candidate as PurchaseAnalysisSnapshot);
}

export async function readPurchaseAnalysis() {
  const database = await getD1Database();
  const row = await database
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .bind(STORAGE_KEY)
    .first<{ value: string }>();
  if (!row?.value) return null;
  try {
    return validateSnapshot(JSON.parse(row.value));
  } catch {
    return null;
  }
}

export async function writePurchaseAnalysis(value: unknown) {
  const snapshot = validateSnapshot(value);
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > 8_000_000) {
    throw new Error("El análisis supera el tamaño máximo permitido.");
  }
  const database = await getD1Database();
  const now = new Date().toISOString();
  await database
    .prepare(
      "INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
    )
    .bind(STORAGE_KEY, serialized, now)
    .run();
  return snapshot;
}

export async function deletePurchaseAnalysis() {
  const database = await getD1Database();
  await database
    .prepare("DELETE FROM app_settings WHERE key = ?")
    .bind(STORAGE_KEY)
    .run();
}

