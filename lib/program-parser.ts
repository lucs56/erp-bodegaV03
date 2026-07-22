import type { OperationAction, ProgramRecord, WeekStatus } from "./program-data";

export type SheetGrid = {
  sheetId: number;
  title: string;
  values: unknown[][];
};

export type ParsedWeek = {
  weekId: string;
  weekLabel: string;
  status: WeekStatus;
  records: ProgramRecord[];
  diagnostics: Array<{
    code: "MISSING_PRODUCT_CODE" | "MISSING_HEADER" | "UNRECOGNIZED_WEEK";
    message: string;
    sourceRow?: number;
  }>;
};

type ColumnKey =
  | "dateLabel"
  | "pin"
  | "productCode"
  | "brand"
  | "variety"
  | "vintage"
  | "capacity"
  | "closure"
  | "liters"
  | "client"
  | "country"
  | "action"
  | "cases"
  | "unitsPerCase"
  | "bottles"
  | "notes"
  | "bottleMaterial"
  | "closureMaterial"
  | "capsuleMaterial"
  | "caseMaterial"
  | "frontLabelMaterial"
  | "backLabelMaterial";

const ACTIONS = new Set<OperationAction>(["FRACCIONAR", "VESTIR", "ENCAJONAR"]);
const MONTHS: Record<string, number> = {
  ENERO: 1,
  FEBRERO: 2,
  MARZO: 3,
  ABRIL: 4,
  MAYO: 5,
  JUNIO: 6,
  JULIO: 7,
  AGOSTO: 8,
  SEPTIEMBRE: 9,
  SETIEMBRE: 9,
  OCTUBRE: 10,
  NOVIEMBRE: 11,
  DICIEMBRE: 12,
};

const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  dateLabel: ["FECHA"],
  pin: ["PIN", "PINO", "PIN N"],
  productCode: ["CODIGO"],
  brand: ["MARCA"],
  variety: ["VARIEDAD"],
  vintage: ["COSECHA"],
  capacity: ["CAPACIDAD"],
  closure: ["TAPONSC", "TAPON SC"],
  liters: ["LITROS"],
  client: ["CLIENTE"],
  country: ["PAIS DESTINO"],
  action: ["ACCION"],
  cases: ["CAJAS"],
  unitsPerCase: ["CJ X"],
  bottles: ["BOTELLAS"],
  notes: ["OBSERVACIONES"],
  bottleMaterial: ["BOTELLA"],
  closureMaterial: ["TAPON"],
  capsuleMaterial: ["CAPSTAPA", "CAPS TAPA"],
  caseMaterial: ["CAJAS"],
  frontLabelMaterial: ["ETQ"],
  backLabelMaterial: ["CEQ"],
};

export function parseProgramSheet(grid: SheetGrid): ParsedWeek {
  const identity = parseWeekIdentity(grid.title, text(grid.values[0]?.[0]));
  const diagnostics: ParsedWeek["diagnostics"] = [];
  if (!identity) {
    diagnostics.push({ code: "UNRECOGNIZED_WEEK", message: `No se pudo reconocer la semana de la pestaña ${grid.title.trim()}.` });
    return { weekId: "unknown", weekLabel: grid.title.trim(), status: "proxima", records: [], diagnostics };
  }

  let section = "SIN SECCIÓN";
  let line = "sin-linea";
  let columns: Partial<Record<ColumnKey, number>> | null = null;
  const records: ProgramRecord[] = [];
  const occurrences = new Map<string, number>();

  grid.values.forEach((row, index) => {
    const sourceRow = index + 1;
    const cells = row.map(text);
    const marker = cells.find((cell) => /PROGRAMACION|PROGRAMACIÓN/i.test(cell));
    if (marker) {
      section = marker.toUpperCase().replace(/\s+/g, " ").trim();
      line = lineFromSection(section);
      columns = null;
      return;
    }

    const detectedColumns = detectColumns(cells);
    if (detectedColumns) {
      columns = detectedColumns;
      return;
    }
    if (!columns) return;

    const action = value(row, columns.action).toUpperCase() as OperationAction;
    const bottles = parseWholeNumber(value(row, columns.bottles));
    const productCode = value(row, columns.productCode);
    const brand = value(row, columns.brand);
    const variety = value(row, columns.variety);
    if (!ACTIONS.has(action) || bottles <= 0 || (!productCode && !brand && !variety)) return;

    const pin = value(row, columns.pin);
    const client = value(row, columns.client);
    const country = value(row, columns.country);
    const identityKey = [identity.weekId, line, action, pin, productCode, client, country].join("|");
    const occurrence = (occurrences.get(identityKey) ?? 0) + 1;
    occurrences.set(identityKey, occurrence);

    const material = (key: ColumnKey) => normalizeMaterial(value(row, columns?.[key]));
    const record: ProgramRecord = {
      id: `${identity.weekId}:${stableHash(`${identityKey}|${occurrence}`)}`,
      weekId: identity.weekId,
      weekLabel: identity.weekLabel,
      weekStatus: identity.status,
      sourceSheet: grid.title,
      sourceRow,
      section,
      line,
      action,
      dateLabel: value(row, columns.dateLabel),
      pin,
      productCode,
      brand,
      variety,
      vintage: value(row, columns.vintage),
      capacity: value(row, columns.capacity),
      closure: value(row, columns.closure),
      liters: value(row, columns.liters),
      client,
      country,
      cases: value(row, columns.cases),
      unitsPerCase: value(row, columns.unitsPerCase),
      bottles,
      notes: value(row, columns.notes),
      materials: {
        bottle: material("bottleMaterial"),
        closure: material("closureMaterial"),
        capsuleOrCap: material("capsuleMaterial"),
        case: material("caseMaterial"),
        frontLabel: material("frontLabelMaterial"),
        backLabel: material("backLabelMaterial"),
      },
    };
    records.push(record);
    if (!productCode) diagnostics.push({ code: "MISSING_PRODUCT_CODE", message: `${brand || "Producto"} no tiene código.`, sourceRow });
  });

  if (records.length === 0 && !diagnostics.some((item) => item.code === "UNRECOGNIZED_WEEK")) {
    diagnostics.push({ code: "MISSING_HEADER", message: `No se encontraron bloques válidos de programación en ${grid.title.trim()}.` });
  }
  return { ...identity, records, diagnostics };
}

export function parseWeekIdentity(sheetTitle: string, documentTitle: string, today=new Date()) {
  const normalizedSheet = normalize(sheetTitle);
  const isTentative = normalizedSheet.startsWith("TENTATIVO");
  const titleMatch = normalize(documentTitle).match(/SEM DEL (\d{1,2}) DE ([A-Z]+) AL (\d{1,2}) DE ([A-Z]+) (\d{4})/);
  if (titleMatch) {
    const [, startDay, startMonthName, endDay, endMonthName, year] = titleMatch;
    const startMonth = MONTHS[startMonthName];
    const endMonth = MONTHS[endMonthName];
    if (!startMonth || !endMonth) return null;
    return {
      weekId: `${year}-${String(startMonth).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`,
      weekLabel: `${String(startDay).padStart(2, "0")}–${String(endDay).padStart(2, "0")} ${shortMonth(endMonth)}`,
      status: weekStatus(isTentative, Number(year), startMonth, Number(startDay), endMonth, Number(endDay),today),
    };
  }

  const sheetMatch = normalizedSheet.match(/SEM (\d{1,2})-(\d{1,2}) AL (\d{1,2})-(\d{1,2})/);
  const yearMatch = normalize(documentTitle).match(/(20\d{2})/);
  if (!sheetMatch || !yearMatch) return null;
  const [, startDay, startMonth, endDay, endMonth] = sheetMatch;
  return {
    weekId: `${yearMatch[1]}-${String(startMonth).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`,
    weekLabel: `${String(startDay).padStart(2, "0")}–${String(endDay).padStart(2, "0")} ${shortMonth(Number(endMonth))}`,
    status: weekStatus(isTentative, Number(yearMatch[1]), Number(startMonth), Number(startDay), Number(endMonth), Number(endDay),today),
  };
}

function detectColumns(cells: string[]): Partial<Record<ColumnKey, number>> | null {
  const normalized = cells.map(normalizeHeader);
  if (!normalized.includes("FECHA") || !normalized.includes("ACCION") || !normalized.includes("BOTELLAS")) return null;
  const columns: Partial<Record<ColumnKey, number>> = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<[ColumnKey, string[]]>) {
    const normalizedAliases = aliases.map(normalizeHeader);
    const startAt = ["bottleMaterial", "closureMaterial", "capsuleMaterial", "caseMaterial", "frontLabelMaterial", "backLabelMaterial"].includes(key) ? 18 : 0;
    const index = normalized.findIndex((header, columnIndex) => columnIndex >= startAt && normalizedAliases.includes(header));
    if (index >= 0) columns[key] = index;
  }
  return columns;
}

function lineFromSection(section: string) {
  const match = section.match(/LINEA\s+(\d+)/i);
  if (match) return `linea-${match[1]}`;
  if (/TAREAS MANUALES/i.test(section)) return "tareas-manuales";
  return "sin-linea";
}

function value(row: unknown[], index: number | undefined) {
  return index === undefined ? "" : text(row[index]);
}

function text(input: unknown) {
  return String(input ?? "").replace(/\s+/g, " ").trim();
}

function normalize(input: string) {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}

function normalizeHeader(input: string) {
  return normalize(input).replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function normalizeMaterial(input: string) {
  return normalizeHeader(input) === "NA" ? "" : input;
}

function parseWholeNumber(input: string) {
  const digits = input.replace(/[^\d-]/g, "");
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shortMonth(month: number) {
  return ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"][month] ?? "";
}

function weekStatus(tentative: boolean, year: number, startMonth: number, startDay: number, endMonth: number, endDay: number,now=new Date()): WeekStatus {
  if (tentative) return "tentativa";
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = Date.UTC(year, startMonth - 1, startDay);
  const end = Date.UTC(year, endMonth - 1, endDay);
  return today >= start && today <= end ? "actual" : "proxima";
}

function stableHash(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
