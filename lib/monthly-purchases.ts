export type MonthlyEstimateMonth = {
  key: string;
  label: string;
  boxes: number;
};

export type MonthlyEstimate = {
  productCode: string;
  description: string;
  presentation: number;
  months: MonthlyEstimateMonth[];
  totalBoxes: number;
  totalBottles: number;
  materials: {
    bottle: string;
    cork: string;
    cap: string;
    capsule: string;
    box: string;
  };
};

export type MonthlyPurchaseAnalysis = {
  materialCode: string;
  description: string;
  stock: number;
  pending: number;
  necessity: number;
  balance: number;
  toBuy: number;
  note: string;
};

export type MonthlyPurchasePlanPayload = {
  fileName: string;
  periodLabel: string;
  estimates: MonthlyEstimate[];
  analysis: MonthlyPurchaseAnalysis[];
  sourceCounts: {
    stockRows: number;
    pendingRows: number;
  };
};

type WorkbookRows = Record<string, unknown[][]>;

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export function parseMonthlyPurchaseSheets(
  sheets: WorkbookRows,
  fileName = "Análisis mensual.xlsx",
): MonthlyPurchasePlanPayload {
  const estimateRows = findSheet(sheets, "ESTIMADO");
  const analysisRows = findSheet(sheets, "ANALISIS");
  if (!estimateRows)
    throw new Error("No se encontró la hoja ESTIMADO.");
  if (!analysisRows)
    throw new Error("No se encontró la hoja ANALISIS.");

  const estimates = parseEstimateRows(estimateRows);
  const analysis = parseAnalysisRows(analysisRows);
  if (!estimates.length)
    throw new Error("La hoja ESTIMADO no contiene productos reconocibles.");
  if (!analysis.length)
    throw new Error("La hoja ANALISIS no contiene insumos reconocibles.");

  const monthValues = estimates.flatMap((item) => item.months);
  return {
    fileName: clean(fileName) || "Análisis mensual.xlsx",
    periodLabel: buildPeriodLabel(monthValues),
    estimates,
    analysis,
    sourceCounts: {
      stockRows: countDataRows(findSheet(sheets, "STOCK")),
      pendingRows: countDataRows(findSheet(sheets, "PENDIENTE")),
    },
  };
}

export function normalizeMonthlyPurchasePlan(
  value: MonthlyPurchasePlanPayload,
): MonthlyPurchasePlanPayload {
  if (!value || !Array.isArray(value.estimates) || !Array.isArray(value.analysis))
    throw new Error("El análisis mensual está incompleto.");
  if (value.estimates.length > 2_000 || value.analysis.length > 20_000)
    throw new Error("El análisis mensual supera la capacidad admitida.");

  const estimates = value.estimates
    .map((item) => ({
      productCode: clean(item.productCode),
      description: clean(item.description),
      presentation: positive(item.presentation),
      months: Array.isArray(item.months)
        ? item.months.slice(0, 24).map((month) => ({
            key: clean(month.key),
            label: clean(month.label),
            boxes: nonNegative(month.boxes),
          }))
        : [],
      totalBoxes: nonNegative(item.totalBoxes),
      totalBottles: nonNegative(item.totalBottles),
      materials: {
        bottle: clean(item.materials?.bottle),
        cork: clean(item.materials?.cork),
        cap: clean(item.materials?.cap),
        capsule: clean(item.materials?.capsule),
        box: clean(item.materials?.box),
      },
    }))
    .filter((item) => item.productCode && item.description);

  const analysis = value.analysis
    .map((item) => {
      const stock = nonNegative(item.stock);
      const pending = nonNegative(item.pending);
      const necessity = nonNegative(item.necessity);
      const balance = stock + pending - necessity;
      return {
        materialCode: clean(item.materialCode),
        description: clean(item.description),
        stock,
        pending,
        necessity,
        balance,
        toBuy: Math.max(0, -balance),
        note: clean(item.note),
      };
    })
    .filter((item) => item.materialCode);

  if (!estimates.length || !analysis.length)
    throw new Error("El archivo no contiene datos mensuales válidos.");

  return {
    fileName: clean(value.fileName) || "Análisis mensual.xlsx",
    periodLabel: clean(value.periodLabel) || buildPeriodLabel(estimates.flatMap((item) => item.months)),
    estimates,
    analysis,
    sourceCounts: {
      stockRows: Math.max(0, Math.trunc(Number(value.sourceCounts?.stockRows) || 0)),
      pendingRows: Math.max(0, Math.trunc(Number(value.sourceCounts?.pendingRows) || 0)),
    },
  };
}

function parseEstimateRows(rows: unknown[][]): MonthlyEstimate[] {
  const principalHeader = rows.findIndex((row) => {
    const values = row.map(normalize);
    return values.includes("CODIGO") && values.includes("VARIEDAD") && values.includes("PRESENTACION");
  });
  const materialsHeader = rows.findIndex((row) => {
    const values = row.map(normalize);
    return values.some((value) => value.includes("TOTAL CAJA")) &&
      values.some((value) => value.includes("TOTAL BOTELLA"));
  });
  if (principalHeader < 0 || materialsHeader < 0)
    throw new Error("La hoja ESTIMADO no tiene los encabezados esperados.");

  const header = rows[principalHeader] ?? [];
  const secondary = rows[materialsHeader] ?? [];
  const codeIndex = findColumn(header, ["CODIGO"]);
  const descriptionIndex = findColumn(header, ["VARIEDAD", "DESCRIPCION"]);
  const presentationIndex = findColumn(header, ["PRESENTACION"]);
  const totalBoxesIndex = findColumn(secondary, ["TOTAL CAJA"]);
  const totalBottlesIndex = findColumn(secondary, ["TOTAL BOTELLA"]);
  const bottleIndex = findColumn(secondary, ["BOTELLA"]);
  const corkIndex = findColumn(secondary, ["TAPON"]);
  const capIndex = findColumn(secondary, ["TAPA"]);
  const capsuleIndex = findColumn(secondary, ["CAPSULA"]);
  const boxIndex = findColumn(secondary, ["CAJA"], [totalBoxesIndex]);

  const monthColumns = header
    .map((value, index) => ({ index, month: monthFromCell(value) }))
    .filter((entry): entry is { index: number; month: MonthlyEstimateMonth } => Boolean(entry.month));
  const start = Math.max(principalHeader, materialsHeader) + 1;

  return rows.slice(start).flatMap((row) => {
    const productCode = code(row[codeIndex]);
    const description = clean(row[descriptionIndex]);
    if (!productCode || !description) return [];
    const presentation = positive(row[presentationIndex]);
    const months = monthColumns.map(({ index, month }) => ({
      ...month,
      boxes: nonNegative(row[index]),
    }));
    const totalBoxes =
      totalBoxesIndex >= 0
        ? nonNegative(row[totalBoxesIndex])
        : months.reduce((sum, month) => sum + month.boxes, 0);
    const totalBottles =
      totalBottlesIndex >= 0
        ? nonNegative(row[totalBottlesIndex])
        : totalBoxes * presentation;
    return [{
      productCode,
      description,
      presentation,
      months,
      totalBoxes,
      totalBottles,
      materials: {
        bottle: code(row[bottleIndex]),
        cork: code(row[corkIndex]),
        cap: code(row[capIndex]),
        capsule: code(row[capsuleIndex]),
        box: code(row[boxIndex]),
      },
    }];
  });
}

function parseAnalysisRows(rows: unknown[][]): MonthlyPurchaseAnalysis[] {
  const headerIndex = rows.findIndex((row) => {
    const values = row.map(normalize);
    return values.includes("CODIGO") &&
      values.includes("STOCK") &&
      values.includes("PENDIENTE") &&
      values.includes("NECESIDAD");
  });
  if (headerIndex < 0)
    throw new Error("La hoja ANALISIS no tiene los encabezados esperados.");
  const header = rows[headerIndex] ?? [];
  const codeIndex = findColumn(header, ["CODIGO"]);
  const descriptionIndex = findColumn(header, ["DESCRIPCION"]);
  const stockIndex = findColumn(header, ["STOCK"]);
  const pendingIndex = findColumn(header, ["PENDIENTE"]);
  const necessityIndex = findColumn(header, ["NECESIDAD"]);
  const buyIndex = findColumn(header, ["A COMPRAR"]);

  return rows.slice(headerIndex + 1).flatMap((row) => {
    const materialCode = code(row[codeIndex]);
    if (!materialCode) return [];
    const stock = nonNegative(row[stockIndex]);
    const pending = nonNegative(row[pendingIndex]);
    const necessity = nonNegative(row[necessityIndex]);
    const balance = stock + pending - necessity;
    return [{
      materialCode,
      description: clean(row[descriptionIndex]),
      stock,
      pending,
      necessity,
      balance,
      toBuy: Math.max(0, -balance),
      note: buyIndex >= 0 ? clean(row[buyIndex + 1]) : "",
    }];
  });
}

function findSheet(sheets: WorkbookRows, expected: string) {
  const target = normalize(expected);
  const entry = Object.entries(sheets).find(([name]) => normalize(name).includes(target));
  return entry?.[1];
}

function findColumn(row: unknown[], names: string[], excluded: number | number[] = -1) {
  const targets = names.map(normalize);
  const excludedIndexes = new Set(Array.isArray(excluded) ? excluded : [excluded]);
  const exact = row.findIndex((value, index) => !excludedIndexes.has(index) &&
    targets.includes(normalize(value)));
  if (exact >= 0) return exact;
  return row.findIndex((value, index) => !excludedIndexes.has(index) &&
    targets.some((target) => normalize(value).includes(target)));
}

function monthFromCell(value: unknown): MonthlyEstimateMonth | null {
  let date: Date | null = null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) date = value;
  else if (typeof value === "number" && value > 30_000 && value < 80_000)
    date = new Date(Date.UTC(1899, 11, 30 + value));
  else {
    const text = clean(value);
    const parsed = text ? new Date(text) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) date = parsed;
  }
  if (!date) return null;
  const month = date.getUTCMonth();
  const year = date.getUTCFullYear();
  return {
    key: `${year}-${String(month + 1).padStart(2, "0")}`,
    label: `${capitalize(MONTHS[month])} ${year}`,
    boxes: 0,
  };
}

function buildPeriodLabel(months: MonthlyEstimateMonth[]) {
  const unique = [...new Map(months.filter((month) => month.key).map((month) => [month.key, month])).values()]
    .sort((left, right) => left.key.localeCompare(right.key));
  if (!unique.length) return "Período mensual";
  if (unique.length === 1) return unique[0].label;
  const first = unique[0];
  const last = unique[unique.length - 1];
  const firstYear = first.key.slice(0, 4);
  const lastYear = last.key.slice(0, 4);
  const firstMonth = first.label.replace(` ${firstYear}`, "");
  return firstYear === lastYear
    ? `${firstMonth} – ${last.label}`
    : `${first.label} – ${last.label}`;
}

function countDataRows(rows?: unknown[][]) {
  if (!rows) return 0;
  const firstPopulatedRow = rows.findIndex((row) => row.some((value) => clean(value)));
  if (firstPopulatedRow < 0) return 0;
  return rows
    .slice(firstPopulatedRow + 1)
    .filter((row) => row.some((value) => clean(value))).length;
}

function code(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value))
    return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");
  return clean(value);
}

function nonNegative(value: unknown) {
  const parsed = number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function positive(value: unknown) {
  const parsed = number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function number(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number(value);
  const compact = value.trim().replace(/\s/g, "");
  if (!compact) return 0;
  const normalized = compact.includes(",")
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact;
  return Number(normalized);
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
