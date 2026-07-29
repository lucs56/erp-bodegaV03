export type SheetMatrix = {
  name: string;
  fileName: string;
  rows: unknown[][];
};

export type PurchaseProductContribution = {
  productCode: string;
  productName: string;
  quantity: number;
};

export type PendingOrder = {
  orderNumber: string;
  orderDate: string;
  deliveryDate: string;
  materialCode: string;
  description: string;
  balance: number;
  orderQuantity: number;
};

export type PurchaseAnalysisItem = {
  materialCode: string;
  sourceCodes: string[];
  materialName: string;
  category: string;
  stock: number;
  depots: Record<string, number>;
  pendingDetected: number;
  pendingConfirmed: number;
  calculatedNeed: number;
  confirmedNeed: number;
  balance: number;
  shortageExact: number;
  purchaseRounded: number;
  products: PurchaseProductContribution[];
  pendingOrders: PendingOrder[];
  adjustmentSource: "analysis" | "automatic" | "manual";
  notes: string[];
};

export type PurchaseAnalysisSnapshot = {
  version: 1;
  importedAt: string;
  updatedAt: string;
  period: string;
  rounding: number;
  files: string[];
  sheets: {
    estimated: string;
    stock: string;
    pending: string;
    analysis: string;
  };
  summary: {
    products: number;
    materials: number;
    stock: number;
    pending: number;
    need: number;
    shortageExact: number;
    purchaseRounded: number;
    aliasesConsolidated: number;
    analysisOverrides: number;
  };
  warnings: string[];
  items: PurchaseAnalysisItem[];
};

export const MATERIAL_ALIASES: Record<string, string> = {
  "30354": "30354A",
};

const CATEGORY_BY_HEADER: Record<string, string> = {
  BOTELLA: "Botellas",
  BOTELLAS: "Botellas",
  TAPON: "Tapones",
  TAPONES: "Tapones",
  TAPA: "Tapas",
  TAPAS: "Tapas",
  CAPSULA: "Cápsulas",
  CAPSULAS: "Cápsulas",
  CAJA: "Cajas",
  CAJAS: "Cajas",
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalized(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function inferCategory(description: unknown) {
  const value = normalized(description);
  if (value.includes("BOTELLA")) return "Botellas";
  if (
    value.includes("TAPON") ||
    value.includes("CORCHO") ||
    value.includes("SCREW")
  ) {
    return "Tapones";
  }
  if (value.includes("TAPA")) return "Tapas";
  if (value.includes("CAPSULA")) return "Cápsulas";
  if (value.includes("CAJA") || value.includes("CARTON")) return "Cajas";
  if (value.includes("ETIQUETA") || value.includes("CONTRAETIQUETA")) {
    return "Etiquetas";
  }
  return "Otros";
}

export function canonicalMaterialCode(value: unknown) {
  const raw = text(value).toUpperCase().replace(/\s+/g, "");
  return MATERIAL_ALIASES[raw] ?? raw;
}

function numeric(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = text(value).replace(/\s/g, "");
  if (!raw) return 0;
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  let normalizedNumber = raw;
  if (comma > dot) {
    normalizedNumber = raw.replace(/\./g, "").replace(",", ".");
  } else if (dot > comma && comma >= 0) {
    normalizedNumber = raw.replace(/,/g, "");
  } else if ((raw.match(/\./g) ?? []).length > 1) {
    normalizedNumber = raw.replace(/\./g, "");
  }
  const result = Number(normalizedNumber);
  return Number.isFinite(result) ? result : 0;
}

function dateText(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return text(value);
}

function findHeaderRow(
  rows: unknown[][],
  required: string[],
  optional: string[] = [],
) {
  let best = { index: -1, score: -1 };
  rows.slice(0, 30).forEach((row, index) => {
    const cells = row.map(normalized);
    const requiredHits = required.filter((term) =>
      cells.some((cell) => cell === term || cell.includes(term)),
    ).length;
    if (requiredHits !== required.length) return;
    const optionalHits = optional.filter((term) =>
      cells.some((cell) => cell === term || cell.includes(term)),
    ).length;
    const score = requiredHits * 10 + optionalHits;
    if (score > best.score) best = { index, score };
  });
  return best.index;
}

function column(row: unknown[], terms: string[]) {
  const cells = row.map(normalized);
  return cells.findIndex((cell) =>
    terms.some((term) => cell === term || cell.includes(term)),
  );
}

function classifySheet(sheet: SheetMatrix) {
  const upperName = normalized(sheet.name);
  const estimatedHeader = findHeaderRow(
    sheet.rows,
    ["CODIGO", "PRESENTACION"],
    ["VARIEDAD"],
  );
  const materialHeader = findHeaderRow(
    sheet.rows,
    ["TOTAL BOTELLAS", "BOTELLA"],
    ["TAPON", "CAPSULA", "CAJA"],
  );
  const stockHeader = findHeaderRow(
    sheet.rows,
    ["CODIGO", "DESCRIPCION", "TOTAL"],
    ["C18"],
  );
  const pendingHeader = findHeaderRow(
    sheet.rows,
    ["PRODUCTO C", "C POR D E"],
    ["NRO OC", "CANT OC"],
  );
  const analysisHeader = findHeaderRow(
    sheet.rows,
    ["CODIGO", "STOCK", "PENDIENTE", "NECESIDAD"],
    ["A COMPRAR"],
  );
  return {
    estimated:
      (upperName === "ESTIMADO" ? 100 : 0) +
      (estimatedHeader >= 0 && materialHeader >= 0 ? 50 : 0),
    stock:
      (upperName === "STOCK" ? 100 : 0) + (stockHeader >= 0 ? 50 : 0),
    pending:
      (upperName === "PENDIENTE" ? 100 : 0) +
      (pendingHeader >= 0 ? 50 : 0),
    analysis:
      (upperName === "ANALISIS" ? 100 : 0) +
      (analysisHeader >= 0 ? 50 : 0),
  };
}

function bestSheet(
  sheets: SheetMatrix[],
  kind: "estimated" | "stock" | "pending" | "analysis",
) {
  return sheets
    .map((sheet) => ({ sheet, score: classifySheet(sheet)[kind] }))
    .filter((candidate) => candidate.score >= 50)
    .sort((left, right) => right.score - left.score)[0]?.sheet;
}

type NeedAggregate = {
  materialCode: string;
  sourceCodes: Set<string>;
  category: string;
  calculatedNeed: number;
  products: PurchaseProductContribution[];
};

function parseEstimated(sheet?: SheetMatrix) {
  const needs = new Map<string, NeedAggregate>();
  if (!sheet) return { needs, products: 0, period: "" };
  const mainHeaderIndex = findHeaderRow(
    sheet.rows,
    ["CODIGO", "PRESENTACION"],
    ["VARIEDAD"],
  );
  const materialHeaderIndex = findHeaderRow(
    sheet.rows,
    ["TOTAL BOTELLAS", "BOTELLA"],
    ["TAPON", "CAPSULA", "CAJA"],
  );
  if (mainHeaderIndex < 0 || materialHeaderIndex < 0) {
    return { needs, products: 0, period: "" };
  }
  const mainHeader = sheet.rows[mainHeaderIndex] ?? [];
  const materialHeader = sheet.rows[materialHeaderIndex] ?? [];
  const codeColumn = column(mainHeader, ["CODIGO"]);
  const productColumn = column(mainHeader, ["VARIEDAD", "PRODUCTO", "DESCRIPCION"]);
  const presentationColumn = column(mainHeader, ["PRESENTACION"]);
  const totalBoxesColumn = column(materialHeader, ["TOTAL CAJAS"]);
  const totalBottlesColumn = column(materialHeader, ["TOTAL BOTELLAS"]);
  const materialColumns = materialHeader
    .map((value, index) => ({
      index,
      key: normalized(value),
    }))
    .filter(({ key }) => Object.prototype.hasOwnProperty.call(CATEGORY_BY_HEADER, key));

  let products = 0;
  for (
    let rowIndex = Math.max(mainHeaderIndex, materialHeaderIndex) + 1;
    rowIndex < sheet.rows.length;
    rowIndex += 1
  ) {
    const row = sheet.rows[rowIndex] ?? [];
    const productCode = text(row[codeColumn]);
    const productName = text(row[productColumn]);
    if (!productCode || !productName) continue;
    const presentation = numeric(row[presentationColumn]);
    const totalBoxes = numeric(row[totalBoxesColumn]);
    const totalBottles =
      numeric(row[totalBottlesColumn]) ||
      (presentation > 0 ? totalBoxes * presentation : 0);
    if (totalBoxes <= 0 && totalBottles <= 0) continue;
    products += 1;
    for (const material of materialColumns) {
      const rawCode = canonicalMaterialCode(row[material.index]);
      if (!rawCode) continue;
      const materialCode = canonicalMaterialCode(rawCode);
      const quantity =
        CATEGORY_BY_HEADER[material.key] === "Cajas"
          ? totalBoxes
          : totalBottles;
      if (quantity <= 0) continue;
      const current = needs.get(materialCode) ?? {
        materialCode,
        sourceCodes: new Set<string>(),
        category: CATEGORY_BY_HEADER[material.key],
        calculatedNeed: 0,
        products: [],
      };
      current.sourceCodes.add(text(row[material.index]).toUpperCase());
      current.calculatedNeed += quantity;
      current.products.push({ productCode, productName, quantity });
      needs.set(materialCode, current);
    }
  }

  const monthLabels = mainHeader
    .slice(3, 7)
    .map((value) => dateText(value))
    .filter(Boolean);
  return {
    needs,
    products,
    period: monthLabels.length
      ? `${monthLabels[0]} – ${monthLabels.at(-1)}`
      : "",
  };
}

type StockAggregate = {
  materialCode: string;
  sourceCodes: Set<string>;
  materialName: string;
  stock: number;
  depots: Record<string, number>;
};

function parseStock(sheet?: SheetMatrix) {
  const stock = new Map<string, StockAggregate>();
  if (!sheet) return stock;
  const headerIndex = findHeaderRow(
    sheet.rows,
    ["CODIGO", "DESCRIPCION", "TOTAL"],
    ["C18"],
  );
  if (headerIndex < 0) return stock;
  const header = sheet.rows[headerIndex] ?? [];
  const codeColumn = column(header, ["CODIGO DE PRODUCTO", "CODIGO"]);
  const descriptionColumn = column(header, ["DESCRIPCION"]);
  const totalColumn = column(header, ["TOTAL"]);
  const depotColumns = header
    .map((value, index) => ({ depot: text(value), index }))
    .filter(
      ({ depot, index }) =>
        depot &&
        ![codeColumn, descriptionColumn, totalColumn].includes(index),
    );

  for (let rowIndex = headerIndex + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex] ?? [];
    const sourceCode = text(row[codeColumn]).toUpperCase();
    const materialCode = canonicalMaterialCode(sourceCode);
    if (!materialCode) continue;
    const total =
      numeric(row[totalColumn]) ||
      depotColumns.reduce((sum, depot) => sum + numeric(row[depot.index]), 0);
    const current = stock.get(materialCode) ?? {
      materialCode,
      sourceCodes: new Set<string>(),
      materialName: "",
      stock: 0,
      depots: {},
    };
    current.sourceCodes.add(sourceCode);
    if (!current.materialName || sourceCode === materialCode) {
      current.materialName = text(row[descriptionColumn]) || current.materialName;
    }
    current.stock += total;
    for (const depot of depotColumns) {
      current.depots[depot.depot] =
        (current.depots[depot.depot] ?? 0) + numeric(row[depot.index]);
    }
    stock.set(materialCode, current);
  }
  return stock;
}

type PendingAggregate = {
  materialCode: string;
  sourceCodes: Set<string>;
  materialName: string;
  pendingDetected: number;
  orders: PendingOrder[];
};

function parsePending(sheet?: SheetMatrix) {
  const pending = new Map<string, PendingAggregate>();
  if (!sheet) return pending;
  const headerIndex = findHeaderRow(
    sheet.rows,
    ["PRODUCTO C", "C POR D E"],
    ["NRO OC", "CANT OC"],
  );
  if (headerIndex < 0) return pending;
  const header = sheet.rows[headerIndex] ?? [];
  const codeColumn = column(header, ["PRODUCTO C"]);
  const descriptionColumn = column(header, ["DESCRIPCION PRODUCTO C"]);
  const balanceColumn = column(header, ["C POR D E"]);
  const quantityColumn = column(header, ["CANT OC"]);
  const orderColumn = column(header, ["NRO OC"]);
  const orderDateColumn = column(header, ["FECHA OC"]);
  const deliveryColumn = column(header, ["F ENTR"]);

  for (let rowIndex = headerIndex + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex] ?? [];
    const sourceCode = text(row[codeColumn]).toUpperCase();
    const materialCode = canonicalMaterialCode(sourceCode);
    const rawBalance = numeric(row[balanceColumn]);
    if (!materialCode || rawBalance >= 0) continue;
    const current = pending.get(materialCode) ?? {
      materialCode,
      sourceCodes: new Set<string>(),
      materialName: "",
      pendingDetected: 0,
      orders: [],
    };
    current.sourceCodes.add(sourceCode);
    current.materialName =
      current.materialName || text(row[descriptionColumn]);
    const balance = Math.abs(rawBalance);
    current.pendingDetected += balance;
    current.orders.push({
      orderNumber: text(row[orderColumn]),
      orderDate: dateText(row[orderDateColumn]),
      deliveryDate: dateText(row[deliveryColumn]),
      materialCode: sourceCode,
      description: text(row[descriptionColumn]),
      balance,
      orderQuantity: Math.abs(numeric(row[quantityColumn])),
    });
    pending.set(materialCode, current);
  }
  return pending;
}

type AnalysisOverride = {
  materialCode: string;
  sourceCodes: Set<string>;
  materialName: string;
  pending: number;
  need: number;
};

function parseAnalysis(sheet?: SheetMatrix) {
  const analysis = new Map<string, AnalysisOverride>();
  if (!sheet) return analysis;
  const headerIndex = findHeaderRow(
    sheet.rows,
    ["CODIGO", "STOCK", "PENDIENTE", "NECESIDAD"],
    ["A COMPRAR"],
  );
  if (headerIndex < 0) return analysis;
  const header = sheet.rows[headerIndex] ?? [];
  const codeColumn = column(header, ["CODIGO"]);
  const descriptionColumn = column(header, ["DESCRIPCION"]);
  const pendingColumn = column(header, ["PENDIENTE"]);
  const needColumn = column(header, ["NECESIDAD"]);
  for (let rowIndex = headerIndex + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex] ?? [];
    const sourceCode = text(row[codeColumn]).toUpperCase();
    const materialCode = canonicalMaterialCode(sourceCode);
    if (!materialCode) continue;
    const current = analysis.get(materialCode) ?? {
      materialCode,
      sourceCodes: new Set<string>(),
      materialName: "",
      pending: 0,
      need: 0,
    };
    current.sourceCodes.add(sourceCode);
    current.materialName =
      current.materialName || text(row[descriptionColumn]);
    current.pending += Math.max(0, numeric(row[pendingColumn]));
    current.need += Math.max(0, numeric(row[needColumn]));
    analysis.set(materialCode, current);
  }
  return analysis;
}

function roundedPurchase(shortage: number, rounding: number) {
  if (shortage <= 0) return 0;
  return Math.ceil(shortage / rounding) * rounding;
}

export function recalculatePurchaseSnapshot(
  snapshot: PurchaseAnalysisSnapshot,
): PurchaseAnalysisSnapshot {
  const items = snapshot.items
    .map((item) => {
      const stock = Math.max(0, numeric(item.stock));
      const pendingConfirmed = Math.max(0, numeric(item.pendingConfirmed));
      const confirmedNeed = Math.max(0, numeric(item.confirmedNeed));
      const balance = stock + pendingConfirmed - confirmedNeed;
      const shortageExact = Math.max(0, -balance);
      return {
        ...item,
        stock,
        pendingConfirmed,
        confirmedNeed,
        balance,
        shortageExact,
        purchaseRounded: roundedPurchase(shortageExact, snapshot.rounding),
      };
    })
    .sort(
      (left, right) =>
        right.shortageExact - left.shortageExact ||
        left.materialCode.localeCompare(right.materialCode, "es"),
    );
  const analyzedItems = items.filter(
    (item) => item.confirmedNeed > 0 || item.calculatedNeed > 0,
  );
  const summary = {
    ...snapshot.summary,
    materials: analyzedItems.length,
    stock: analyzedItems.reduce((sum, item) => sum + item.stock, 0),
    pending: analyzedItems.reduce(
      (sum, item) => sum + item.pendingConfirmed,
      0,
    ),
    need: analyzedItems.reduce((sum, item) => sum + item.confirmedNeed, 0),
    shortageExact: analyzedItems.reduce(
      (sum, item) => sum + item.shortageExact,
      0,
    ),
    purchaseRounded: analyzedItems.reduce(
      (sum, item) => sum + item.purchaseRounded,
      0,
    ),
  };
  return { ...snapshot, updatedAt: new Date().toISOString(), items, summary };
}

export function buildPurchaseAnalysis(
  sheets: SheetMatrix[],
  options?: { rounding?: number; importedAt?: string },
): PurchaseAnalysisSnapshot {
  const estimatedSheet = bestSheet(sheets, "estimated");
  const stockSheet = bestSheet(sheets, "stock");
  const pendingSheet = bestSheet(sheets, "pending");
  const analysisSheet = bestSheet(sheets, "analysis");
  const estimated = parseEstimated(estimatedSheet);
  const stock = parseStock(stockSheet);
  const pending = parsePending(pendingSheet);
  const analysis = parseAnalysis(analysisSheet);
  const codes = new Set([
    ...estimated.needs.keys(),
    ...stock.keys(),
    ...pending.keys(),
    ...analysis.keys(),
  ]);
  const rounding = Math.max(1, Math.round(options?.rounding ?? 10_000));
  let aliasesConsolidated = 0;
  const items: PurchaseAnalysisItem[] = [...codes].map((materialCode) => {
    const need = estimated.needs.get(materialCode);
    const available = stock.get(materialCode);
    const detected = pending.get(materialCode);
    const override = analysis.get(materialCode);
    const sourceCodes = new Set([
      ...(need?.sourceCodes ?? []),
      ...(available?.sourceCodes ?? []),
      ...(detected?.sourceCodes ?? []),
      ...(override?.sourceCodes ?? []),
    ]);
    if (sourceCodes.size > 1) aliasesConsolidated += 1;
    const calculatedNeed = need?.calculatedNeed ?? 0;
    const confirmedNeed = override?.need || calculatedNeed;
    const pendingDetected = detected?.pendingDetected ?? 0;
    const pendingConfirmed = override ? override.pending : pendingDetected;
    const notes: string[] = [];
    if (sourceCodes.size > 1) {
      notes.push(`Códigos equivalentes consolidados: ${[...sourceCodes].join(" + ")}`);
    }
    if (override && Math.abs(override.need - calculatedNeed) > 0.5) {
      notes.push("La necesidad fue ajustada con la hoja ANALISIS.");
    }
    if (override && Math.abs(override.pending - pendingDetected) > 0.5) {
      notes.push("El pendiente confirmado proviene de la hoja ANALISIS.");
    }
    if (!override && pendingDetected > 0) {
      notes.push("Pendiente detectado automáticamente; conviene validarlo antes de comprar.");
    }
    return {
      materialCode,
      sourceCodes: [...sourceCodes].sort(),
      materialName:
        override?.materialName ||
        available?.materialName ||
        detected?.materialName ||
        materialCode,
      category:
        need?.category ??
        inferCategory(
          override?.materialName ||
            available?.materialName ||
            detected?.materialName,
        ),
      stock: available?.stock ?? 0,
      depots: available?.depots ?? {},
      pendingDetected,
      pendingConfirmed,
      calculatedNeed,
      confirmedNeed,
      balance: 0,
      shortageExact: 0,
      purchaseRounded: 0,
      products: need?.products ?? [],
      pendingOrders: detected?.orders ?? [],
      adjustmentSource: override ? "analysis" : "automatic",
      notes,
    };
  });
  const warnings: string[] = [];
  if (!estimatedSheet) warnings.push("No se encontró la hoja ESTIMADO.");
  if (!stockSheet) warnings.push("No se encontró la hoja STOCK.");
  if (!pendingSheet) warnings.push("No se encontró la hoja PENDIENTE.");
  if (!analysisSheet) {
    warnings.push(
      "No se encontró una hoja ANALISIS: los pendientes detectados quedaron como valores iniciales y deben revisarse.",
    );
  }
  if (aliasesConsolidated) {
    warnings.push(
      "Se consolidó 30354 dentro de 30354A: el stock se suma y la necesidad se cuenta una sola vez.",
    );
  }
  const importedAt = options?.importedAt ?? new Date().toISOString();
  const snapshot: PurchaseAnalysisSnapshot = {
    version: 1,
    importedAt,
    updatedAt: importedAt,
    period: estimated.period || "Período importado",
    rounding,
    files: [...new Set(sheets.map((sheet) => sheet.fileName))],
    sheets: {
      estimated: estimatedSheet?.name ?? "",
      stock: stockSheet?.name ?? "",
      pending: pendingSheet?.name ?? "",
      analysis: analysisSheet?.name ?? "",
    },
    summary: {
      products: estimated.products,
      materials: items.length,
      stock: 0,
      pending: 0,
      need: 0,
      shortageExact: 0,
      purchaseRounded: 0,
      aliasesConsolidated,
      analysisOverrides: analysis.size,
    },
    warnings,
    items,
  };
  return recalculatePurchaseSnapshot(snapshot);
}
