import "server-only";
import { getD1Database } from "../db";
import type {
  PurchaseAnalysisRow,
  PurchaseAnalysisSnapshot,
} from "./purchase-analysis";
import {
  canonicalMaterialCode,
  recalculatePurchaseRow,
} from "./purchase-analysis";

const EMPTY_SNAPSHOT: PurchaseAnalysisSnapshot = {
  rows: [],
  sourceFiles: [],
  periodLabel: "",
  updatedAt: "",
};

export async function readPurchaseAnalysis(): Promise<PurchaseAnalysisSnapshot> {
  const database = await getD1Database();
  const row = await database
    .prepare(
      "SELECT rows, source_files, period_label, updated_at FROM purchase_analysis WHERE id = 1",
    )
    .first<{
      rows: string;
      source_files: string;
      period_label: string;
      updated_at: string;
    }>();
  if (!row) return EMPTY_SNAPSHOT;
  try {
    return {
      rows: validateRows(JSON.parse(row.rows)),
      sourceFiles: validateStrings(JSON.parse(row.source_files)),
      periodLabel: row.period_label || "",
      updatedAt: row.updated_at || "",
    };
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

export async function writePurchaseAnalysis(
  snapshot: Omit<PurchaseAnalysisSnapshot, "updatedAt">,
): Promise<PurchaseAnalysisSnapshot> {
  const database = await getD1Database();
  const saved: PurchaseAnalysisSnapshot = {
    rows: validateRows(snapshot.rows),
    sourceFiles: validateStrings(snapshot.sourceFiles),
    periodLabel: String(snapshot.periodLabel || "").slice(0, 240),
    updatedAt: new Date().toISOString(),
  };
  await database
    .prepare(
      `INSERT INTO purchase_analysis
        (id, rows, source_files, period_label, updated_at)
       VALUES (1, ?1, ?2, ?3, ?4)
       ON CONFLICT(id) DO UPDATE SET
         rows = excluded.rows,
         source_files = excluded.source_files,
         period_label = excluded.period_label,
         updated_at = excluded.updated_at`,
    )
    .bind(
      JSON.stringify(saved.rows),
      JSON.stringify(saved.sourceFiles),
      saved.periodLabel,
      saved.updatedAt,
    )
    .run();
  return saved;
}

function validateRows(value: unknown): PurchaseAnalysisRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): PurchaseAnalysisRow | null => {
      if (!item || typeof item !== "object") return null;
      const row = item as Partial<PurchaseAnalysisRow>;
      const materialCode = canonicalMaterialCode(row.materialCode);
      if (!materialCode) return null;
      return recalculatePurchaseRow({
        materialCode,
        materialName: String(row.materialName || "Sin descripción").slice(
          0,
          240,
        ),
        calculatedNeed: number(row.calculatedNeed),
        confirmedNeed: number(row.confirmedNeed),
        stock: number(row.stock),
        pendingDetected: number(row.pendingDetected),
        confirmedPending: number(row.confirmedPending),
        exactPurchase: 0,
        roundedPurchase: 0,
      });
    })
    .filter((row): row is PurchaseAnalysisRow => Boolean(row))
    .slice(0, 20_000);
}

function validateStrings(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).slice(0, 240)).slice(0, 20)
    : [];
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}
