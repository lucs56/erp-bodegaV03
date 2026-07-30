export const PURCHASE_ANALYSIS_COLUMNS = [
  "INSUMO",
  "NECESIDAD CALCULADA",
  "NECESIDAD CONFIRMADA",
  "STOCK",
  "PENDIENTE DETECTADO",
  "PENDIENTE CONFIRMADO",
  "COMPRA EXACTA",
  "COMPRA REDONDEADA",
] as const;

export type PurchaseAnalysisRow = {
  materialCode: string;
  materialName: string;
  calculatedNeed: number;
  confirmedNeed: number;
  stock: number;
  pendingDetected: number;
  confirmedPending: number;
  exactPurchase: number;
  roundedPurchase: number;
};

export type PurchaseAnalysisSnapshot = {
  rows: PurchaseAnalysisRow[];
  sourceFiles: string[];
  periodLabel: string;
  updatedAt: string;
};

export function purchaseAnalysisTableRows(rows: PurchaseAnalysisRow[]) {
  return [
    [...PURCHASE_ANALYSIS_COLUMNS],
    ...rows.map((row) => [
      `${row.materialCode} - ${row.materialName}`.trim(),
      row.calculatedNeed,
      row.confirmedNeed,
      row.stock,
      row.pendingDetected,
      row.confirmedPending,
      row.exactPurchase,
      row.roundedPurchase,
    ]),
  ];
}

export type PurchaseWorkbookSheet = {
  name: string;
  rows: Record<string, unknown>[];
};

export type PurchaseStockItem = {
  materialCode: string;
  materialName: string;
  category: string;
  quantity: number;
  unit: string;
  depots?: Record<string, number>;
};

type PartialMaterial = {
  materialCode: string;
  materialName: string;
  category?: string;
  unit?: string;
  quantity?: number;
  calculatedNeed?: number;
  confirmedNeed?: number;
  stock?: number;
  depots?: Record<string, number>;
  pendingDetected?: number;
  pendingEligible?: number;
  confirmedPending?: number;
};

const MONTH_HEADERS = [
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

const MATERIAL_COLUMNS: Array<{
  aliases: string[];
  category: string;
  perCase: boolean;
}> = [
  { aliases: ["botella"], category: "Botellas", perCase: false },
  {
    aliases: ["tapon", "cierre", "tapon sc"],
    category: "Tapones",
    perCase: false,
  },
  {
    aliases: ["caps tapa", "capsula tapa", "capsula", "tapa"],
    category: "Cápsulas y tapas",
    perCase: false,
  },
  { aliases: ["cajas", "caja"], category: "Cajas", perCase: true },
  {
    aliases: ["etq", "etiqueta"],
    category: "Etiquetas",
    perCase: false,
  },
  {
    aliases: ["ceq", "contraetiqueta"],
    category: "Contraetiquetas",
    perCase: false,
  },
];

export function parseLocalizedNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const raw = value.trim();
  if (!raw || raw === "-" || raw.toLocaleUpperCase("es") === "N/A") return 0;
  const negative = /^\(.*\)$/.test(raw) || raw.startsWith("-");
  let clean = raw
    .replace(/[()]/g, "")
    .replace(/[^\d,.-]/g, "")
    .replace(/^-/, "");
  if (!clean) return 0;

  const grouped = /^\d{1,3}([.,]\d{3})+$/.test(clean);
  if (grouped) clean = clean.replace(/[.,]/g, "");
  else if (clean.includes(",") && clean.includes(".")) {
    const comma = clean.lastIndexOf(",");
    const dot = clean.lastIndexOf(".");
    const decimal = comma > dot ? "," : ".";
    const thousands = decimal === "," ? /\./g : /,/g;
    clean = clean.replace(thousands, "").replace(decimal, ".");
  } else if (clean.includes(",")) {
    clean = clean.replace(/\./g, "").replace(",", ".");
  } else {
    const dots = clean.match(/\./g)?.length ?? 0;
    if (dots > 1) clean = clean.replace(/\./g, "");
  }

  const parsed = Number(clean);
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : 0;
}

export function canonicalMaterialCode(value: unknown): string {
  const raw = String(value ?? "")
    .trim()
    .toLocaleUpperCase("es")
    .replace(/\s+/g, "");
  if (!raw || raw === "-" || raw === "N/A" || raw === "NA") return "";
  if (
    raw === "30354" ||
    raw === "30354A" ||
    (raw.includes("30354") && raw.includes("30354A"))
  )
    return "30354A";
  return raw;
}

export function calculatePurchase(
  confirmedNeed: number,
  stock: number,
  confirmedPending: number,
) {
  const exactPurchase = roundOperationalNumber(
    Math.max(
      0,
      cleanNumber(confirmedNeed) -
        cleanNumber(stock) -
        cleanNumber(confirmedPending),
    ),
  );
  return {
    exactPurchase,
    roundedPurchase:
      exactPurchase > 0 ? Math.ceil(exactPurchase / 1000) * 1000 : 0,
  };
}

function roundOperationalNumber(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function recalculatePurchaseRow(
  row: PurchaseAnalysisRow,
): PurchaseAnalysisRow {
  return {
    ...row,
    confirmedNeed: cleanNumber(row.confirmedNeed),
    stock: cleanNumber(row.stock),
    confirmedPending: cleanNumber(row.confirmedPending),
    ...calculatePurchase(row.confirmedNeed, row.stock, row.confirmedPending),
  };
}

export function parsePurchaseWorkbook(
  sheets: PurchaseWorkbookSheet[],
  currentStock: PurchaseStockItem[] = [],
): {
  rows: PurchaseAnalysisRow[];
  stockItems: PurchaseStockItem[];
  periodLabel: string;
  diagnostics: string[];
} {
  const diagnostics: string[] = [];
  const estimate = new Map<string, PartialMaterial>();
  const analysis = new Map<string, PartialMaterial>();
  const pending = new Map<string, PartialMaterial>();
  const importedStock = new Map<string, PartialMaterial>();
  const periodNames = new Set<string>();
  const planningEnd = detectPlanningEnd(sheets);

  for (const sheet of sheets) {
    const sheetName = normalizeText(sheet.name);
    if (MONTH_HEADERS.some((month) => sheetName.includes(month)))
      periodNames.add(sheet.name.trim());

    if (sheetName.includes("analisis")) {
      for (const row of sheet.rows)
        mergeMaterial(analysis, parseAnalysisRow(row));
      continue;
    }
    if (sheetName.includes("pendient")) {
      for (const row of sheet.rows)
        mergeMaterial(pending, parsePendingRow(row, planningEnd));
      continue;
    }
    if (
      sheetName.includes("stock") ||
      sheetName.includes("existencia") ||
      sheetName.includes("inventario")
    ) {
      for (const row of sheet.rows)
        mergeMaterial(importedStock, parseStockRow(row));
      continue;
    }
    if (
      sheetName.includes("estim") ||
      sheetName.includes("plan") ||
      sheetName.includes("proyeccion")
    ) {
      for (const row of sheet.rows) {
        const direct = parseEstimateMaterialRow(row);
        if (direct) mergeMaterial(estimate, direct);
        else
          for (const item of parseEstimatedProductRow(row))
            mergeMaterial(estimate, item);
      }
    }
  }

  const existingStock = new Map<string, PartialMaterial>();
  for (const item of currentStock)
    mergeMaterial(existingStock, {
      materialCode: canonicalMaterialCode(item.materialCode),
      materialName: item.materialName,
      category: item.category,
      unit: item.unit,
      stock: item.quantity,
      depots: item.depots,
    });

  const codes = new Set([
    ...estimate.keys(),
    ...analysis.keys(),
    ...pending.keys(),
    ...importedStock.keys(),
  ]);
  const rows = [...codes]
    .map((materialCode): PurchaseAnalysisRow | null => {
      const estimateItem = estimate.get(materialCode);
      const analysisItem = analysis.get(materialCode);
      const pendingItem = pending.get(materialCode);
      const stockItem =
        importedStock.get(materialCode) ?? existingStock.get(materialCode);

      const calculatedNeed = cleanNumber(
        estimateItem?.calculatedNeed ??
          estimateItem?.quantity ??
          analysisItem?.calculatedNeed ??
          0,
      );
      const confirmedNeed = cleanNumber(
        analysisItem?.confirmedNeed ??
          analysisItem?.calculatedNeed ??
          calculatedNeed,
      );
      const stock = cleanNumber(
        stockItem?.stock ?? analysisItem?.stock ?? 0,
      );
      const pendingDetected = cleanNumber(
        pendingItem?.pendingDetected ??
          pendingItem?.quantity ??
          analysisItem?.pendingDetected ??
          0,
      );
      const confirmedPending = cleanNumber(
        analysisItem?.confirmedPending ??
          pendingItem?.pendingEligible ??
          pendingDetected,
      );
      if (
        calculatedNeed <= 0 &&
        confirmedNeed <= 0 &&
        pendingDetected <= 0
      )
        return null;

      const materialName =
        analysisItem?.materialName ||
        stockItem?.materialName ||
        pendingItem?.materialName ||
        estimateItem?.materialName ||
        "Sin descripción";
      return recalculatePurchaseRow({
        materialCode,
        materialName,
        calculatedNeed,
        confirmedNeed,
        stock,
        pendingDetected,
        confirmedPending,
        exactPurchase: 0,
        roundedPurchase: 0,
      });
    })
    .filter((row): row is PurchaseAnalysisRow => Boolean(row))
    .sort((left, right) =>
      left.materialCode.localeCompare(right.materialCode, "es", {
        numeric: true,
      }),
    );

  const stockItems = [...importedStock.values()]
    .filter((item) => item.materialCode)
    .map((item) => ({
      materialCode: item.materialCode,
      materialName: item.materialName || "Sin descripción",
      category: item.category || "Otros",
      quantity: cleanNumber(item.stock ?? item.quantity ?? 0),
      unit: item.unit || "unidad",
      depots: item.depots,
    }));

  if (!estimate.size && !analysis.size)
    diagnostics.push(
      "No se encontró una hoja ESTIMADO ni una hoja ANALISIS con necesidades.",
    );
  if (!importedStock.size && !currentStock.length)
    diagnostics.push("No se encontró stock para cruzar con la necesidad.");
  if (!pending.size && !analysis.size)
    diagnostics.push("No se encontró una hoja PENDIENTE.");
  const latePendingMaterials = [...pending.values()].filter(
    (item) =>
      cleanNumber(item.pendingDetected ?? 0) >
      cleanNumber(item.pendingEligible ?? item.pendingDetected ?? 0),
  ).length;
  if (latePendingMaterials)
    diagnostics.push(
      `${latePendingMaterials} insumos tienen entregas posteriores al período y no se descontaron de la compra.`,
    );

  return {
    rows,
    stockItems,
    periodLabel:
      [...periodNames].join(" · ") ||
      sheets
        .map((sheet) => sheet.name)
        .filter((name) => /20\d{2}/.test(name))
        .join(" · "),
    diagnostics,
  };
}

export function mergeSavedConfirmations(
  importedRows: PurchaseAnalysisRow[],
  savedRows: PurchaseAnalysisRow[],
) {
  const saved = new Map(
    savedRows.map((row) => [canonicalMaterialCode(row.materialCode), row]),
  );
  return importedRows.map((row) => {
    const previous = saved.get(canonicalMaterialCode(row.materialCode));
    return previous
      ? recalculatePurchaseRow({
          ...row,
          confirmedNeed: previous.confirmedNeed,
          confirmedPending: previous.confirmedPending,
        })
      : row;
  });
}

function parseAnalysisRow(row: Record<string, unknown>): PartialMaterial | null {
  const code = materialCodeFromRow(row);
  if (!code) return null;
  return {
    materialCode: code,
    materialName: materialNameFromRow(row),
    calculatedNeed: numericValue(row, [
      "necesidad calculada",
      "necesidad total",
      "requerimiento",
      "necesidad",
    ]),
    confirmedNeed: optionalNumericValue(row, [
      "necesidad confirmada",
      "necesidad ajustada",
      "necesidad analisis",
    ]),
    stock: optionalNumericValue(row, [
      "stock",
      "existencia",
      "disponible",
    ]),
    pendingDetected: optionalNumericValue(row, [
      "pendiente detectado",
      "pendiente",
      "por llegar",
    ]),
    confirmedPending: optionalNumericValue(row, [
      "pendiente confirmado",
      "pendiente ajustado",
      "pendiente analisis",
    ]),
  };
}

function parsePendingRow(
  row: Record<string, unknown>,
  planningEnd: Date | null,
): PartialMaterial | null {
  const code = materialCodeFromRow(row);
  if (!code) return null;
  const quantity = numericValue(row, [
    "pendiente confirmado",
    "cantidad pendiente",
    "pendiente",
    "por recibir",
    "cantidad",
    "saldo",
  ]);
  const deliveryDate = dateValue(row, [
    "fecha entrega",
    "fecha prevista",
    "fecha estimada",
    "fecha arribo",
    "fecha prometida",
    "eta",
    "entrega",
    "arribo",
  ]);
  const arrivesWithinPeriod =
    !deliveryDate ||
    !planningEnd ||
    deliveryDate.getTime() <= planningEnd.getTime();
  return {
    materialCode: code,
    materialName: materialNameFromRow(row),
    quantity,
    pendingDetected: quantity,
    pendingEligible: arrivesWithinPeriod ? quantity : 0,
  };
}

function parseStockRow(row: Record<string, unknown>): PartialMaterial | null {
  const code = materialCodeFromRow(row);
  if (!code) return null;
  let quantity = numericValue(row, [
    "stock total",
    "stock",
    "existencia",
    "disponible",
    "cantidad",
    "saldo",
  ]);
  const depots: Record<string, number> = {};
  const namedDepot = String(
    Object.entries(row).find(([header]) =>
      ["deposito", "almacen"].includes(normalizeText(header)),
    )?.[1] ?? "",
  ).trim();
  if (namedDepot && quantity) depots[namedDepot.trim().toUpperCase()] = quantity;
  const depotTotal = Object.entries(row).reduce((total, [header, value]) => {
    const depot = depotCodeFromHeader(header);
    if (!depot) return total;
    const depotQuantity = parseLocalizedNumber(value);
    depots[depot] = depotQuantity;
    return total + depotQuantity;
  }, 0);
  if (!quantity) quantity = depotTotal;
  return {
    materialCode: code,
    materialName: materialNameFromRow(row),
    category: textValue(row, ["tipo", "categoria"]) || "Otros",
    unit: textValue(row, ["unidad", "um"]) || "unidad",
    quantity,
    stock: quantity,
    depots,
  };
}

function depotCodeFromHeader(header: string) {
  const normalized = normalizeText(header);
  if (/(^| )c18($| )|calidad/.test(normalized)) return "C18";
  if (/(^| )r18($| )/.test(normalized)) return "R18";
  if (/(^| )2ob($| )/.test(normalized)) return "2OB";
  if (/(^| )13($| )|produccion/.test(normalized)) return "13";
  if (
    normalized === "2" ||
    normalized === "deposito 2" ||
    normalized === "depo 2"
  )
    return "2";
  return "";
}

function parseEstimateMaterialRow(
  row: Record<string, unknown>,
): PartialMaterial | null {
  const code = materialCodeFromRow(row);
  if (!code) return null;
  const calculatedNeed = numericValue(row, [
    "necesidad calculada",
    "necesidad total",
    "requerimiento total",
    "requerimiento",
    "necesidad",
    "consumo total",
  ]);
  if (!calculatedNeed) return null;
  return {
    materialCode: code,
    materialName: materialNameFromRow(row),
    calculatedNeed,
  };
}

function parseEstimatedProductRow(
  row: Record<string, unknown>,
): PartialMaterial[] {
  let bottles = numericValue(row, [
    "botellas estimadas",
    "cantidad botellas",
    "botellas",
    "cantidad",
    "estimado",
  ]);
  if (!bottles) {
    bottles = Object.entries(row).reduce((total, [header, value]) => {
      const normalized = normalizeText(header);
      return MONTH_HEADERS.some((month) => normalized.includes(month))
        ? total + parseLocalizedNumber(value)
        : total;
    }, 0);
  }
  if (!bottles) return [];
  const cases = numericValue(row, ["cajas", "cantidad cajas"]);
  const unitsPerCase =
    numericValue(row, [
      "cj x",
      "unidades por caja",
      "botellas por caja",
      "presentacion",
    ]) || 1;
  const result: PartialMaterial[] = [];
  for (const column of MATERIAL_COLUMNS) {
    const rawCode = valueFor(row, column.aliases);
    const code = canonicalMaterialCode(rawCode);
    if (!code) continue;
    result.push({
      materialCode: code,
      materialName: textValue(row, [
        `${column.aliases[0]} descripcion`,
        "descripcion insumo",
      ]),
      category: column.category,
      unit: "unidad",
      calculatedNeed: column.perCase
        ? cases || Math.ceil(bottles / unitsPerCase)
        : bottles,
    });
  }
  return result;
}

function mergeMaterial(
  target: Map<string, PartialMaterial>,
  item: PartialMaterial | null,
) {
  if (!item?.materialCode) return;
  const code = canonicalMaterialCode(item.materialCode);
  if (!code) return;
  const previous = target.get(code);
  if (!previous) {
    target.set(code, { ...item, materialCode: code });
    return;
  }
  target.set(code, {
    ...previous,
    ...item,
    materialCode: code,
    materialName: item.materialName || previous.materialName,
    quantity:
      optionalSum(previous.quantity, item.quantity) ?? previous.quantity,
    calculatedNeed:
      optionalSum(previous.calculatedNeed, item.calculatedNeed) ??
      previous.calculatedNeed,
    stock: optionalSum(previous.stock, item.stock) ?? previous.stock,
    pendingDetected:
      optionalSum(previous.pendingDetected, item.pendingDetected) ??
      previous.pendingDetected,
    pendingEligible:
      optionalSum(previous.pendingEligible, item.pendingEligible) ??
      previous.pendingEligible,
    depots: mergeDepots(previous.depots, item.depots),
    confirmedNeed:
      item.confirmedNeed === undefined
        ? previous.confirmedNeed
        : item.confirmedNeed,
    confirmedPending:
      item.confirmedPending === undefined
        ? previous.confirmedPending
        : item.confirmedPending,
  });
}

function optionalSum(left?: number, right?: number) {
  if (left === undefined && right === undefined) return undefined;
  return cleanNumber(left ?? 0) + cleanNumber(right ?? 0);
}

function mergeDepots(
  left: Record<string, number> | undefined,
  right: Record<string, number> | undefined,
) {
  if (!left && !right) return undefined;
  const merged = { ...(left ?? {}) };
  for (const [depot, quantity] of Object.entries(right ?? {}))
    merged[depot] = cleanNumber(merged[depot] ?? 0) + cleanNumber(quantity);
  return merged;
}

function cleanNumber(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function materialCodeFromRow(row: Record<string, unknown>) {
  const direct = valueFor(row, [
    "codigo de insumo",
    "codigo insumo",
    "cod insumo",
    "material",
    "codigo",
    "insumo",
  ]);
  const raw = String(direct ?? "").trim();
  const token = raw.match(/^[A-Z0-9][A-Z0-9./_-]*/i)?.[0] ?? raw;
  return canonicalMaterialCode(token);
}

function materialNameFromRow(row: Record<string, unknown>) {
  return textValue(row, [
    "nombre del insumo",
    "nombre insumo",
    "descripcion",
    "detalle",
    "nombre",
  ]);
}

function textValue(row: Record<string, unknown>, aliases: string[]) {
  const value = valueFor(row, aliases);
  return String(value ?? "").trim();
}

function numericValue(row: Record<string, unknown>, aliases: string[]) {
  return parseLocalizedNumber(valueFor(row, aliases));
}

function optionalNumericValue(
  row: Record<string, unknown>,
  aliases: string[],
) {
  const value = valueFor(row, aliases);
  return value === undefined || value === null || String(value).trim() === ""
    ? undefined
    : parseLocalizedNumber(value);
}

function valueFor(row: Record<string, unknown>, aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeText);
  const entries = Object.entries(row);
  for (const alias of normalizedAliases) {
    const exact = entries.find(([header]) => normalizeText(header) === alias);
    if (exact) return exact[1];
  }
  for (const alias of normalizedAliases) {
    const partial = entries.find(([header]) =>
      normalizeText(header).includes(alias),
    );
    if (partial) return partial[1];
  }
  return undefined;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function detectPlanningEnd(sheets: PurchaseWorkbookSheet[]) {
  const dates: Date[] = [];
  for (const sheet of sheets) {
    const normalizedName = normalizeText(sheet.name);
    if (
      normalizedName.includes("pendient") ||
      normalizedName.includes("stock") ||
      normalizedName.includes("existencia") ||
      normalizedName.includes("inventario")
    )
      continue;

    const year = Number(normalizedName.match(/\b(20\d{2})\b/)?.[1] ?? 0);
    const months = MONTH_HEADERS.flatMap((month, index) =>
      normalizedName.includes(month) ? [index] : [],
    );
    if (year && months.length) {
      const lastMonth = Math.max(...months);
      dates.push(new Date(year, lastMonth + 1, 0, 23, 59, 59, 999));
    }

    for (const row of sheet.rows) {
      const date = dateValue(row, [
        "fecha necesidad",
        "fecha produccion",
        "fecha programada",
        "fecha",
      ]);
      if (date) dates.push(date);
    }
  }
  return dates.length
    ? new Date(Math.max(...dates.map((date) => date.getTime())))
    : null;
}

function dateValue(row: Record<string, unknown>, aliases: string[]) {
  return parseDate(valueFor(row, aliases));
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && value > 20_000 && value < 100_000) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + Math.floor(value) * 86_400_000);
  }
  const text = String(value ?? "").trim();
  if (!text) return null;
  const local = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](20\d{2})$/);
  if (local) {
    const date = new Date(
      Number(local[3]),
      Number(local[2]) - 1,
      Number(local[1]),
      23,
      59,
      59,
      999,
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
