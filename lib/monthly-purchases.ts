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

export type MonthlyPurchaseComparison = {
  stock: number;
  pending: number;
  necessity: number;
  balance: number;
  toBuy: number;
  shortageDifference: number;
};

export type MonthlyPurchaseAnalysis = {
  materialCode: string;
  description: string;
  stock: number;
  pending: number;
  necessity: number;
  balance: number;
  exactShortage: number;
  toBuy: number;
  note: string;
  comparison?: MonthlyPurchaseComparison;
};

export type MonthlyPurchaseSourceKind =
  | "estimate"
  | "stock"
  | "pending"
  | "analysis";

export type MonthlyPurchaseSourceSet = Partial<
  Record<MonthlyPurchaseSourceKind, unknown[][]>
>;

export type MonthlyPurchaseSourceFiles = Partial<
  Record<MonthlyPurchaseSourceKind, string>
>;

export type MonthlyPurchasePlanPayload = {
  fileName: string;
  periodLabel: string;
  estimates: MonthlyEstimate[];
  analysis: MonthlyPurchaseAnalysis[];
  roundingMultiple: number;
  warnings: string[];
  sourceFiles: MonthlyPurchaseSourceFiles;
  sourceCounts: {
    estimateRows: number;
    stockRows: number;
    pendingRows: number;
    analysisRows: number;
    negativePendingRows: number;
    duplicatePendingRows: number;
    overduePendingRows: number;
  };
};

type WorkbookRows = Record<string, unknown[][]>;

type ParseOptions = {
  fileName?: string;
  sourceFiles?: MonthlyPurchaseSourceFiles;
  roundingMultiple?: number;
  today?: Date;
};

type MaterialRequirement = {
  necessity: number;
  roles: Set<string>;
  products: Set<string>;
};

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

const DEFAULT_ROUNDING_MULTIPLE = 10_000;

/**
 * Detecta las fuentes por nombre de hoja o por sus encabezados. Esto permite
 * cargar un libro consolidado o archivos separados con nombres distintos.
 */
export function detectMonthlyPurchaseSources(
  sheets: WorkbookRows,
): MonthlyPurchaseSourceSet {
  return {
    estimate: findSourceSheet(sheets, "ESTIMADO", isEstimateSheet),
    stock: findSourceSheet(sheets, "STOCK", isStockSheet),
    pending: findSourceSheet(sheets, "PENDIENTE", isPendingSheet),
    analysis: findSourceSheet(sheets, "ANALISIS", isAnalysisSheet),
  };
}

/**
 * Entrada compatible con la versión anterior para libros consolidados.
 */
export function parseMonthlyPurchaseSheets(
  sheets: WorkbookRows,
  fileName = "Plan mensual.xlsx",
  roundingMultiple = DEFAULT_ROUNDING_MULTIPLE,
): MonthlyPurchasePlanPayload {
  const sources = detectMonthlyPurchaseSources(sheets);
  const sourceFiles = Object.fromEntries(
    (Object.keys(sources) as MonthlyPurchaseSourceKind[])
      .filter((kind) => Boolean(sources[kind]))
      .map((kind) => [kind, fileName]),
  ) as MonthlyPurchaseSourceFiles;
  return parseAutomaticMonthlyPurchaseSources(sources, {
    fileName,
    sourceFiles,
    roundingMultiple,
  });
}

/**
 * Calcula la compra sin depender de la hoja ANALISIS:
 * necesidad del ESTIMADO - STOCK - PENDIENTE.
 */
export function parseAutomaticMonthlyPurchaseSources(
  sources: MonthlyPurchaseSourceSet,
  options: ParseOptions = {},
): MonthlyPurchasePlanPayload {
  if (!sources.estimate)
    throw new Error("Falta cargar el archivo u hoja ESTIMADO.");
  if (!sources.stock)
    throw new Error("Falta cargar el archivo u hoja STOCK.");
  if (!sources.pending)
    throw new Error("Falta cargar el archivo u hoja PENDIENTE.");

  const estimates = parseEstimateRows(sources.estimate);
  if (!estimates.length)
    throw new Error("El ESTIMADO no contiene productos reconocibles.");

  const stock = parseStockRows(sources.stock);
  const pending = parsePendingRows(sources.pending, options.today ?? new Date());
  const manual = sources.analysis
    ? parseAnalysisRows(sources.analysis)
    : { items: new Map<string, ManualAnalysis>(), rowCount: 0 };
  const requirements = buildRequirements(estimates);
  const roundingMultiple = normalizeRounding(options.roundingMultiple);
  const warnings: string[] = [];

  if (pending.negativeRows)
    warnings.push(
      `${pending.negativeRows} pendientes negativos se tomaron como 0 y quedaron señalados para revisión.`,
    );
  if (pending.duplicateRows)
    warnings.push(
      `${pending.duplicateRows} filas pendientes duplicadas exactas fueron ignoradas.`,
    );
  if (pending.overdueRows)
    warnings.push(
      `${pending.overdueRows} entregas vencidas con saldo positivo siguen incluidas como pendientes.`,
    );
  if (stock.negativeRows)
    warnings.push(
      `${stock.negativeRows} existencias negativas se tomaron como 0 y quedaron señaladas para revisión.`,
    );

  const missingCoreMaterials = estimates.filter(
    (item) =>
      !item.materials.bottle ||
      (!item.materials.cork && !item.materials.cap) ||
      !item.materials.box,
  ).length;
  if (missingCoreMaterials)
    warnings.push(
      `${missingCoreMaterials} productos no tienen completo botella, cierre o caja en el ESTIMADO.`,
    );

  const analysis = [...requirements.entries()]
    .map(([materialCode, requirement]) => {
      const stockValue = stock.items.get(materialCode);
      const pendingValue = pending.items.get(materialCode);
      const manualValue = manual.items.get(materialCode);
      const stockQuantity = stockValue?.quantity ?? 0;
      const pendingQuantity = pendingValue?.quantity ?? 0;
      const necessity = requirement.necessity;
      const balance = stockQuantity + pendingQuantity - necessity;
      const exactShortage = Math.max(0, -balance);
      const comparison = manualValue
        ? {
            stock: manualValue.stock,
            pending: manualValue.pending,
            necessity: manualValue.necessity,
            balance: manualValue.balance,
            toBuy: manualValue.toBuy,
            shortageDifference: exactShortage - manualValue.toBuy,
          }
        : undefined;
      return {
        materialCode,
        description:
          stockValue?.description ||
          pendingValue?.description ||
          manualValue?.description ||
          `Insumo ${materialCode}`,
        stock: stockQuantity,
        pending: pendingQuantity,
        necessity,
        balance,
        exactShortage,
        toBuy: roundPurchase(exactShortage, roundingMultiple),
        note: `${[...requirement.roles].join(" + ")} · ${requirement.products.size} producto${requirement.products.size === 1 ? "" : "s"}`,
        comparison,
      };
    })
    .sort((left, right) =>
      left.materialCode.localeCompare(right.materialCode, "es", {
        numeric: true,
      }),
    );

  if (!analysis.length)
    throw new Error(
      "El ESTIMADO no contiene códigos de insumos para calcular la compra.",
    );

  if (sources.analysis) {
    const compared = analysis.filter((item) => item.comparison);
    const differences = compared.filter(
      (item) =>
        Math.abs(item.comparison?.shortageDifference ?? 0) > 0.01,
    ).length;
    const unmatched = [...manual.items.keys()].filter(
      (materialCode) => !requirements.has(materialCode),
    ).length;
    if (differences)
      warnings.push(
        `${differences} insumos difieren del ANALISIS anterior; revisá códigos, stock o pendientes.`,
      );
    if (unmatched)
      warnings.push(
        `${unmatched} códigos del ANALISIS anterior no aparecen en el ESTIMADO actual.`,
      );
  }

  const monthValues = estimates.flatMap((item) => item.months);
  const sourceFiles = options.sourceFiles ?? {};
  const fileNames = [...new Set(Object.values(sourceFiles).filter(Boolean))];
  return {
    fileName:
      clean(options.fileName) ||
      fileNames.join(" + ") ||
      "Plan mensual automático",
    periodLabel: buildPeriodLabel(monthValues),
    estimates,
    analysis,
    roundingMultiple,
    warnings,
    sourceFiles,
    sourceCounts: {
      estimateRows: estimates.length,
      stockRows: stock.rowCount,
      pendingRows: pending.rowCount,
      analysisRows: manual.rowCount,
      negativePendingRows: pending.negativeRows,
      duplicatePendingRows: pending.duplicateRows,
      overduePendingRows: pending.overdueRows,
    },
  };
}

/**
 * Revalida todo lo recibido por la API y recalcula saldo, faltante y redondeo.
 */
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
        bottle: code(item.materials?.bottle),
        cork: code(item.materials?.cork),
        cap: code(item.materials?.cap),
        capsule: code(item.materials?.capsule),
        box: code(item.materials?.box),
      },
    }))
    .filter((item) => item.productCode && item.description);

  const roundingMultiple = normalizeRounding(value.roundingMultiple);
  const analysis = value.analysis
    .map((item) => {
      const stock = nonNegative(item.stock);
      const pending = nonNegative(item.pending);
      const necessity = nonNegative(item.necessity);
      const balance = stock + pending - necessity;
      const exactShortage = Math.max(0, -balance);
      const comparison = item.comparison
        ? normalizeComparison(item.comparison, exactShortage)
        : undefined;
      return {
        materialCode: code(item.materialCode),
        description: clean(item.description),
        stock,
        pending,
        necessity,
        balance,
        exactShortage,
        toBuy: roundPurchase(exactShortage, roundingMultiple),
        note: clean(item.note),
        comparison,
      };
    })
    .filter((item) => item.materialCode);

  if (!estimates.length || !analysis.length)
    throw new Error("Los archivos no contienen datos mensuales válidos.");

  return {
    fileName: clean(value.fileName) || "Plan mensual automático",
    periodLabel:
      clean(value.periodLabel) ||
      buildPeriodLabel(estimates.flatMap((item) => item.months)),
    estimates,
    analysis,
    roundingMultiple,
    warnings: Array.isArray(value.warnings)
      ? value.warnings.slice(0, 100).map(clean).filter(Boolean)
      : [],
    sourceFiles: normalizeSourceFiles(value.sourceFiles),
    sourceCounts: normalizeSourceCounts(value.sourceCounts),
  };
}

function parseEstimateRows(rows: unknown[][]): MonthlyEstimate[] {
  const principalHeader = rows.findIndex((row) => {
    const values = row.map(canonical);
    return (
      values.includes("CODIGO") &&
      values.includes("VARIEDAD") &&
      values.includes("PRESENTACION")
    );
  });
  const materialsHeader = rows.findIndex((row) => {
    const values = row.map(canonical);
    return (
      values.some((value) => value === "TOTALCAJAS") &&
      values.some((value) => value === "TOTALBOTELLAS")
    );
  });
  if (principalHeader < 0 || materialsHeader < 0)
    throw new Error("El ESTIMADO no tiene los encabezados esperados.");

  const header = rows[principalHeader] ?? [];
  const secondary = rows[materialsHeader] ?? [];
  const codeIndex = findColumn(header, ["CODIGO"]);
  const descriptionIndex = findColumn(header, ["VARIEDAD", "DESCRIPCION"]);
  const presentationIndex = findColumn(header, ["PRESENTACION"]);
  const totalBoxesIndex = findColumn(secondary, ["TOTAL CAJAS", "TOTAL CAJA"]);
  const totalBottlesIndex = findColumn(secondary, [
    "TOTAL BOTELLAS",
    "TOTAL BOTELLA",
  ]);
  const bottleIndex = findColumn(secondary, ["BOTELLA"]);
  const corkIndex = findColumn(secondary, ["TAPON"]);
  const capIndex = findColumn(secondary, ["TAPA"]);
  const capsuleIndex = findColumn(secondary, ["CAPSULAS", "CAPSULA"]);
  const boxIndex = findColumn(
    secondary,
    ["CAJAS", "CAJA"],
    [totalBoxesIndex],
  );

  const monthColumns = header
    .map((value, index) => ({ index, month: monthFromCell(value) }))
    .filter(
      (
        entry,
      ): entry is { index: number; month: MonthlyEstimateMonth } =>
        Boolean(entry.month),
    );
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
    return [
      {
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
      },
    ];
  });
}

function buildRequirements(estimates: MonthlyEstimate[]) {
  const requirements = new Map<string, MaterialRequirement>();
  const add = (
    materialCode: string,
    quantity: number,
    role: string,
    product: string,
  ) => {
    if (!materialCode || quantity <= 0) return;
    const current = requirements.get(materialCode) ?? {
      necessity: 0,
      roles: new Set<string>(),
      products: new Set<string>(),
    };
    current.necessity += quantity;
    current.roles.add(role);
    current.products.add(product);
    requirements.set(materialCode, current);
  };
  for (const estimate of estimates) {
    const product = `${estimate.productCode} - ${estimate.description}`;
    add(estimate.materials.bottle, estimate.totalBottles, "Botella", product);
    add(estimate.materials.cork, estimate.totalBottles, "Tapón", product);
    add(estimate.materials.cap, estimate.totalBottles, "Tapa", product);
    add(estimate.materials.capsule, estimate.totalBottles, "Cápsula", product);
    add(estimate.materials.box, estimate.totalBoxes, "Caja", product);
  }
  return requirements;
}

function parseStockRows(rows: unknown[][]) {
  const headerIndex = rows.findIndex((row) => {
    const values = row.map(canonical);
    return (
      values.some((value) =>
        ["CODIGO", "CODIGODEPRODUCTO", "PRODUCTOC"].includes(value),
      ) &&
      values.includes("TOTAL")
    );
  });
  if (headerIndex < 0)
    throw new Error("El STOCK no tiene las columnas Código y TOTAL.");
  const header = rows[headerIndex] ?? [];
  const codeIndex = findColumn(header, [
    "CODIGO DE PRODUCTO",
    "CODIGO",
    "PRODUCTO/C",
  ]);
  const descriptionIndex = findColumn(header, [
    "DESCRIPCION",
    "DESCRIPCION PRODUCTO/C",
  ]);
  const totalIndex = findColumn(header, ["TOTAL"]);
  const items = new Map<string, { quantity: number; description: string }>();
  let rowCount = 0;
  let negativeRows = 0;

  for (const row of rows.slice(headerIndex + 1)) {
    const materialCode = code(row[codeIndex]);
    if (!materialCode) continue;
    const rawQuantity = numeric(row[totalIndex]);
    if (rawQuantity === null) continue;
    rowCount += 1;
    if (rawQuantity < 0) negativeRows += 1;
    const current = items.get(materialCode) ?? {
      quantity: 0,
      description: "",
    };
    current.quantity += Math.max(0, rawQuantity);
    current.description ||= clean(row[descriptionIndex]);
    items.set(materialCode, current);
  }
  if (!rowCount)
    throw new Error("El STOCK no contiene existencias reconocibles.");
  return { items, rowCount, negativeRows };
}

function parsePendingRows(rows: unknown[][], today: Date) {
  const headerIndex = rows.findIndex((row) => {
    const values = row.map(canonical);
    return (
      values.includes("NROOC") &&
      values.includes("PRODUCTOC") &&
      values.includes("CPORDE")
    );
  });
  if (headerIndex < 0)
    throw new Error(
      "El PENDIENTE no tiene las columnas Nro. OC, Producto/C y C.por D./E.",
    );
  const header = rows[headerIndex] ?? [];
  const orderIndex = findColumn(header, ["NRO. OC", "NRO OC"]);
  const codeIndex = findColumn(header, ["PRODUCTO/C", "CODIGO"]);
  const descriptionIndex = findColumn(header, [
    "DESCRIPCION PRODUCTO/C",
    "DESCRIPCION",
  ]);
  const deliveryIndex = findColumn(header, ["F.ENTR.", "F ENTR", "FECHA ENTREGA"]);
  const pendingIndex = findColumn(header, [
    "C.POR D./E.",
    "C POR D E",
    "CANTIDAD POR DESPACHAR",
    "CANTIDAD POR ENTREGAR",
  ]);
  const orderedIndex = findColumn(header, ["CANT. OC.", "CANT OC"]);
  const providerIndex = findColumn(header, ["PROVEEDOR"]);
  const items = new Map<string, { quantity: number; description: string }>();
  const exactRows = new Set<string>();
  const businessKeys = new Map<string, number>();
  const normalizedToday = new Date(today);
  normalizedToday.setHours(0, 0, 0, 0);
  let rowCount = 0;
  let negativeRows = 0;
  let duplicateRows = 0;
  let overdueRows = 0;

  for (const row of rows.slice(headerIndex + 1)) {
    const materialCode = code(row[codeIndex]);
    const orderNumber = clean(row[orderIndex]);
    const rawPending = numeric(row[pendingIndex]);
    if (!materialCode || rawPending === null) continue;
    const deliveryDate = parseDate(row[deliveryIndex]);
    const deliveryKey = deliveryDate
      ? localDateKey(deliveryDate)
      : clean(row[deliveryIndex]);
    const ordered = numeric(row[orderedIndex]) ?? 0;
    const provider = clean(row[providerIndex]);
    const businessKey = `${normalize(orderNumber)}|${normalize(materialCode)}|${deliveryKey}`;
    const exactKey = `${businessKey}|${rawPending}|${ordered}|${normalize(provider)}`;
    if (exactRows.has(exactKey)) {
      duplicateRows += 1;
      continue;
    }
    exactRows.add(exactKey);
    businessKeys.set(businessKey, (businessKeys.get(businessKey) ?? 0) + 1);
    rowCount += 1;
    if (rawPending < 0) negativeRows += 1;
    const quantity = Math.max(0, rawPending);
    if (quantity > 0 && deliveryDate && deliveryDate < normalizedToday)
      overdueRows += 1;
    const current = items.get(materialCode) ?? {
      quantity: 0,
      description: "",
    };
    current.quantity += quantity;
    current.description ||= clean(row[descriptionIndex]);
    items.set(materialCode, current);
  }
  if (!rowCount)
    throw new Error("El PENDIENTE no contiene filas reconocibles.");
  return {
    items,
    rowCount,
    negativeRows,
    duplicateRows,
    overdueRows,
    splitBusinessKeys: [...businessKeys.values()].filter((count) => count > 1)
      .length,
  };
}

type ManualAnalysis = {
  description: string;
  stock: number;
  pending: number;
  necessity: number;
  balance: number;
  toBuy: number;
};

function parseAnalysisRows(rows: unknown[][]) {
  const headerIndex = rows.findIndex((row) => {
    const values = row.map(canonical);
    return (
      values.includes("CODIGO") &&
      values.includes("STOCK") &&
      values.includes("PENDIENTE") &&
      values.includes("NECESIDAD")
    );
  });
  if (headerIndex < 0)
    throw new Error("El ANALISIS no tiene los encabezados esperados.");
  const header = rows[headerIndex] ?? [];
  const codeIndex = findColumn(header, ["CODIGO"]);
  const descriptionIndex = findColumn(header, ["DESCRIPCION"]);
  const stockIndex = findColumn(header, ["STOCK"]);
  const pendingIndex = findColumn(header, ["PENDIENTE"]);
  const necessityIndex = findColumn(header, ["NECESIDAD"]);
  const buyIndex = findColumn(header, ["A COMPRAR"]);
  const items = new Map<string, ManualAnalysis>();
  let rowCount = 0;

  for (const row of rows.slice(headerIndex + 1)) {
    const materialCode = code(row[codeIndex]);
    if (!materialCode) continue;
    const stock = nonNegative(row[stockIndex]);
    const pending = nonNegative(row[pendingIndex]);
    const necessity = nonNegative(row[necessityIndex]);
    const calculatedBalance = stock + pending - necessity;
    const suppliedBalance = buyIndex >= 0 ? numeric(row[buyIndex]) : null;
    const balance = suppliedBalance ?? calculatedBalance;
    items.set(materialCode, {
      description: clean(row[descriptionIndex]),
      stock,
      pending,
      necessity,
      balance,
      toBuy: Math.max(0, -balance),
    });
    rowCount += 1;
  }
  return { items, rowCount };
}

function findSourceSheet(
  sheets: WorkbookRows,
  expectedName: string,
  predicate: (rows: unknown[][]) => boolean,
) {
  const target = canonical(expectedName);
  const named = Object.entries(sheets).find(([name, rows]) =>
    canonical(name).includes(target) && predicate(rows),
  );
  if (named) return named[1];
  return Object.values(sheets).find(predicate);
}

function isEstimateSheet(rows: unknown[][]) {
  return rows.some((row) => {
    const values = row.map(canonical);
    return (
      values.includes("CODIGO") &&
      values.includes("VARIEDAD") &&
      values.includes("PRESENTACION")
    );
  });
}

function isStockSheet(rows: unknown[][]) {
  return rows.some((row) => {
    const values = row.map(canonical);
    return (
      values.includes("TOTAL") &&
      values.some((value) =>
        ["CODIGO", "CODIGODEPRODUCTO", "PRODUCTOC"].includes(value),
      )
    );
  });
}

function isPendingSheet(rows: unknown[][]) {
  return rows.some((row) => {
    const values = row.map(canonical);
    return (
      values.includes("NROOC") &&
      values.includes("PRODUCTOC") &&
      values.includes("CPORDE")
    );
  });
}

function isAnalysisSheet(rows: unknown[][]) {
  return rows.some((row) => {
    const values = row.map(canonical);
    return (
      values.includes("CODIGO") &&
      values.includes("STOCK") &&
      values.includes("PENDIENTE") &&
      values.includes("NECESIDAD")
    );
  });
}

function findColumn(
  row: unknown[],
  names: string[],
  excluded: number | number[] = -1,
) {
  const targets = names.map(canonical);
  const excludedIndexes = new Set(
    Array.isArray(excluded) ? excluded : [excluded],
  );
  const exact = row.findIndex(
    (value, index) =>
      !excludedIndexes.has(index) && targets.includes(canonical(value)),
  );
  if (exact >= 0) return exact;
  return row.findIndex(
    (value, index) =>
      !excludedIndexes.has(index) &&
      targets.some((target) => canonical(value).includes(target)),
  );
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
  const unique = [
    ...new Map(
      months
        .filter((month) => month.key)
        .map((month) => [month.key, month]),
    ).values(),
  ].sort((left, right) => left.key.localeCompare(right.key));
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

function normalizeComparison(
  comparison: MonthlyPurchaseComparison,
  exactShortage: number,
) {
  const stock = nonNegative(comparison.stock);
  const pending = nonNegative(comparison.pending);
  const necessity = nonNegative(comparison.necessity);
  const suppliedBalance = numeric(comparison.balance);
  const balance = suppliedBalance ?? stock + pending - necessity;
  const toBuy = Math.max(0, -balance);
  return {
    stock,
    pending,
    necessity,
    balance,
    toBuy,
    shortageDifference: exactShortage - toBuy,
  };
}

function normalizeSourceFiles(value?: MonthlyPurchaseSourceFiles) {
  const result: MonthlyPurchaseSourceFiles = {};
  for (const kind of [
    "estimate",
    "stock",
    "pending",
    "analysis",
  ] as MonthlyPurchaseSourceKind[]) {
    const fileName = clean(value?.[kind]);
    if (fileName) result[kind] = fileName;
  }
  return result;
}

function normalizeSourceCounts(
  value?: Partial<MonthlyPurchasePlanPayload["sourceCounts"]>,
) {
  const count = (input: unknown) =>
    Math.max(0, Math.trunc(Number(input) || 0));
  return {
    estimateRows: count(value?.estimateRows),
    stockRows: count(value?.stockRows),
    pendingRows: count(value?.pendingRows),
    analysisRows: count(value?.analysisRows),
    negativePendingRows: count(value?.negativePendingRows),
    duplicatePendingRows: count(value?.duplicatePendingRows),
    overduePendingRows: count(value?.overduePendingRows),
  };
}

function normalizeRounding(value: unknown) {
  const parsed = Math.trunc(Number(value) || DEFAULT_ROUNDING_MULTIPLE);
  if (parsed < 1 || parsed > 1_000_000)
    return DEFAULT_ROUNDING_MULTIPLE;
  return parsed;
}

function roundPurchase(value: number, multiple: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const epsilon = Math.max(1e-9, multiple * 1e-9);
  return Math.ceil((value - epsilon) / multiple) * multiple;
}

function parseDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  if (typeof value === "number" && value > 30_000 && value < 80_000) {
    const date = new Date(Date.UTC(1899, 11, 30 + value));
    return new Date(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    );
  }
  const text = clean(value);
  const parts = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (parts) {
    const year = Number(parts[3]) + (parts[3].length === 2 ? 2000 : 0);
    const date = new Date(year, Number(parts[2]) - 1, Number(parts[1]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = text ? new Date(text) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function localDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function code(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value))
    return Number.isInteger(value)
      ? String(value)
      : String(value).replace(/\.0+$/, "");
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

function numeric(value: unknown) {
  const parsed = number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function number(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number(value);
  const compact = value.trim().replace(/\s/g, "");
  if (!compact) return 0;
  let normalized = compact;
  if (compact.includes(",") && compact.includes(".")) {
    normalized =
      compact.lastIndexOf(",") > compact.lastIndexOf(".")
        ? compact.replace(/\./g, "").replace(",", ".")
        : compact.replace(/,/g, "");
  } else if (compact.includes(",")) {
    normalized = compact.replace(",", ".");
  } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(compact)) {
    normalized = compact.replace(/\./g, "");
  }
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

function canonical(value: unknown) {
  return normalize(value).replace(/[^A-Z0-9]/g, "");
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
