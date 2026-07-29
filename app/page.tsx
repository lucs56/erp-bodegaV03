"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PROGRAM_SOURCE,
  type ProgramRecord,
} from "../lib/program-data";
import { diffProgram } from "../lib/program-diff";
import { parseStockRows, type StockImportItem } from "../lib/stock-import";
import { suggestBomFromProgram } from "../lib/bom-suggestions";
import {
  generalAssistantFallback,
  type GeneralAssistantContext,
} from "../lib/assistant";
import {
  detectMonthlyPurchaseSources,
  parseAutomaticMonthlyPurchaseSources,
  type MonthlyPurchaseSourceFiles,
  type MonthlyPurchaseSourceKind,
  type MonthlyPurchaseSourceSet,
  type MonthlyPurchasePlanPayload,
} from "../lib/monthly-purchases";

type View =
  | "resumen"
  | "programacion"
  | "productos"
  | "bom"
  | "consumos"
  | "stock"
  | "faltantes"
  | "compras"
  | "usuarios"
  | "pendiente";
type BomItem = {
  materialCode: string;
  materialName: string;
  category: string;
  quantity: number;
  unit: string;
  action: string;
  substitutes: string[];
};
type BomProduct = { id: number; code: string; name: string; items: BomItem[] };
type OperationalSettings={spreadsheetId:string;syncIntervalSeconds:number;cacheSeconds:number;includedDepots:string[]};
const DEFAULT_OPERATIONAL_SETTINGS:OperationalSettings={spreadsheetId:"1XL44rx3sNKpxowAQzY1iSjy7s8lYOsPTMngD6xeBDPQ",syncIntervalSeconds:30,cacheSeconds:15,includedDepots:["2","13","C18","R18","2OB"]};
type Requirement = {
  materialCode: string;
  materialName: string;
  category: string;
  unit: string;
  total: number;
  substitutes: string[];
  weeks: Array<{ weekId: string; weekLabel: string; quantity: number }>;
  products: Array<{
    productCode: string;
    productName: string;
    quantity: number;
  }>;
};
type ShortageRequirement = Requirement & {
  available: number;
  depots?:Record<string,number>;
  shortage: number;
};
type StoredMonthlyPurchasePlan = MonthlyPurchasePlanPayload & {
  importedAt: string;
  importedBy: string;
};
const emptyBomItem = (): BomItem => ({
  materialCode: "",
  materialName: "",
  category: "Botellas",
  quantity: 1,
  unit: "unidad",
  action: "FRACCIONAR",
  substitutes: [],
});

function summarizeWeeks(records: ProgramRecord[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ids = [...new Set(records.map((record) => record.weekId))].sort();
  return ids.map((id, index) => {
    const weekRecords = records.filter((record) => record.weekId === id);
    const start = new Date(`${id}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const tentative = weekRecords.some((record) =>
      record.sourceSheet.toLocaleUpperCase("es").includes("TENTATIVO"),
    );
    const current = today >= start && today <= end;
    const status = tentative
      ? "Tentativa"
      : current
        ? "Actual"
        : start > today
          ? "Próxima"
          : "Cerrada";
    const detail = tentative
      ? "Plan preliminar"
      : current
        ? "Esta semana"
        : start > today
          ? `Semana futura ${index + 1}`
          : "Semana anterior";
    return {
      id,
      label: weekRecords[0]?.weekLabel ?? id,
      status,
      detail,
      fractionBottles: weekRecords
        .filter((record) => record.action === "FRACCIONAR")
        .reduce((total, record) => total + record.bottles, 0),
      operations: weekRecords.length,
      fraccionar: weekRecords.filter((record) => record.action === "FRACCIONAR")
        .length,
      vestir: weekRecords.filter((record) => record.action === "VESTIR").length,
      encajonar: weekRecords.filter((record) => record.action === "ENCAJONAR")
        .length,
      issues: weekRecords.filter((record) => !record.productCode).length,
    };
  });
}

function lineLabel(line: string) {
  if (line === "tareas-manuales") return "Tareas manuales";
  const number = line.match(/\d+/)?.[0];
  return number ? `Línea ${number}` : "Sin sector";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-AR").format(value);
}

function depotLabel(depot:string){
  const labels:Record<string,string>={"13":"13 (Producción)","2":"2 (Depósito 2)",C18:"C18 (Calidad)",R18:"R18", "2OB":"2OB"};
  return labels[depot.trim().toUpperCase()]??depot;
}

async function responseJson<T>(response:Response):Promise<T>{
  const text=await response.text();
  try{return JSON.parse(text) as T;}catch{throw new Error(response.status===503?"El servicio está ocupado. Se conservan los últimos datos válidos y se reintentará automáticamente.":`El servidor devolvió una respuesta inválida (${response.status}).`);}
}

async function fetchWithTimeout(input:RequestInfo|URL,init?:RequestInit,timeoutMs=10_000){
  const controller=new AbortController();
  const timeout=window.setTimeout(()=>controller.abort(),timeoutMs);
  try{return await fetch(input,{...init,signal:controller.signal});}
  finally{window.clearTimeout(timeout);}
}

async function fetchWithRetry(input:RequestInfo|URL,init?:RequestInit,timeoutMs=10_000){
  let response=await fetchWithTimeout(input,init,timeoutMs);
  if([429,503,504].includes(response.status)){
    await new Promise(resolve=>window.setTimeout(resolve,500));
    response=await fetchWithTimeout(input,init,timeoutMs);
  }
  return response;
}

function firstShortageWeek(item: ShortageRequirement) {
  let accumulated = 0;
  for (const week of item.weeks) {
    accumulated += week.quantity;
    if (accumulated > item.available) return week.weekLabel;
  }
  return item.weeks[0]?.weekLabel ?? "Sin semana";
}

function Icon({
  name,
}: {
  name:
    | "calendar"
    | "bottle"
    | "clipboard"
    | "alert"
    | "sync"
    | "sheet"
    | "check"
    | "lock"
    | "search";
}) {
  const common = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths = {
    calendar: (
      <>
        <path d="M6 3v3M18 3v3M4 9h16" />
        <rect x="3" y="5" width="18" height="16" rx="2" />
      </>
    ),
    bottle: (
      <>
        <path d="M9 3h6M10 3v5l-2 3v9h8v-9l-2-3V3" />
        <path d="M8 14h8" />
      </>
    ),
    clipboard: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4.5V3h6v1.5M9 10h6M9 14h6M9 18h4" />
      </>
    ),
    alert: (
      <>
        <path d="M10.3 4.3 2.8 18a2 2 0 0 0 1.8 3h14.8a2 2 0 0 0 1.8-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
    sync: (
      <>
        <path d="M20 7h-5V2" />
        <path d="M4.9 16a8 8 0 0 0 13.8 1M4 17v5h5" />
        <path d="M19.1 8A8 8 0 0 0 5.3 7" />
      </>
    ),
    sheet: (
      <>
        <path d="M6 2h9l4 4v16H6z" />
        <path d="M14 2v5h5M9 11h7M9 15h7M9 19h5" />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16 9" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
  };
  return (
    <svg aria-hidden="true" {...common}>
      {paths[name]}
    </svg>
  );
}

export default function Home() {
  const [session, setSession] = useState<{
    username: string;
    name: string;
    email: string;
    role: string;
    permissions: string;
  } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginDraft, setLoginDraft] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordPanelOpen,setPasswordPanelOpen]=useState(false);
  const [passwordDraft,setPasswordDraft]=useState({current:"",next:"",confirm:""});
  const [passwordMessage,setPasswordMessage]=useState("");
  const [records, setRecords] = useState<ProgramRecord[]>([]);
  const recordsRef = useRef<ProgramRecord[]>([]);
  const liveRef = useRef(false);
  const [sourceState, setSourceState] = useState({
    live: false,
    fetchedAt: PROGRAM_SOURCE.capturedAt,
    notice:
      "La conexión productiva de solo lectura todavía no está configurada.",
  });
  const [refreshing, setRefreshing] = useState(false);
  const refreshPromiseRef=useRef<Promise<{changed:boolean;live:boolean}>|null>(null);
  const programPollTimerRef=useRef<number|null>(null);
  const requirementsPromiseRef=useRef<Promise<void>|null>(null);
  const [view, setView] = useState<View>("resumen");
  const [adminTab,setAdminTab]=useState<"usuarios"|"configuracion"|"diagnostico">("usuarios");
  const [selectedWeek, setSelectedWeek] = useState("");
  const [query, setQuery] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [weekFilter, setWeekFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [lineFilter, setLineFilter] = useState("all");
  const [showChangesOnly,setShowChangesOnly]=useState(false);
  const [settings,setSettings]=useState(DEFAULT_OPERATIONAL_SETTINGS);
  const [settingsDraft,setSettingsDraft]=useState(DEFAULT_OPERATIONAL_SETTINGS);
  const [settingsMessage,setSettingsMessage]=useState("");
  const [bomProducts, setBomProducts] = useState<BomProduct[]>([]);
  const [bomLoading, setBomLoading] = useState(false);
  const [bomMessage, setBomMessage] = useState("");
  const [bomQuery, setBomQuery] = useState("");
  const [bomDraft, setBomDraft] = useState({
    code: "",
    name: "",
    items: [emptyBomItem()],
  });
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [requirementQuery, setRequirementQuery] = useState("");
  const [shortageQuery, setShortageQuery] = useState("");
  const [shortages, setShortages] = useState<ShortageRequirement[]>([]);
  const [requirementState, setRequirementState] = useState({
    loading: false,
    mapped: 0,
    blocked: 0,
    completed: 0,
    provisional: 0,
    stockItems: 0,
    error: "",
  });
  const [programChange, setProgramChange] = useState({
    added: 0,
    removed: 0,
    modified: 0,
    total: 0,
    detectedAt: "",
    changedIds: [] as string[],
    changedWeekIds: [] as string[],
  });
  const [stock, setStock] = useState<
    Array<{
      materialCode: string;
      materialName: string;
      category: string;
      quantity: number;
      unit: string;
      depots:Record<string,number>;
    }>
  >([]);
  const [stockQuery, setStockQuery] = useState("");
  const [stockDraft, setStockDraft] = useState({
    materialCode: "",
    materialName: "",
    category: "Otros",
    quantity: 0,
    unit: "unidad",
  });
  const stockFileRef = useRef<HTMLInputElement>(null);
  const [stockImport, setStockImport] = useState<{
    fileName: string;
    items: StockImportItem[];
    errors: string[];
    loading: boolean;
    message: string;
    includedRows: number;
    excludedRows: number;
  }>({
    fileName: "",
    items: [],
    errors: [],
    loading: false,
    message: "",
    includedRows: 0,
    excludedRows: 0,
  });
  const monthlyFileRef = useRef<HTMLInputElement>(null);
  const [purchaseMode, setPurchaseMode] = useState<"weekly" | "monthly">("weekly");
  const [monthlyPlan, setMonthlyPlan] = useState<StoredMonthlyPurchasePlan | null>(null);
  const [monthlyDraft, setMonthlyDraft] = useState<MonthlyPurchasePlanPayload | null>(null);
  const [monthlyQuery, setMonthlyQuery] = useState("");
  const [monthlyRounding, setMonthlyRounding] = useState(10_000);
  const [monthlySources, setMonthlySources] = useState<{
    sheets: MonthlyPurchaseSourceSet;
    files: MonthlyPurchaseSourceFiles;
  }>({ sheets: {}, files: {} });
  const [monthlyState, setMonthlyState] = useState({
    loading: false,
    message: "",
    error: "",
  });
  const [users, setUsers] = useState<
    Array<{
      id: number;
      email: string;
      username: string | null;
      name: string;
      role: string;
      active: boolean;
      permissions: string;
      passwordConfigured?:boolean;
    }>
  >([]);
  const [userDraft, setUserDraft] = useState({
    id: 0,
    email: "",
    username: "",
    password: "",
    name: "",
    role: "planner",
    active: true,
    permissions:
      "resumen,programacion,productos,consumos,stock,faltantes,compras",
  });
  const [userMessage, setUserMessage] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading,setChatLoading]=useState(false);
  const [chatMessages, setChatMessages] = useState<
    Array<{ from: "user" | "bot"; text: string }>
  >([
    {
      from: "bot",
      text: "¡Hola! Soy el asistente general del ERP. Puedo explicarte la sincronización, los cambios del programa, el estado del sistema y para qué sirve cada módulo.",
    },
  ]);
  const weeks = useMemo(() => summarizeWeeks(records), [records]);
  const selected = weeks.find((week) => week.id === selectedWeek) ?? weeks[0] ?? {
    id: "",
    label: "Esperando programación",
    status: "Actualizando",
    detail: "Se mostrará la primera semana disponible",
    fractionBottles: 0,
    operations: 0,
    fraccionar: 0,
    vestir: 0,
    encajonar: 0,
    issues: 0,
  };
  const missingCodeRecords = useMemo(
    () => records.filter((record) => !record.completed && !record.productCode),
    [records],
  );
  const withoutEmbeddedMaterials = useMemo(
    () =>
      records.filter((record) =>
        !record.completed&&Object.values(record.materials).every((value) => !value),
      ),
    [records],
  );
  const totalFractionBottles = useMemo(
    () =>
      records
        .filter((record) => record.action === "FRACCIONAR")
        .reduce((total, record) => total + record.bottles, 0),
    [records],
  );
  const actionTotals = useMemo(
    () => ({
      fraccionar: records.filter((record) => record.action === "FRACCIONAR")
        .length,
      vestir: records.filter((record) => record.action === "VESTIR").length,
      encajonar: records.filter((record) => record.action === "ENCAJONAR")
        .length,
    }),
    [records],
  );
  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return records.filter((record) => {
      if (weekFilter !== "all" && record.weekId !== weekFilter) return false;
      if (actionFilter !== "all" && record.action !== actionFilter)
        return false;
      if (lineFilter !== "all" && record.line !== lineFilter) return false;
      if(showChangesOnly&&!programChange.changedIds.includes(record.id))return false;
      if (!normalized) return true;
      return [
        record.productCode,
        record.brand,
        record.variety,
        record.vintage,
        record.pin,
        record.client,
        record.country,
      ]
        .join(" ")
        .toLocaleLowerCase("es")
        .includes(normalized);
    });
  }, [records, query, weekFilter, actionFilter, lineFilter,showChangesOnly,programChange.changedIds]);
  const groupedProgramRows = useMemo(
    () =>
      weeks
        .map((week) => ({
          week,
          lines: ["linea-1", "linea-2", "linea-3", "tareas-manuales"]
            .map((line) => ({
              line,
              rows: filteredRows
                .filter(
                  (record) => record.weekId === week.id && record.line === line,
                )
                .sort((a, b) => a.sourceRow - b.sourceRow),
            }))
            .filter((group) => group.rows.length),
        }))
        .filter((group) => group.lines.length),
    [weeks, filteredRows],
  );
  const programmedProducts = useMemo(
    () => [
      ...new Map(
        records
          .filter((record) => record.productCode)
          .map((record) => [
            record.productCode,
            {
              code: record.productCode,
              name: `${record.brand} · ${record.variety} ${record.vintage}`.trim(),
            },
          ]),
      ).values(),
    ],
    [records],
  );
  const productReport = useMemo(() => {
    const grouped = new Map<string, ProgramRecord[]>();
    for (const record of records.filter((item) => item.productCode))
      grouped.set(record.productCode, [
        ...(grouped.get(record.productCode) ?? []),
        record,
      ]);
    return [...grouped.entries()]
      .map(([code, rows]) => {
        const descriptions = [
          ...new Set(
            rows.map((row) =>
              `${row.brand} · ${row.variety} ${row.vintage}`.trim(),
            ),
          ),
        ];
        return {
          code,
          description: descriptions[0],
          descriptions,
          operations: [...new Set(rows.map((row) => row.action))],
          weeks: [...new Set(rows.map((row) => row.weekLabel))],
          bottles: rows.reduce((sum, row) => sum + row.bottles, 0),
          inconsistent: descriptions.length > 1,
        };
      })
      .sort((left, right) => left.code.localeCompare(right.code));
  }, [records]);
  const visibleProducts = useMemo(() => {
    const term = productQuery.trim().toLocaleLowerCase("es");
    return term
      ? productReport.filter((item) =>
          `${item.code} ${item.descriptions.join(" ")}`
            .toLocaleLowerCase("es")
            .includes(term),
        )
      : productReport;
  }, [productQuery, productReport]);
  const productsWithSheetMaterials = useMemo(
    () =>
      programmedProducts.filter(
        (product) =>
          suggestBomFromProgram(records, product.code).items.length > 0,
      ),
    [programmedProducts, records],
  );
  const visibleStock = useMemo(() => {
    const term = stockQuery.trim().toLocaleLowerCase("es");
    return term
      ? stock.filter((item) =>
          `${item.materialCode} ${item.materialName} ${item.category} ${Object.keys(item.depots??{}).join(" ")}`
            .toLocaleLowerCase("es")
            .includes(term),
        )
      : stock;
  }, [stock, stockQuery]);
  const visibleBomProducts = useMemo(() => {
    const term = bomQuery.trim().toLocaleLowerCase("es");
    return term
      ? programmedProducts.filter((product) =>
          `${product.code} ${product.name}`
            .toLocaleLowerCase("es")
            .includes(term),
        )
      : programmedProducts;
  }, [programmedProducts, bomQuery]);
  const visibleRequirements = useMemo(() => {
    const term = requirementQuery.trim().toLocaleLowerCase("es");
    return term
      ? requirements.filter((item) =>
          `${item.materialCode} ${item.materialName} ${item.category} ${item.weeks.map((week) => week.weekLabel).join(" ")} ${item.products.map((product) => `${product.productCode} ${product.productName}`).join(" ")}`
            .toLocaleLowerCase("es")
            .includes(term),
        )
      : requirements;
  }, [requirements, requirementQuery]);
  const visibleShortages = useMemo(() => {
    const term = shortageQuery.trim().toLocaleLowerCase("es");
    return term
      ? shortages.filter((item) =>
          `${item.materialCode} ${item.materialName} ${item.category} ${item.weeks.map((week) => week.weekLabel).join(" ")} ${item.products.map((product) => `${product.productCode} ${product.productName}`).join(" ")}`
            .toLocaleLowerCase("es")
            .includes(term),
        )
      : shortages;
  }, [shortages, shortageQuery]);
  const purchaseGroups = useMemo(() => {
    const groups = new Map<string, typeof visibleShortages>();
    for (const item of visibleShortages)
      groups.set(item.category || "Otros", [
        ...(groups.get(item.category || "Otros") ?? []),
        item,
      ]);
    return [...groups.entries()]
      .map(([category, items]) => ({
        category,
        items,
        total: items.reduce((sum, item) => sum + item.shortage, 0),
      }))
      .sort((left, right) => left.category.localeCompare(right.category, "es"));
  }, [visibleShortages]);
  const monthlyAnalysis = useMemo(() => {
    if (!monthlyPlan) return [];
    const term = monthlyQuery.trim().toLocaleLowerCase("es");
    return monthlyPlan.analysis.filter((item) =>
      !term ||
      `${item.materialCode} ${item.description}`
        .toLocaleLowerCase("es")
        .includes(term),
    );
  }, [monthlyPlan, monthlyQuery]);
  const monthlyShortages = useMemo(
    () => monthlyPlan?.analysis.filter((item) => item.toBuy > 0) ?? [],
    [monthlyPlan],
  );
  const monthlyComparisonDifferences = useMemo(
    () =>
      monthlyPlan?.analysis.filter(
        (item) =>
          item.comparison &&
          Math.abs(item.comparison.shortageDifference) > 0.01,
      ) ?? [],
    [monthlyPlan],
  );
  const monthlySummaries = useMemo(() => {
    if (!monthlyPlan) return [];
    const values = new Map<string, { key: string; label: string; boxes: number; bottles: number }>();
    for (const estimate of monthlyPlan.estimates) {
      for (const month of estimate.months) {
        const current = values.get(month.key) ?? {
          key: month.key,
          label: month.label,
          boxes: 0,
          bottles: 0,
        };
        current.boxes += month.boxes;
        current.bottles += month.boxes * estimate.presentation;
        values.set(month.key, current);
      }
    }
    return [...values.values()].sort((left, right) => left.key.localeCompare(right.key));
  }, [monthlyPlan]);
  const visibleUsers = useMemo(() => {
    const term = userQuery.trim().toLocaleLowerCase("es");
    return term
      ? users.filter((user) =>
          `${user.name} ${user.username ?? ""} ${user.email} ${user.role} ${user.active ? "activo" : "inactivo"}`
            .toLocaleLowerCase("es")
            .includes(term),
        )
      : users;
  }, [users, userQuery]);
  const bomSuggestion = useMemo(
    () => suggestBomFromProgram(records, bomDraft.code),
    [records, bomDraft.code],
  );

  const loadBoms = useCallback(async () => {
    setBomLoading(true);
    try {
      const response = await fetch("/api/bom", { cache: "no-store" });
      const payload = (await response.json()) as {
        products?: BomProduct[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error || "No se pudieron cargar las fichas técnicas.");
      setBomProducts(payload.products ?? []);
      setBomMessage("");
    } catch (error) {
      setBomMessage(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar las fichas técnicas.",
      );
    } finally {
      setBomLoading(false);
    }
  }, []);
  const saveBom = async () => {
    setBomLoading(true);
    setBomMessage("");
    try {
      const response = await fetch("/api/bom", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bomDraft),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error || "No se pudo guardar la ficha técnica.");
      setBomDraft({ code: "", name: "", items: [emptyBomItem()] });
      await loadBoms();
      setBomMessage("Ficha técnica guardada correctamente.");
    } catch (error) {
      setBomMessage(
        error instanceof Error ? error.message : "No se pudo guardar la ficha técnica.",
      );
    } finally {
      setBomLoading(false);
    }
  };
  const updateBomItem = (index: number, values: Partial<BomItem>) =>
    setBomDraft((draft) => ({
      ...draft,
      items: draft.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...values } : item,
      ),
    }));
  const applySheetMaterials = () => {
    setBomDraft((draft) => {
      const current = draft.items.filter((item) => item.materialCode.trim());
      const known = new Set(
        current.map((item) => `${item.materialCode}:${item.action}`),
      );
      const additions = bomSuggestion.items.filter(
        (item) => !known.has(`${item.materialCode}:${item.action}`),
      );
      return { ...draft, items: [...current, ...additions] };
    });
    setBomMessage(
      `${bomSuggestion.items.length} referencias encontradas en el Sheet. Revisá descripción y consumo antes de guardar.`,
    );
  };
  const loadRequirements = useCallback(async () => {
    if(requirementsPromiseRef.current)return requirementsPromiseRef.current;
    const operation=(async()=>{
      setRequirementState((state) => ({ ...state, loading: true, error: "" }));
      try {
        const response = await fetchWithRetry("/api/requirements", { cache: "no-store" });
        const payload = await responseJson<{
          requirements?: Requirement[];
          shortages?: Array<
            Requirement & { available: number; shortage: number }
          >;
          mappedOperations?: number;
          blockedOperations?: number;
          completedOperations?: number;
          provisionalProducts?: number;
          stockItems?: number;
          error?: string;
        }>(response);
        if (!response.ok)
          throw new Error(payload.error || "No se pudo calcular el consumo.");
        setRequirements(payload.requirements ?? []);
        setShortages(payload.shortages ?? []);
        setRequirementState({
          loading: false,
          mapped: payload.mappedOperations ?? 0,
          blocked: payload.blockedOperations ?? 0,
          completed: payload.completedOperations ?? 0,
          provisional: payload.provisionalProducts ?? 0,
          stockItems: payload.stockItems ?? 0,
          error: "",
        });
      } catch (error) {
        setRequirementState((state) => ({
          ...state,
          loading: false,
          error:
            `${error instanceof Error ? error.message : "No se pudo calcular el consumo."} Los valores que ves corresponden al último cálculo correcto.`,
        }));
      }
    })();
    requirementsPromiseRef.current=operation;
    try{await operation;}finally{if(requirementsPromiseRef.current===operation)requirementsPromiseRef.current=null;}
  }, []);
  const loadStock = useCallback(async () => {
    const r = await fetch("/api/stock", { cache: "no-store" });
    const p = await responseJson<{ items?: typeof stock }>(r);
    if (r.ok) setStock(p.items ?? []);
  }, []);
  const saveStock = async () => {
    const r = await fetch("/api/stock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(stockDraft),
    });
    if (r.ok) {
      setStockDraft({
        materialCode: "",
        materialName: "",
        category: "Otros",
        quantity: 0,
        unit: "unidad",
      });
      await loadStock();
    }
  };
  const selectStockFile = async (file?: File) => {
    if (!file) return;
    setStockImport({
      fileName: file.name,
      items: [],
      errors: [],
      loading: true,
      message: "Leyendo archivo…",
      includedRows: 0,
      excludedRows: 0,
    });
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = workbook.SheetNames.flatMap((name) => {
        const sheet = workbook.Sheets[name];
        return sheet
          ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
              defval: "",
            })
          : [];
      });
      if (!rows.length) throw new Error("El archivo no contiene filas.");
      const parsed = parseStockRows(rows,new Set(settings.includedDepots));
      setStockImport({
        fileName: file.name,
        ...parsed,
        loading: false,
        message: parsed.items.length
          ? `${parsed.items.length} insumos agrupados y listos para importar.`
          : "No se encontraron filas válidas.",
      });
    } catch (error) {
      setStockImport({
        fileName: file.name,
        items: [],
        errors: [],
        loading: false,
        message:
          error instanceof Error
            ? error.message
            : "No se pudo leer el archivo.",
        includedRows: 0,
        excludedRows: 0,
      });
    }
  };
  const importStock = async () => {
    setStockImport((current) => ({
      ...current,
      loading: true,
      message: "Actualizando stock…",
    }));
    try {
      const r = await fetch("/api/stock/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: stockImport.items }),
      });
      const p = (await r.json()) as { imported?: number; error?: string };
      if (!r.ok) throw new Error(p.error || "No se pudo importar el stock.");
      await loadStock();
      if(requirementsPromiseRef.current)await requirementsPromiseRef.current;
      await loadRequirements();
      setStockImport((current) => ({
        ...current,
        loading: false,
        items: [],
        errors: [],
        message: `Importación completada: ${p.imported ?? 0} insumos actualizados.`,
      }));
    } catch (error) {
      setStockImport((current) => ({
        ...current,
        loading: false,
        message:
          error instanceof Error
            ? error.message
            : "No se pudo importar el stock.",
      }));
    }
  };
  const exportPurchases = async () => {
    if (!shortages.length) return;
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const makeRows = (items: ShortageRequirement[]) =>
      [...items]
        .sort(
          (left, right) =>
            left.category.localeCompare(right.category, "es") ||
            left.materialCode.localeCompare(right.materialCode, "es"),
        )
        .map((item) => ({
          "Tipo de insumo": item.category || "Otros",
          Código: item.materialCode,
          Descripción: item.materialName,
          Unidad: item.unit,
          Necesidad: item.total,
          Disponible: item.available,
          "Cantidad a comprar": item.shortage,
          "Stock por depósito":Object.entries(item.depots??{}).map(([depot,quantity])=>`${depotLabel(depot)}: ${formatNumber(quantity)}`).join(" · "),
          "Semana del faltante": firstShortageWeek(item),
          "Semanas con consumo": item.weeks
            .map((week) => week.weekLabel)
            .join(", "),
          "Cantidad de productos": item.products.length,
          "Productos que lo consumen": item.products
            .map(
              (product) =>
                `${product.productCode} - ${product.productName} (${formatNumber(product.quantity)})`,
            )
            .join("; "),
          Sustitutos: item.substitutes.join(", "),
        }));
    const addSheet = (name: string, items: ShortageRequirement[]) => {
      const sheet = XLSX.utils.json_to_sheet(makeRows(items));
      sheet["!cols"] = [
        { wch: 20 },
        { wch: 14 },
        { wch: 34 },
        { wch: 12 },
        { wch: 15 },
        { wch: 15 },
        { wch: 20 },
        { wch: 22 },
        { wch: 35 },
        { wch: 22 },
        { wch: 70 },
        { wch: 28 },
      ];
      if (sheet["!ref"]) sheet["!autofilter"] = { ref: sheet["!ref"] };
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    };

    addSheet("Todos los insumos", shortages);
    const usedNames = new Set(["Todos los insumos"]);
    for (const group of purchaseGroups) {
      const base = (group.category || "Otros")
        .replace(/[\\/?*:[\]]/g, " ")
        .trim()
        .slice(0, 31) || "Otros";
      let name = base;
      let suffix = 2;
      while (usedNames.has(name)) {
        const ending = ` ${suffix++}`;
        name = `${base.slice(0, 31 - ending.length)}${ending}`;
      }
      usedNames.add(name);
      const categoryItems = shortages.filter(
        (item) => (item.category || "Otros") === group.category,
      );
      addSheet(name, categoryItems);
    }
    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `reporte-compras-${date}.xlsx`);
  };
  const exportPurchaseCategory=async(category:string,items:ShortageRequirement[])=>{
    const XLSX=await import("xlsx");
    const rows=[...items].sort((a,b)=>a.materialName.localeCompare(b.materialName,"es")).map(item=>({"Código de insumo":item.materialCode,"Nombre del insumo":item.materialName,"Tipo":item.category,"Unidad":item.unit,"Necesidad total":item.total,"Stock disponible":item.available,"Stock por depósito":Object.entries(item.depots??{}).map(([depot,quantity])=>`${depotLabel(depot)}: ${formatNumber(quantity)}`).join(" · "),"Cantidad a comprar":item.shortage,"Semana del faltante":firstShortageWeek(item),"Semanas con consumo":item.weeks.map(week=>week.weekLabel).join(", "),"Productos que lo consumen":item.products.map(product=>`${product.productCode} - ${product.productName} (${formatNumber(product.quantity)})`).join("; "),"Sustitutos":item.substitutes.join(", ")}));
    const sheet=XLSX.utils.json_to_sheet(rows);sheet["!cols"]=[{wch:18},{wch:42},{wch:20},{wch:12},{wch:18},{wch:18},{wch:28},{wch:20},{wch:24},{wch:35},{wch:75},{wch:30}];if(sheet["!ref"])sheet["!autofilter"]={ref:sheet["!ref"]};
    const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,sheet,category.replace(/[\/?*:[\]]/g," ").slice(0,31)||"Compras");
    const safe=category.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,80)||"insumos";
    XLSX.writeFile(workbook,`reporte-compras-${safe}-${new Date().toISOString().slice(0,10)}.xlsx`);
  };
  const loadMonthlyPlan = useCallback(async () => {
    try {
      const response = await fetchWithTimeout("/api/monthly-purchases", { cache: "no-store" }, 8_000);
      const payload = await responseJson<{ plan?: StoredMonthlyPurchasePlan | null; error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "No se pudo leer el análisis mensual.");
      setMonthlyPlan(payload.plan ?? null);
      if (payload.plan?.roundingMultiple)
        setMonthlyRounding(payload.plan.roundingMultiple);
    } catch (error) {
      setMonthlyState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "No se pudo leer el análisis mensual.",
      }));
    }
  }, []);
  const buildMonthlyDraft = (
    sheets = monthlySources.sheets,
    files = monthlySources.files,
    roundingMultiple = monthlyRounding,
  ) => {
    const required: MonthlyPurchaseSourceKind[] = [
      "estimate",
      "stock",
      "pending",
    ];
    const missing = required.filter((kind) => !sheets[kind]);
    if (missing.length) {
      const labels: Record<MonthlyPurchaseSourceKind, string> = {
        estimate: "ESTIMADO",
        stock: "STOCK",
        pending: "PENDIENTE",
        analysis: "ANALISIS",
      };
      throw new Error(
        `Falta cargar ${missing.map((kind) => labels[kind]).join(", ")}.`,
      );
    }
    return parseAutomaticMonthlyPurchaseSources(sheets, {
      fileName:
        [...new Set(Object.values(files).filter(Boolean))].join(" + ") ||
        "Plan mensual automático",
      sourceFiles: files,
      roundingMultiple,
    });
  };
  const selectMonthlyFiles = async (fileList?: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    setMonthlyState({
      loading: true,
      message: "Leyendo y clasificando los archivos…",
      error: "",
    });
    try {
      const XLSX = await import("xlsx");
      const nextSheets = { ...monthlySources.sheets };
      const nextFiles = { ...monthlySources.files };
      let recognized = 0;
      const batchKinds = new Set<MonthlyPurchaseSourceKind>();
      for (const file of files) {
        const workbook = XLSX.read(await file.arrayBuffer(), {
          type: "array",
          cellDates: true,
          cellFormula: true,
        });
        const workbookSheets = Object.fromEntries(
          workbook.SheetNames.map((name) => [
            name,
            XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
              header: 1,
              defval: "",
              raw: true,
            }),
          ]),
        );
        const detected = detectMonthlyPurchaseSources(workbookSheets);
        for (const kind of [
          "estimate",
          "stock",
          "pending",
          "analysis",
        ] as MonthlyPurchaseSourceKind[]) {
          if (!detected[kind]) continue;
          nextSheets[kind] = detected[kind];
          nextFiles[kind] = file.name;
          batchKinds.add(kind);
          recognized += 1;
        }
      }
      if (!recognized)
        throw new Error(
          "No se reconoció ESTIMADO, STOCK, PENDIENTE ni ANALISIS en los archivos.",
        );
      if (
        batchKinds.has("estimate") &&
        batchKinds.has("stock") &&
        batchKinds.has("pending") &&
        !batchKinds.has("analysis")
      ) {
        delete nextSheets.analysis;
        delete nextFiles.analysis;
      }
      setMonthlySources({ sheets: nextSheets, files: nextFiles });
      const missing = (
        ["estimate", "stock", "pending"] as MonthlyPurchaseSourceKind[]
      ).filter((kind) => !nextSheets[kind]);
      if (missing.length) {
        setMonthlyDraft(null);
        const label: Record<MonthlyPurchaseSourceKind, string> = {
          estimate: "ESTIMADO",
          stock: "STOCK",
          pending: "PENDIENTE",
          analysis: "ANALISIS",
        };
        setMonthlyState({
          loading: false,
          message: `Fuentes guardadas. Falta cargar ${missing
            .map((kind) => label[kind])
            .join(", ")}.`,
          error: "",
        });
        return;
      }
      const parsed = buildMonthlyDraft(
        nextSheets,
        nextFiles,
        monthlyRounding,
      );
      setMonthlyDraft(parsed);
      setMonthlyState({
        loading: false,
        message: `${parsed.estimates.length} productos y ${parsed.analysis.length} insumos calculados automáticamente.`,
        error: "",
      });
    } catch (error) {
      setMonthlyState({
        loading: false,
        message: "",
        error: error instanceof Error ? error.message : "No se pudo interpretar el archivo.",
      });
    } finally {
      if (monthlyFileRef.current) monthlyFileRef.current.value = "";
    }
  };
  const recalculateMonthlyDraft = () => {
    setMonthlyState({
      loading: true,
      message: "Calculando necesidad, stock y pendientes…",
      error: "",
    });
    try {
      const parsed = buildMonthlyDraft();
      setMonthlyDraft(parsed);
      setMonthlyState({
        loading: false,
        message: `Cálculo terminado: ${parsed.analysis.length} insumos y ${parsed.analysis.filter((item) => item.toBuy > 0).length} compras necesarias.`,
        error: "",
      });
    } catch (error) {
      setMonthlyDraft(null);
      setMonthlyState({
        loading: false,
        message: "",
        error:
          error instanceof Error
            ? error.message
            : "No se pudo calcular el análisis.",
      });
    }
  };
  const clearMonthlySources = () => {
    setMonthlySources({ sheets: {}, files: {} });
    setMonthlyDraft(null);
    setMonthlyState({
      loading: false,
      message: "Fuentes temporales limpiadas. El análisis compartido no fue eliminado.",
      error: "",
    });
  };
  const saveMonthlyPlan = async () => {
    if (!monthlyDraft) return;
    setMonthlyState({ loading: true, message: "Guardando el análisis para todos los usuarios…", error: "" });
    try {
      const response = await fetchWithTimeout("/api/monthly-purchases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(monthlyDraft),
      }, 15_000);
      const payload = await responseJson<{ plan?: StoredMonthlyPurchasePlan; error?: string }>(response);
      if (!response.ok || !payload.plan)
        throw new Error(payload.error || "No se pudo guardar el análisis mensual.");
      setMonthlyPlan(payload.plan);
      setMonthlyDraft(null);
      setMonthlyState({
        loading: false,
        message: "Análisis mensual guardado en Cloudflare D1 y disponible en todos los dispositivos.",
        error: "",
      });
    } catch (error) {
      setMonthlyState({
        loading: false,
        message: "",
        error: error instanceof Error ? error.message : "No se pudo guardar el análisis mensual.",
      });
    }
  };
  const exportMonthlyPlan = async () => {
    if (!monthlyPlan) return;
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const analysisRows = monthlyPlan.analysis.map((item) => ({
      Código: item.materialCode,
      Descripción: item.description,
      Stock: item.stock,
      Pendiente: item.pending,
      Necesidad: item.necessity,
      "Saldo (Stock + Pendiente - Necesidad)": item.balance,
      "Faltante exacto": item.exactShortage,
      [`Compra redondeada a ${formatNumber(monthlyPlan.roundingMultiple)}`]:
        item.toBuy,
      Estado: item.toBuy > 0 ? "COMPRAR" : "CUBIERTO",
      "Compra del análisis anterior": item.comparison?.toBuy ?? "",
      "Diferencia contra análisis anterior":
        item.comparison?.shortageDifference ?? "",
      Observación: item.note,
    }));
    const analysisSheet = XLSX.utils.json_to_sheet(analysisRows);
    analysisSheet["!cols"] = [
      { wch: 18 }, { wch: 42 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
      { wch: 34 }, { wch: 18 }, { wch: 26 }, { wch: 14 }, { wch: 26 },
      { wch: 32 }, { wch: 30 },
    ];
    if (analysisSheet["!ref"]) analysisSheet["!autofilter"] = { ref: analysisSheet["!ref"] };
    XLSX.utils.book_append_sheet(workbook, analysisSheet, "Análisis");

    const estimateRows = monthlyPlan.estimates.map((item) => ({
      Código: item.productCode,
      Producto: item.description,
      Presentación: item.presentation,
      ...Object.fromEntries(item.months.map((month) => [`Cajas ${month.label}`, month.boxes])),
      "Total cajas": item.totalBoxes,
      "Total botellas": item.totalBottles,
      Botella: item.materials.bottle,
      Tapón: item.materials.cork,
      Tapa: item.materials.cap,
      Cápsula: item.materials.capsule,
      Caja: item.materials.box,
    }));
    const estimateSheet = XLSX.utils.json_to_sheet(estimateRows);
    estimateSheet["!cols"] = [
      { wch: 18 }, { wch: 38 }, { wch: 14 },
      ...monthlySummaries.map(() => ({ wch: 20 })),
      { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 18 },
    ];
    if (estimateSheet["!ref"]) estimateSheet["!autofilter"] = { ref: estimateSheet["!ref"] };
    XLSX.utils.book_append_sheet(workbook, estimateSheet, "Estimado");

    const controlRows = [
      ["Período", monthlyPlan.periodLabel],
      ["Redondeo de compra", monthlyPlan.roundingMultiple],
      ["Archivo ESTIMADO", monthlyPlan.sourceFiles.estimate ?? ""],
      ["Archivo STOCK", monthlyPlan.sourceFiles.stock ?? ""],
      ["Archivo PENDIENTE", monthlyPlan.sourceFiles.pending ?? ""],
      ["Archivo ANALISIS (opcional)", monthlyPlan.sourceFiles.analysis ?? ""],
      ["Filas ESTIMADO", monthlyPlan.sourceCounts.estimateRows],
      ["Filas STOCK", monthlyPlan.sourceCounts.stockRows],
      ["Filas PENDIENTE", monthlyPlan.sourceCounts.pendingRows],
      ["Pendientes negativos tomados como 0", monthlyPlan.sourceCounts.negativePendingRows],
      ["Pendientes duplicados ignorados", monthlyPlan.sourceCounts.duplicatePendingRows],
      ["Pendientes vencidos incluidos", monthlyPlan.sourceCounts.overduePendingRows],
      [],
      ["Advertencias"],
      ...monthlyPlan.warnings.map((warning) => [warning]),
    ];
    const controlSheet = XLSX.utils.aoa_to_sheet(controlRows);
    controlSheet["!cols"] = [{ wch: 42 }, { wch: 90 }];
    XLSX.utils.book_append_sheet(workbook, controlSheet, "Control");
    XLSX.writeFile(
      workbook,
      `analisis-compras-${monthlyPlan.periodLabel
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()}.xlsx`,
    );
  };
  const emptyUserDraft = () => ({
    id: 0,
    email: "",
    username: "",
    password: "",
    name: "",
    role: "planner",
    active: true,
    permissions:
      "resumen,programacion,productos,consumos,stock,faltantes,compras",
  });
  const loadUsers = useCallback(async () => {
    const r = await fetch("/api/users", { cache: "no-store" });
    const p = (await r.json()) as { users?: typeof users };
    if (r.ok) setUsers(p.users ?? []);
  }, []);
  const saveUser = async () => {
    setUserMessage("");
    const r = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(userDraft),
    });
    const p = (await r.json()) as { error?: string };
    if (r.ok) {
      setUserDraft(emptyUserDraft());
      setUserMessage("Usuario guardado correctamente.");
      await loadUsers();
    } else setUserMessage(p.error || "No se pudo guardar el usuario.");
  };
  const editUser = (user: (typeof users)[number]) => {
    setUserDraft({
      id: user.id,
      email: user.email,
      username: user.username ?? "",
      password: "",
      name: user.name,
      role: user.role,
      active: user.active,
      permissions: user.permissions,
    });
    setUserMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const toggleUser = async (user: (typeof users)[number]) => {
    const r = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...user, active: !user.active }),
    });
    const p = (await r.json()) as { error?: string };
    setUserMessage(
      r.ok
        ? `Acceso ${user.active ? "bloqueado" : "habilitado"} para ${user.name}.`
        : p.error || "No se pudo cambiar el acceso.",
    );
    if (r.ok) await loadUsers();
  };
  const deleteUser = async (user: (typeof users)[number]) => {
    if (user.username === "admin") {
      setUserMessage(
        "La cuenta principal admin está protegida y no puede eliminarse.",
      );
      return;
    }
    if (
      !window.confirm(
        `¿Eliminar definitivamente a ${user.name} (${user.username})?`,
      )
    )
      return;
    const r = await fetch("/api/users", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: user.id }),
    });
    const p = (await r.json()) as { error?: string };
    if (r.ok) {
      if (userDraft.id === user.id) setUserDraft(emptyUserDraft());
      await loadUsers();
      setUserMessage(`Usuario ${user.name} eliminado correctamente.`);
    } else setUserMessage(p.error || "No se pudo eliminar el usuario.");
  };
  const login = async () => {
    setAuthLoading(true);
    setLoginError("");
    try {
      const r = await fetchWithTimeout("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(loginDraft),
      }, 12_000);
      const p = await responseJson<{ user?: typeof session; error?: string }>(r);
      if (r.ok && p.user) {
        setSession(p.user);
        setLoginDraft({ username: "", password: "" });
      } else setLoginError(p.error || "No se pudo iniciar sesión.");
    } catch {
      setLoginError("El servidor demoró demasiado. Volvé a intentar en unos segundos.");
    } finally {
      setAuthLoading(false);
    }
  };
  const logout = async () => {
    setProfileOpen(false);
    await fetch("/api/auth", { method: "DELETE" });
    setSession(null);
    setView("resumen");
  };
  const changeOwnPassword=async()=>{
    setPasswordMessage("");
    if(passwordDraft.next.length<4){setPasswordMessage("La nueva contraseña debe tener al menos 4 caracteres.");return;}
    if(passwordDraft.next!==passwordDraft.confirm){setPasswordMessage("La confirmación no coincide.");return;}
    const response=await fetch("/api/auth",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({currentPassword:passwordDraft.current,newPassword:passwordDraft.next})});
    const payload=await response.json() as {error?:string};
    if(!response.ok){setPasswordMessage(payload.error||"No se pudo cambiar la contraseña.");return;}
    setPasswordDraft({current:"",next:"",confirm:""});setPasswordMessage("Contraseña actualizada correctamente.");
  };

  const refreshProgram = useCallback(async (force=false) => {
    if(refreshPromiseRef.current)return refreshPromiseRef.current;
    const operation=(async()=>{
      setRefreshing(true);
      const applyPayload=(payload:{
        source?: { live?: boolean; fetchedAt?: string; notice?: string };
        records?: ProgramRecord[];
      })=>{
        let changed=false;
        if (Array.isArray(payload.records)) {
          if (liveRef.current && payload.source?.live) {
            const change = diffProgram(recordsRef.current, payload.records);
            changed=change.total>0;
            if (change.total)
              setProgramChange({
                ...change,
                detectedAt: new Date().toISOString(),
              });
          }
          recordsRef.current = payload.records;
          setRecords(payload.records);
        }
        liveRef.current = Boolean(payload.source?.live);
        setSourceState({
          live: Boolean(payload.source?.live),
          fetchedAt: payload.source?.fetchedAt ?? PROGRAM_SOURCE.capturedAt,
          notice:
            payload.source?.notice ??
            (payload.source?.live
              ? "Google Sheets se comprueba automáticamente cada 30 segundos."
              : "Se conserva la última lectura validada."),
        });
        return changed;
      };
      try {
        const response = await fetchWithRetry(
          force ? "/api/program?fresh=1" : "/api/program?background=1",
          { cache: "no-store" },
          force ? 20_000 : 7_000,
        );
        if (!response.ok) throw new Error("No se pudo actualizar");
        const payload = await responseJson<{
          source?: { live?: boolean; fetchedAt?: string; notice?: string };
          records?: ProgramRecord[];
        }>(response);
        const changed=applyPayload(payload);
        if (!force) {
          if (programPollTimerRef.current)
            window.clearTimeout(programPollTimerRef.current);
          programPollTimerRef.current=window.setTimeout(() => {
            void (async()=>{
              try{
                const storedResponse=await fetchWithTimeout(
                  "/api/program?stored=1",
                  {cache:"no-store"},
                  6_000,
                );
                if(!storedResponse.ok)return;
                const storedPayload=await responseJson<{
                  source?: { live?: boolean; fetchedAt?: string; notice?: string };
                  records?: ProgramRecord[];
                }>(storedResponse);
                if(applyPayload(storedPayload))await loadRequirements();
              }catch{
                // La próxima comprobación de 30 segundos vuelve a intentarlo.
              }
            })();
          },7_000);
        }
        return{changed,live:Boolean(payload.source?.live)};
      } catch {
        setSourceState((current) => ({
          ...current,
          live: false,
          notice:
            "No se pudo actualizar; se conservan la programación y los cálculos de la última lectura válida.",
        }));
        return{changed:false,live:false};
      } finally {
        setRefreshing(false);
      }
    })();
    refreshPromiseRef.current=operation;
    try{return await operation;}finally{if(refreshPromiseRef.current===operation)refreshPromiseRef.current=null;}
  }, [loadRequirements]);

  const loadSettings=useCallback(async()=>{try{const response=await fetchWithTimeout("/api/settings",{cache:"no-store"},6_000);const payload=await responseJson<{settings?:OperationalSettings}>(response);if(response.ok&&payload.settings){setSettings(payload.settings);setSettingsDraft(payload.settings);}}catch{}},[]);
  const synchronizeProgram=useCallback(async(force=false,recalculate=false)=>{
    const result=await refreshProgram(force);
    if(recalculate||result.changed){
      if(requirementsPromiseRef.current)await requirementsPromiseRef.current;
      await loadRequirements();
    }
    return result;
  },[refreshProgram,loadRequirements]);
  const saveSettings=async()=>{setSettingsMessage("Guardando…");try{const response=await fetch("/api/settings",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(settingsDraft)});const payload=await responseJson<{settings?:OperationalSettings;error?:string}>(response);if(!response.ok||!payload.settings)throw new Error(payload.error||"No se pudo guardar.");setSettings(payload.settings);setSettingsDraft(payload.settings);setSettingsMessage("Configuración guardada en Cloudflare D1.");await synchronizeProgram(true,true);}catch(error){setSettingsMessage(error instanceof Error?error.message:"No se pudo guardar.");}};

  useEffect(() => {
    if(!session)return;
    const timer = window.setInterval(() => {if(document.visibilityState==="visible")void synchronizeProgram();}, settings.syncIntervalSeconds*1000);
    const onVisible=()=>{if(document.visibilityState==="visible")void synchronizeProgram();};
    document.addEventListener("visibilitychange",onVisible);
    return () => {
      window.clearInterval(timer);
      if(programPollTimerRef.current)window.clearTimeout(programPollTimerRef.current);
      document.removeEventListener("visibilitychange",onVisible);
    };
  }, [session,synchronizeProgram,settings.syncIntervalSeconds]);
  useEffect(() => {
    let active=true;
    const watchdog=window.setTimeout(()=>{
      if(active)setAuthLoading(false);
    },6_000);
    void fetchWithTimeout("/api/auth", { cache: "no-store" },5_500)
      .then(async (r) => {
        const p = await responseJson<{ user?: typeof session }>(r);
        if (active&&r.ok && p.user) setSession(p.user);
      })
      .catch(()=>null)
      .finally(() => {
        if(active)setAuthLoading(false);
        window.clearTimeout(watchdog);
      });
    return()=>{active=false;window.clearTimeout(watchdog);};
  }, []);
  useEffect(() => {
    if (!session) return;
    let active=true;
    void (async()=>{
      await loadSettings();
      if(!active)return;
      await Promise.allSettled([
        synchronizeProgram(),
        loadBoms(),
        loadStock(),
        loadRequirements(),
        loadMonthlyPlan(),
      ]);
    })();
    return()=>{active=false;};
  }, [session, loadBoms, loadStock, loadRequirements,loadSettings,synchronizeProgram,loadMonthlyPlan]);

  const canAccess = (target: string) =>
    session?.role === "admin" ||
    target === "resumen" ||
    (session?.permissions ?? "").split(",").includes(target);
  const askAssistant = async (question: string) => {
    const clean = question.trim();
    if (!clean||chatLoading) return;
    const dateTime=(value:string)=>{
      const parsed=new Date(value);
      return Number.isNaN(parsed.getTime())?"sin fecha disponible":new Intl.DateTimeFormat("es-AR",{dateStyle:"short",timeStyle:"short"}).format(parsed);
    };
    const context:GeneralAssistantContext={
      now:new Intl.DateTimeFormat("es-AR",{dateStyle:"full",timeStyle:"short"}).format(new Date()),
      synchronized:sourceState.live,
      fetchedAt:dateTime(sourceState.fetchedAt),
      operations:records.length,
      weeks:weeks.length,
      completedOperations:records.filter(record=>record.completed).length,
      mappedOperations:requirementState.mapped,
      blockedOperations:requirementState.blocked,
      shortages:shortages.length,
      stockItems:stock.length,
      changes:{
        added:programChange.added,
        modified:programChange.modified,
        removed:programChange.removed,
        detectedAt:programChange.detectedAt,
      },
    };
    setChatMessages(messages=>[...messages,{from:"user",text:clean}]);
    setChatInput("");
    setChatLoading(true);
    let answer=generalAssistantFallback(clean,context);
    try{
      const response=await fetch("/api/assistant",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({question:clean,context})});
      const payload=await responseJson<{answer?:string;error?:string}>(response);
      if(response.ok&&payload.answer)answer=payload.answer;
    }catch{
      // La respuesta local mantiene disponible el asistente aunque falle la IA.
    }finally{
      setChatMessages(messages=>[...messages,{from:"bot",text:answer}]);
      setChatLoading(false);
    }
  };
  const navigate = (target: string) => {
    if (!canAccess(target)) return;
    if (
      [
        "resumen",
        "programacion",
        "productos",
        "bom",
        "consumos",
        "stock",
        "faltantes",
        "compras",
        "usuarios",
      ].includes(target)
    ) {
      setView(target as View);
      if (target === "bom") void loadBoms();
      if (["consumos", "faltantes", "compras"].includes(target))
        void loadRequirements();
      if (target === "stock") void loadStock();
      if (target === "compras") void loadMonthlyPlan();
      if (target === "usuarios") void loadUsers();
    } else setView("pendiente");
  };

  if (authLoading && !session)
    return (
      <main className="login-page">
        <div className="login-card">
          <span className="brand-mark">
            <Icon name="bottle" />
          </span>
          <h1>Planificación de Insumos</h1>
          <p>Validando acceso…</p>
        </div>
      </main>
    );
  if (!session)
    return (
      <main className="login-page">
        <form
          className="login-card"
          onSubmit={(e) => {
            e.preventDefault();
            void login();
          }}
        >
          <span className="brand-mark">
            <Icon name="bottle" />
          </span>
          <p className="eyebrow">ERP de Bodega</p>
          <h1>Iniciar sesión</h1>
          <p>Ingresá con el usuario asignado por el administrador.</p>
          <label>
            Usuario
            <input
              autoFocus
              value={loginDraft.username}
              onChange={(e) =>
                setLoginDraft({ ...loginDraft, username: e.target.value })
              }
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              value={loginDraft.password}
              onChange={(e) =>
                setLoginDraft({ ...loginDraft, password: e.target.value })
              }
            />
          </label>
          {loginError && <div className="login-error">{loginError}</div>}
          <button className="primary-button" disabled={authLoading}>
            {authLoading ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
      </main>
    );
  return (
    <main className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => setView("resumen")}
          aria-label="Ir al resumen"
        >
          <span className="brand-mark">
            <Icon name="bottle" />
          </span>
          <span>Planificación de Insumos</span>
        </button>
        <nav aria-label="Navegación principal">
          {[
            ["resumen", "Resumen"],
            ["programacion", "Programación"],
            ["productos", "Productos"],
            ["bom", "Ficha técnica"],
            ["consumos", "Consumos"],
            ["stock", "Stock"],
            ["faltantes", "Faltantes"],
            ["compras", "Compras"],
            ["usuarios", "Administración"],
          ]
            .filter(([id]) => canAccess(id))
            .map(([id, label]) => (
              <button
                key={id}
                onClick={() => navigate(id)}
                className={
                  view === id ||
                  (view === "pendiente" &&
                    !["resumen", "programacion"].includes(id))
                    ? ""
                    : ""
                }
                data-active={view === id}
              >
                {label}
                {![
                  "resumen",
                  "programacion",
                  "productos",
                  "bom",
                  "consumos",
                  "stock",
                  "faltantes",
                  "compras",
                  "usuarios",
                ].includes(id) && (
                  <span className="nav-lock">
                    <Icon name="lock" />
                  </span>
                )}
              </button>
            ))}
        </nav>
        <div className="sync-state">
          <span className={`pulse ${sourceState.live ? "live" : ""}`} />
          {sourceState.live ? "Sincronizado en vivo" : "Instantánea validada"}
        </div>
        <div className="profile-menu">
          <button
            className="avatar"
            aria-label="Abrir menú de usuario"
            aria-expanded={profileOpen}
            onClick={() => setProfileOpen((value) => !value)}
          >
            {session.name
              .split(/\s+/)
              .map((value) => value[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </button>
          {profileOpen && (
            <div className="profile-popover">
              <strong>{session.name}</strong>
              <span>@{session.username}</span>
              <small>
                {session.role === "admin" ? "Administrador" : "Usuario normal"}
              </small>
              <button onClick={()=>{setPasswordPanelOpen(value=>!value);setPasswordMessage("");}}>Cambiar contraseña</button>
              {passwordPanelOpen&&<div className="password-panel"><input type="password" placeholder="Contraseña actual" value={passwordDraft.current} onChange={e=>setPasswordDraft({...passwordDraft,current:e.target.value})}/><input type="password" placeholder="Nueva contraseña" value={passwordDraft.next} onChange={e=>setPasswordDraft({...passwordDraft,next:e.target.value})}/><input type="password" placeholder="Repetir nueva contraseña" value={passwordDraft.confirm} onChange={e=>setPasswordDraft({...passwordDraft,confirm:e.target.value})}/>{passwordMessage&&<small>{passwordMessage}</small>}<button onClick={()=>void changeOwnPassword()}>Guardar contraseña</button></div>}
              <button onClick={() => void logout()}>Cerrar sesión</button>
            </div>
          )}
        </div>
      </header>

      <div className="page">
        {view === "resumen" && (
          <>
            <section className="page-heading">
              <div>
                <p className="eyebrow">Google Sheets · Programación Junin</p>
                <h1>Centro de operaciones</h1>
                <p>Planificá insumos y anticipá faltantes de producción.</p>
              </div>
              <button
                className="refresh-button"
                onClick={() => void synchronizeProgram(true)}
                disabled={refreshing}
              >
                <Icon name="sync" />{" "}
                {refreshing ? "Actualizando…" : "Actualizar ahora"}
              </button>
            </section>

            {programChange.total > 0 && (
              <section className="change-banner">
                <span className="mini-icon">
                  <Icon name="sync" />
                </span>
                <button className="change-banner-link" onClick={()=>{setView("programacion");setShowChangesOnly(true);setWeekFilter(programChange.changedWeekIds.length===1?programChange.changedWeekIds[0]:"all");}}>
                <div>
                  <strong>Cambio detectado en la programación</strong>
                  <p>
                    {programChange.added} agregadas · {programChange.modified}{" "}
                    modificadas · {programChange.removed} eliminadas
                  </p>
                </div>
                </button>
                <time>
                  {new Intl.DateTimeFormat("es-AR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(programChange.detectedAt))}
                </time>
                <button
                  onClick={() =>
                    setProgramChange({
                      added: 0,
                      removed: 0,
                      modified: 0,
                      total: 0,
                      detectedAt: "",
                      changedIds: [],
                      changedWeekIds: [],
                    })
                  }
                >
                  Descartar
                </button>
              </section>
            )}

            <section className="week-timeline" aria-label="Semanas programadas">
              {weeks.map((week, index) => (
                <div className="week-segment" key={week.id}>
                  <button
                    className="week-card"
                    data-selected={selected?.id === week.id}
                    onClick={() => setSelectedWeek(week.id)}
                  >
                    <div className="week-title-row">
                      <span className="week-icon">
                        <Icon name="calendar" />
                      </span>
                      <span>
                        <strong>{week.label}</strong>
                        <small>{week.detail}</small>
                      </span>
                      <span className="week-tag">{week.status}</span>
                    </div>
                    <div className="week-metrics">
                      <span>
                        <Icon name="bottle" />
                        <strong>{formatNumber(week.fractionBottles)}</strong>
                        <small>a fraccionar</small>
                      </span>
                      <span>
                        <Icon name="clipboard" />
                        <strong>{week.operations}</strong>
                        <small>operaciones</small>
                      </span>
                      <span
                        className={week.issues ? "metric-warning" : "metric-ok"}
                      >
                        <Icon name={week.issues ? "alert" : "check"} />
                        <strong>{week.issues || "OK"}</strong>
                        <small>
                          {week.issues ? "incidencia" : "estructura"}
                        </small>
                      </span>
                    </div>
                  </button>
                  {index < weeks.length - 1 && (
                    <span className="timeline-link" />
                  )}
                </div>
              ))}
            </section>

            <section className="overview-grid">
              <div className="left-column">
                <div className="kpi-grid">
                  <article className="kpi-card">
                    <span className="kpi-icon">
                      <Icon name="bottle" />
                    </span>
                    <div>
                      <span>Fraccionamiento · {weeks.length} {weeks.length===1?"semana":"semanas"}</span>
                      <strong>{formatNumber(totalFractionBottles)}</strong>
                      <small>botellas programadas</small>
                    </div>
                  </article>
                  <article className="kpi-card">
                    <span className="kpi-icon soft">
                      <Icon name="clipboard" />
                    </span>
                    <div>
                      <span>Operaciones detectadas</span>
                      <strong>{records.length}</strong>
                      <small>
                        {actionTotals.fraccionar} fraccionar ·{" "}
                        {actionTotals.vestir} vestir · {actionTotals.encajonar}{" "}
                        encajonar
                      </small>
                    </div>
                  </article>
                </div>

                <article className="operations-card">
                  <div className="card-title">
                    <span className="mini-icon">
                      <Icon name="sheet" />
                    </span>
                    <div>
                      <h2>{selected.label}</h2>
                      <p>Desglose de operaciones reconocidas</p>
                    </div>
                  </div>
                  <div className="operation-bars">
                    {[
                      ["Fraccionar", selected.fraccionar, "primary"],
                      ["Vestir", selected.vestir, "secondary"],
                      ["Encajonar", selected.encajonar, "neutral"],
                    ].map(([label, value, tone]) => (
                      <button
                        key={String(label)}
                        onClick={() => setView("programacion")}
                        className="operation-row"
                      >
                        <span className={`operation-dot ${tone}`} />
                        <span>{label}</span>
                        <span className="bar">
                          <span
                            className={String(tone)}
                            style={{
                              width: `${selected.operations ? Math.max(4, (Number(value) / selected.operations) * 100) : 0}%`,
                            }}
                          />
                        </span>
                        <strong>{value}</strong>
                      </button>
                    ))}
                  </div>
                </article>
              </div>

              <article className="readiness-card">
                <div className="readiness-heading">
                  <span className="cart-symbol">
                    <Icon name="alert" />
                  </span>
                  <div>
                    <h2>
                      {requirementState.loading
                        ? "Calculando compras…"
                        : `${shortages.length} insumos requieren compra`}
                    </h2>
                    <p>
                      {requirementState.loading
                        ? "Actualizando fichas técnicas, stock y programa."
                        : `${requirementState.mapped} operaciones calculadas con el programa vigente.`}
                    </p>
                  </div>
                </div>
                <div className="readiness-steps">
                  <div className="ready">
                    <span>1</span>
                    <div>
                      <strong>Programa de producción</strong>
                      <small>{records.length} operaciones reconocidas</small>
                    </div>
                    <Icon name="check" />
                  </div>
                  <div className={requirementState.mapped > 0 ? "ready" : ""}>
                    <span>2</span>
                    <div>
                      <strong>Fichas técnicas</strong>
                      <small>
                        {bomProducts.length} aprobadas ·{" "}
                        {requirementState.provisional} provisionales del Sheet
                      </small>
                    </div>
                    <Icon
                      name={requirementState.mapped > 0 ? "check" : "lock"}
                    />
                  </div>
                  <div className={stock.length > 0 ? "ready" : ""}>
                    <span>3</span>
                    <div>
                      <strong>Stock disponible</strong>
                      <small>
                        {stock.length
                          ? `${stock.length} insumos con existencia cargada`
                          : "Pendiente de carga inicial"}
                      </small>
                    </div>
                    <Icon name={stock.length > 0 ? "check" : "lock"} />
                  </div>
                </div>
                <div className="honest-state">
                  <strong>
                    {shortages.length ? "Reporte disponible" : "Estado actual"}
                  </strong>
                  <p>
                    {shortages.length
                      ? `Hay ${shortages.length} materiales con faltante. Abrí Compras para verlos agrupados por tipo de insumo.`
                      : requirements.length
                        ? "El stock disponible cubre las necesidades calculadas del programa."
                        : "Todavía faltan datos para calcular compras."}
                  </p>
                </div>
                <button
                  className="primary-button"
                  onClick={() => {
                    setView(shortages.length ? "compras" : "programacion");
                    if (shortages.length) void loadRequirements();
                  }}
                >
                  {shortages.length
                    ? "Ver reporte de compras"
                    : "Validar programación"}
                </button>
              </article>
            </section>

            <section className="diagnostic-strip">
              <div>
                <span className="status-dot error" />
                <strong>
                  {missingCodeRecords.length} dato requiere revisión
                </strong>
                <small>Semana tentativa · producto sin código</small>
              </div>
              <button onClick={() => setView("programacion")}>
                Ver diagnóstico completo <span>→</span>
              </button>
            </section>
          </>
        )}

        {view === "programacion" && (
          <section className="program-view">
            <div className="page-heading compact">
              <div>
                <p className="eyebrow">Prioridad 1 · Importador diagnóstico</p>
                <h1>Programación reconocida</h1>
                <p>
                  Cada registro conserva su semana, línea, operación y fila de
                  origen.
                </p>
              </div>
              <button
                className="refresh-button"
                onClick={() => setView("resumen")}
              >
                ← Volver al resumen
              </button>
            </div>
            {programChange.total > 0 && (
              <div className="change-banner">
                <span className="mini-icon">
                  <Icon name="sync" />
                </span>
                <div>
                  <strong>Último cambio detectado</strong>
                  <p>
                    {programChange.added} agregadas · {programChange.modified}{" "}
                    modificadas · {programChange.removed} eliminadas
                  </p>
                </div>
                <time>
                  {new Intl.DateTimeFormat("es-AR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(programChange.detectedAt))}
                </time>
              </div>
            )}
            <div className="diagnostic-cards">
              <article>
                <span className="ok-icon">
                  <Icon name="check" />
                </span>
                <div>
                  <strong>3 pestañas semanales</strong>
                  <small>Actual, próxima y tentativa</small>
                </div>
              </article>
              <article>
                <span className="ok-icon">
                  <Icon name="check" />
                </span>
                <div>
                  <strong>4 secciones por semana</strong>
                  <small>Líneas 1, 2, 3 y tareas manuales</small>
                </div>
              </article>
              <article className="warning-card">
                <span>
                  <Icon name="alert" />
                </span>
                <div>
                  <strong>
                    {missingCodeRecords.length} incidencia crítica
                  </strong>
                  <small>Impide relacionar una fila con su ficha técnica</small>
                </div>
              </article>
            </div>
            <div className="program-layout">
              <article className="table-card">
                <div
                  className={`source-banner ${sourceState.live ? "live" : "snapshot"}`}
                >
                  <span className="pulse" />
                  <div>
                    <strong>
                      {sourceState.live
                        ? "Conexión automática activa"
                        : "Modo de validación"}
                    </strong>
                    <p>{sourceState.notice}</p>
                  </div>
                  <button
                    onClick={() => void synchronizeProgram(true)}
                    disabled={refreshing}
                  >
                    {refreshing ? "Actualizando…" : "Actualizar"}
                  </button>
                </div>
                <div className="table-toolbar">
                  <div>
                    <h2>{records.length} filas interpretadas</h2>
                    <p>
                      {sourceState.live
                        ? "Última sincronización"
                        : "Instantánea validada"}{" "}
                      el{" "}
                      {new Intl.DateTimeFormat("es-AR", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(sourceState.fetchedAt))}
                      .
                    </p>
                  </div>
                  <label className="search-box">
                    <Icon name="search" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Buscar código, marca o variedad"
                    />
                  </label>
                </div>
                <div className="filter-row">
                  {showChangesOnly&&<button className="changes-filter" onClick={()=>setShowChangesOnly(false)}>Cambios detectados ×</button>}
                  <label>
                    Semana
                    <select
                      value={weekFilter}
                      onChange={(event) => setWeekFilter(event.target.value)}
                    >
                      <option value="all">Todas</option>
                      {weeks.map((week) => (
                        <option key={week.id} value={week.id}>
                          {week.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Acción
                    <select
                      value={actionFilter}
                      onChange={(event) => setActionFilter(event.target.value)}
                    >
                      <option value="all">Todas</option>
                      <option value="FRACCIONAR">Fraccionar</option>
                      <option value="VESTIR">Vestir</option>
                      <option value="ENCAJONAR">Encajonar</option>
                    </select>
                  </label>
                  <label>
                    Sector
                    <select
                      value={lineFilter}
                      onChange={(event) => setLineFilter(event.target.value)}
                    >
                      <option value="all">Todos</option>
                      <option value="linea-1">Línea 1</option>
                      <option value="linea-2">Línea 2</option>
                      <option value="linea-3">Línea 3</option>
                      <option value="tareas-manuales">Tareas manuales</option>
                    </select>
                  </label>
                  <span className="table-summary">
                    {filteredRows.length} resultados
                  </span>
                </div>
                <div className="sheet-program">
                  {groupedProgramRows.map(({ week, lines }) => (
                    <section className="sheet-week" key={week.id}>
                      <header>
                        <div>
                          <strong>SEMANA {week.label}</strong>
                          <span>
                            {week.status} ·{" "}
                            {lines.reduce(
                              (sum, line) => sum + line.rows.length,
                              0,
                            )}{" "}
                            operaciones
                          </span>
                        </div>
                      </header>
                      {lines.map(({ line, rows }) => (
                        <div className="sheet-line" key={line}>
                          <h3>{lineLabel(line)}</h3>
                          <div className="table-scroll">
                            <table>
                              <thead>
                                <tr>
                                  {[
                                    "Día",
                                    "Acción",
                                    "PIN",
                                    "Código",
                                    "Marca",
                                    "Variedad",
                                    "Año",
                                    "Cap.",
                                    "Cierre",
                                    "Litros",
                                    "Cliente",
                                    "País",
                                    "Cajas",
                                    "U/C",
                                    "Botellas",
                                    "Botella",
                                    "Tapón",
                                    "Cápsula/Tapa",
                                    "Caja",
                                    "Etiqueta frente",
                                    "Contraetiqueta",
                                    "Observaciones",
                                  ].map((head) => (
                                    <th key={head}>{head}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((record) => (
                                  <tr
                                    key={record.id}
                                    data-warning={!record.productCode}
                                    data-completed={record.completed||undefined}
                                  >
                                    <td>{record.dateLabel || "—"}</td>
                                    <td>
                                      <span
                                        className={`action-badge ${record.action.toLowerCase()}`}
                                      >
                                        {record.action}
                                      </span>
                                      {record.completed&&<span className="completed-badge">REALIZADO</span>}
                                    </td>
                                    <td>{record.pin || "—"}</td>
                                    <td className="number-cell">
                                      {record.productCode || "Sin código"}
                                    </td>
                                    <td>{record.brand || "—"}</td>
                                    <td>{record.variety || "—"}</td>
                                    <td>{record.vintage || "—"}</td>
                                    <td>{record.capacity || "—"}</td>
                                    <td>{record.closure || "—"}</td>
                                    <td>{record.liters || "—"}</td>
                                    <td>{record.client || "—"}</td>
                                    <td>{record.country || "—"}</td>
                                    <td>{record.cases || "—"}</td>
                                    <td>{record.unitsPerCase || "—"}</td>
                                    <td className="number-cell">
                                      {formatNumber(record.bottles)}
                                    </td>
                                    <td className="material-cell">
                                      {record.materials.bottle || "—"}
                                    </td>
                                    <td className="material-cell">
                                      {record.materials.closure || "—"}
                                    </td>
                                    <td className="material-cell">
                                      {record.materials.capsuleOrCap || "—"}
                                    </td>
                                    <td className="material-cell">
                                      {record.materials.case || "—"}
                                    </td>
                                    <td className="material-cell">
                                      {record.materials.frontLabel || "—"}
                                    </td>
                                    <td className="material-cell">
                                      {record.materials.backLabel || "—"}
                                    </td>
                                    <td className="notes-cell">
                                      {record.notes || "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              </article>
              <aside className="issues-card">
                <div className="card-title">
                  <span className="mini-icon warning">
                    <Icon name="alert" />
                  </span>
                  <div>
                    <h2>Diagnóstico</h2>
                    <p>Controles previos al cálculo</p>
                  </div>
                </div>
                {missingCodeRecords.map((record) => (
                  <div className="issue error" key={record.id}>
                    <span className="status-dot error" />
                    <div>
                      <strong>Producto sin código</strong>
                      <p>
                        {record.brand} · {record.variety} {record.vintage} ·{" "}
                        {formatNumber(record.bottles)} botellas
                      </p>
                      <small>
                        {record.weekLabel} · {lineLabel(record.line)} · fila{" "}
                        {record.sourceRow}
                      </small>
                    </div>
                  </div>
                ))}
                <div className="issue info">
                  <span className="status-dot info" />
                  <div>
                    <strong>Códigos de insumos todavía incompletos</strong>
                    <p>
                      Se resolverán con la ficha técnica del ERP, sin depender de la carga
                      tardía del Sheet.
                    </p>
                    <small>
                      {withoutEmbeddedMaterials.length} operaciones sin
                      referencia embebida
                    </small>
                  </div>
                </div>
                <div className="source-note">
                  <strong>Regla de importación</strong>
                  <p>
                    Las filas se reconocen por encabezados y acción, no por
                    posiciones fijas. Así, insertar filas en el Sheet no rompe
                    la lectura.
                  </p>
                </div>
              </aside>
            </div>
          </section>
        )}

        {view === "productos" && (
          <section className="program-view">
            <div className="page-heading compact">
              <div>
                <p className="eyebrow">
                  Prioridad 3 · Interpretación automática
                </p>
                <h1>Productos programados</h1>
                <p>
                  Maestro temporal construido directamente desde las operaciones
                  del Sheet.
                </p>
              </div>
              <button
                className="refresh-button"
                onClick={() => void synchronizeProgram(true)}
              >
                {refreshing ? "Actualizando…" : "Actualizar"}
              </button>
            </div>
            <div className="diagnostic-cards">
              <article>
                <span className="ok-icon">
                  <Icon name="check" />
                </span>
                <div>
                  <strong>{productReport.length} códigos únicos</strong>
                  <small>Detectados en las semanas visibles</small>
                </div>
              </article>
              <article>
                <span className="ok-icon">
                  <Icon name="clipboard" />
                </span>
                <div>
                  <strong>
                    {productReport.filter((item) => !item.inconsistent).length}{" "}
                    productos consistentes
                  </strong>
                  <small>Misma descripción para el mismo código</small>
                </div>
              </article>
              <article
                className={
                  productReport.some((item) => item.inconsistent)
                    ? "warning-card"
                    : ""
                }
              >
                <span>
                  <Icon
                    name={
                      productReport.some((item) => item.inconsistent)
                        ? "alert"
                        : "check"
                    }
                  />
                </span>
                <div>
                  <strong>
                    {productReport.filter((item) => item.inconsistent).length}{" "}
                    conflictos
                  </strong>
                  <small>Códigos usados con descripciones distintas</small>
                </div>
              </article>
            </div>
            <article className="table-card">
              <div className="table-toolbar">
                <div>
                  <h2>Catálogo reconocido</h2>
                  <p>No modifica ni reemplaza la fuente original.</p>
                </div>
                <label className="search-box">
                  <Icon name="search" />
                  <input
                    value={productQuery}
                    onChange={(event) => setProductQuery(event.target.value)}
                    placeholder="Buscar código, marca o variedad"
                  />
                </label>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Descripción interpretada</th>
                      <th>Operaciones</th>
                      <th>Semanas</th>
                      <th>Botellas involucradas</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProducts.map((product) => (
                      <tr
                        key={product.code}
                        data-warning={product.inconsistent}
                      >
                        <td className="number-cell">{product.code}</td>
                        <td className="record-product">
                          <strong>{product.description}</strong>
                          {product.inconsistent && (
                            <span>{product.descriptions.join(" / ")}</span>
                          )}
                        </td>
                        <td>{product.operations.join(" · ")}</td>
                        <td>{product.weeks.join(" · ")}</td>
                        <td className="number-cell">
                          {formatNumber(product.bottles)}
                        </td>
                        <td>
                          <span
                            className={`row-status ${product.inconsistent ? "review" : "valid"}`}
                          >
                            {product.inconsistent ? "Revisar" : "Consistente"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pagination">
                <span>{visibleProducts.length} productos mostrados</span>
              </div>
            </article>
          </section>
        )}

        {view === "bom" && (
          <section className="bom-view">
            <div className="page-heading compact">
              <div>
                <p className="eyebrow">Prioridad 4 · Fichas técnicas</p>
                <h1>Fichas técnicas</h1>
                <p>
                  Definí qué consume cada producto según la operación
                  programada.
                </p>
              </div>
              <button
                className="refresh-button"
                onClick={() => void loadBoms()}
              >
                {bomLoading ? "Actualizando…" : "Actualizar"}
              </button>
            </div>
            <div className="bom-kpis">
              <article>
                <strong>{programmedProducts.length}</strong>
                <span>productos programados</span>
              </article>
              <article>
                <strong>{bomProducts.length}</strong>
                <span>fichas aprobadas</span>
              </article>
              <article>
                <strong>{productsWithSheetMaterials.length}</strong>
                <span>productos con insumos en Sheet</span>
              </article>
            </div>
            <div className="bom-layout">
              <article className="table-card">
                <div className="table-toolbar">
                  <div>
                    <h2>Cobertura del programa</h2>
                    <p>
                      {visibleBomProducts.length} de {programmedProducts.length}{" "}
                      productos
                    </p>
                  </div>
                  <label className="search-box">
                    <Icon name="search" />
                    <input
                      value={bomQuery}
                      onChange={(e) => setBomQuery(e.target.value)}
                      placeholder="Buscar código o producto"
                    />
                  </label>
                </div>
                <div className="bom-product-list">
                  {visibleBomProducts.map((product) => {
                    const saved = bomProducts.find(
                        (item) => item.code === product.code,
                      ),
                      suggested = suggestBomFromProgram(records, product.code);
                    return (
                      <button
                        key={product.code}
                        onClick={() => {
                          setBomMessage(
                            saved
                              ? ""
                              : "Borrador precargado desde el Sheet. Revisalo antes de guardar.",
                          );
                          setBomDraft(
                            saved
                              ? {
                                  code: saved.code,
                                  name: saved.name,
                                  items: saved.items.map((item) => ({
                                    ...item,
                                    substitutes: item.substitutes ?? [],
                                  })),
                                }
                              : {
                                  code: product.code,
                                  name: product.name,
                                  items: suggested.items.length
                                    ? suggested.items
                                    : [emptyBomItem()],
                                },
                          );
                        }}
                      >
                        <span>
                          <strong>{product.code}</strong>
                          <small>{product.name}</small>
                        </span>
                        <span
                          className={`row-status ${saved ? "valid" : "review"}`}
                        >
                          {saved
                            ? `${saved.items.length} insumos aprobados`
                            : suggested.items.length
                              ? `${suggested.items.length} del Sheet`
                              : "Sin insumos"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </article>
              <article className="table-card">
                <div className="table-toolbar">
                  <div>
                    <h2>
                      {bomDraft.code
                        ? `Ficha ${bomDraft.code}`
                        : "Nueva ficha técnica"}
                    </h2>
                    <p>El consumo se expresa por botella o unidad producida.</p>
                  </div>
                </div>
                <div className="bom-form">
                  <div className="bom-fields">
                    <label>
                      Código de producto
                      <input
                        list="product-codes"
                        value={bomDraft.code}
                        onChange={(event) => {
                          const match = programmedProducts.find(
                            (product) => product.code === event.target.value,
                          );
                          setBomDraft((draft) => ({
                            ...draft,
                            code: event.target.value,
                            name: match?.name ?? draft.name,
                          }));
                        }}
                      />
                      <datalist id="product-codes">
                        {programmedProducts.map((product) => (
                          <option key={product.code} value={product.code}>
                            {product.name}
                          </option>
                        ))}
                      </datalist>
                    </label>
                    <label>
                      Descripción
                      <input
                        value={bomDraft.name}
                        onChange={(event) =>
                          setBomDraft((draft) => ({
                            ...draft,
                            name: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  {bomDraft.code && (
                    <div className="sheet-suggestion">
                      <div>
                        <strong>Insumos detectados en Google Sheets</strong>
                        <p>
                          {bomSuggestion.items.length
                            ? `${bomSuggestion.items.length} referencias informadas en ${bomSuggestion.populatedRows} de ${bomSuggestion.sourceRows} operaciones del producto.`
                            : "Todavía no hay insumos informados para este producto."}
                        </p>
                        {!bomSuggestion.complete &&
                          bomSuggestion.sourceRows > 0 && (
                            <small>
                              Información parcial: el Sheet se sigue completando
                              durante la semana.
                            </small>
                          )}
                      </div>
                      <button
                        disabled={!bomSuggestion.items.length}
                        onClick={applySheetMaterials}
                      >
                        Agregar desde Sheet
                      </button>
                    </div>
                  )}
                  <div className="bom-items">
                    <div className="bom-item-head">
                      <strong>Insumos</strong>
                      <button
                        onClick={() =>
                          setBomDraft((draft) => ({
                            ...draft,
                            items: [...draft.items, emptyBomItem()],
                          }))
                        }
                      >
                        + Agregar insumo
                      </button>
                    </div>
                    {bomDraft.items.map((item, index) => (
                      <div className="bom-item" key={index}>
                        <label>
                          Tipo
                          <select
                            value={item.category}
                            onChange={(event) =>
                              updateBomItem(index, {
                                category: event.target.value,
                              })
                            }
                          >
                            {[
                              "Botellas",
                              "Tapones",
                              "Cápsulas",
                              "Etiquetas",
                              "Cajas",
                              "Separadores",
                              "Corchos",
                              "Otros",
                            ].map((value) => (
                              <option key={value}>{value}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Código
                          <input
                            value={item.materialCode}
                            onChange={(event) =>
                              updateBomItem(index, {
                                materialCode: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Descripción
                          <input
                            value={item.materialName}
                            onChange={(event) =>
                              updateBomItem(index, {
                                materialName: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Consumo
                          <input
                            type="number"
                            min="0.000001"
                            step="0.000001"
                            value={item.quantity}
                            onChange={(event) =>
                              updateBomItem(index, {
                                quantity: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          Operación
                          <select
                            value={item.action}
                            onChange={(event) =>
                              updateBomItem(index, {
                                action: event.target.value,
                              })
                            }
                          >
                            <option>FRACCIONAR</option>
                            <option>VESTIR</option>
                            <option>ENCAJONAR</option>
                          </select>
                        </label>
                        <label className="substitute-field">
                          Sustitutos autorizados
                          <input
                            placeholder="20391, 20397"
                            value={item.substitutes.join(", ")}
                            onChange={(event) =>
                              updateBomItem(index, {
                                substitutes: event.target.value
                                  .split(",")
                                  .map((value) => value.trim()),
                              })
                            }
                          />
                        </label>
                        <button
                          className="remove-item"
                          aria-label="Eliminar insumo"
                          onClick={() =>
                            setBomDraft((draft) => ({
                              ...draft,
                              items: draft.items.filter(
                                (_, itemIndex) => itemIndex !== index,
                              ),
                            }))
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  {bomMessage && <p className="bom-message">{bomMessage}</p>}
                  <button
                    className="primary-button bom-save"
                    disabled={bomLoading}
                    onClick={() => void saveBom()}
                  >
                    {bomLoading ? "Guardando…" : "Guardar ficha técnica"}
                  </button>
                </div>
              </article>
            </div>
          </section>
        )}

        {(view === "consumos" ||
          (view === "compras" && purchaseMode === "monthly")) && (
          <section className="consumption-view">
            <div className="page-heading compact">
              <div>
                <p className="eyebrow">
                  {view === "compras"
                    ? "Planificación mensual"
                    : "Prioridad 5 · Motor de cálculo"}
                </p>
                <h1>
                  {view === "compras"
                    ? "Análisis mensual de compras"
                    : "Consumo de insumos"}
                </h1>
                <p>
                  {view === "compras"
                    ? "Estimado, stock, pendiente y saldo de compra en un solo lugar."
                    : "Demanda calculada desde el programa vigente y las fichas técnicas aprobadas."}
                </p>
              </div>
              <button
                className="refresh-button"
                onClick={() =>
                  view === "compras" && purchaseMode === "monthly"
                    ? void loadMonthlyPlan()
                    : void loadRequirements()
                }
              >
                {view === "compras" && purchaseMode === "monthly"
                  ? monthlyState.loading
                    ? "Actualizando…"
                    : "Actualizar análisis"
                  : requirementState.loading
                    ? "Calculando…"
                    : "Recalcular"}
              </button>
            </div>
            {view === "compras" && (
              <nav className="purchase-mode-tabs" aria-label="Tipo de análisis de compras">
                <button
                  data-active={purchaseMode === "weekly"}
                  onClick={() => setPurchaseMode("weekly")}
                >
                  Programa semanal
                </button>
                <button
                  data-active={purchaseMode === "monthly"}
                  onClick={() => {
                    setPurchaseMode("monthly");
                    void loadMonthlyPlan();
                  }}
                >
                  Análisis mensual
                </button>
              </nav>
            )}
            {view === "compras" && purchaseMode === "monthly" ? (
              <div className="monthly-purchase-view">
                <article className="monthly-import-card">
                  <div>
                    <p className="eyebrow">Fuente del análisis</p>
                    <h2>
                      {monthlyPlan
                        ? `${monthlyPlan.periodLabel} · ${monthlyPlan.fileName}`
                        : "Cargar estimado, stock y pendiente"}
                    </h2>
                    <p>
                      Podés elegir un libro consolidado o varios archivos. La
                      necesidad sale del ESTIMADO, el ingreso pendiente se toma
                      exclusivamente de C.por D./E. y la hoja ANALISIS es
                      opcional: solo se usa para controlar diferencias.
                    </p>
                    {monthlyPlan && (
                      <small>
                        Guardado por {monthlyPlan.importedBy} el{" "}
                        {new Intl.DateTimeFormat("es-AR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(new Date(monthlyPlan.importedAt))}
                      </small>
                    )}
                  </div>
                  <div className="monthly-import-actions">
                    <input
                      ref={monthlyFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      multiple
                      hidden
                      onChange={(event) =>
                        void selectMonthlyFiles(event.target.files)
                      }
                    />
                    <button
                      className="secondary-button"
                      disabled={monthlyState.loading}
                      onClick={() => monthlyFileRef.current?.click()}
                    >
                      Cargar archivo(s)
                    </button>
                    <button
                      className="secondary-button"
                      disabled={monthlyState.loading}
                      onClick={clearMonthlySources}
                    >
                      Limpiar fuentes
                    </button>
                    {monthlyPlan && (
                      <button
                        className="export-button"
                        onClick={() => void exportMonthlyPlan()}
                      >
                        Exportar análisis
                      </button>
                    )}
                  </div>
                </article>

                <div className="monthly-source-grid">
                  {([
                    ["estimate", "ESTIMADO", "Obligatorio"],
                    ["stock", "STOCK", "Obligatorio"],
                    ["pending", "PENDIENTE", "Obligatorio"],
                    ["analysis", "ANALISIS", "Opcional · comparación"],
                  ] as Array<
                    [MonthlyPurchaseSourceKind, string, string]
                  >).map(([kind, label, detail]) => {
                    const temporaryFile = monthlySources.files[kind];
                    const savedFile = monthlyPlan?.sourceFiles?.[kind];
                    const fileName = temporaryFile || savedFile;
                    return (
                      <article
                        key={kind}
                        data-ready={Boolean(temporaryFile)}
                        data-saved={!temporaryFile && Boolean(savedFile)}
                      >
                        <span>{label}</span>
                        <strong>
                          {temporaryFile
                            ? "Listo para calcular"
                            : savedFile
                              ? "Usado en el cálculo guardado"
                              : "Sin cargar"}
                        </strong>
                        <small>{fileName || detail}</small>
                      </article>
                    );
                  })}
                </div>

                <article className="monthly-calculation-controls">
                  <label>
                    <span>Redondear compra a múltiplos de</span>
                    <select
                      value={monthlyRounding}
                      onChange={(event) =>
                        setMonthlyRounding(Number(event.target.value))
                      }
                    >
                      <option value={1}>Sin redondeo</option>
                      <option value={100}>100</option>
                      <option value={1000}>1.000</option>
                      <option value={10000}>10.000</option>
                    </select>
                  </label>
                  <div>
                    <small>
                      El faltante exacto se conserva; solo la compra final se
                      redondea hacia arriba.
                    </small>
                    <button
                      className="primary-button"
                      disabled={
                        monthlyState.loading ||
                        !monthlySources.sheets.estimate ||
                        !monthlySources.sheets.stock ||
                        !monthlySources.sheets.pending
                      }
                      onClick={recalculateMonthlyDraft}
                    >
                      {monthlyState.loading
                        ? "Calculando…"
                        : "Calcular nuevamente"}
                    </button>
                  </div>
                </article>

                {monthlyDraft && (
                  <article className="monthly-preview">
                    <div>
                      <strong>{monthlyDraft.periodLabel}</strong>
                      <span>
                        {monthlyDraft.estimates.length} productos ·{" "}
                        {monthlyDraft.analysis.length} insumos analizados ·{" "}
                        {monthlyDraft.sourceCounts.stockRows} filas de stock ·{" "}
                        {monthlyDraft.sourceCounts.pendingRows} filas pendientes ·
                        compra redondeada a{" "}
                        {formatNumber(monthlyDraft.roundingMultiple)}
                      </span>
                    </div>
                    <button
                      className="primary-button"
                      disabled={monthlyState.loading}
                      onClick={() => void saveMonthlyPlan()}
                    >
                      {monthlyState.loading ? "Guardando…" : "Guardar para todos"}
                    </button>
                  </article>
                )}
                {monthlyState.message && (
                  <p className="bom-message">{monthlyState.message}</p>
                )}
                {monthlyState.error && (
                  <p className="bom-message consumption-error">
                    {monthlyState.error}
                  </p>
                )}
                {(monthlyDraft?.warnings ?? monthlyPlan?.warnings ?? []).length >
                  0 && (
                  <article className="monthly-warning-list">
                    <strong>Controles que requieren atención</strong>
                    <ul>
                      {(monthlyDraft?.warnings ?? monthlyPlan?.warnings ?? []).map(
                        (warning, index) => (
                          <li key={`${warning}-${index}`}>{warning}</li>
                        ),
                      )}
                    </ul>
                  </article>
                )}

                {!monthlyPlan ? (
                  <article className="empty-consumption">
                    <h2>Todavía no hay un análisis mensual compartido</h2>
                    <p>
                      Cargá ESTIMADO, STOCK y PENDIENTE juntos o por separado.
                      Antes de guardarlo se mostrará cuántos productos e insumos
                      fueron reconocidos.
                    </p>
                  </article>
                ) : (
                  <>
                    <div className="monthly-kpis">
                      <article>
                        <strong>{monthlyPlan.estimates.length}</strong>
                        <span>productos estimados</span>
                      </article>
                      <article>
                        <strong>
                          {formatNumber(
                            monthlyPlan.estimates.reduce(
                              (sum, item) => sum + item.totalBottles,
                              0,
                            ),
                          )}
                        </strong>
                        <span>botellas estimadas</span>
                      </article>
                      <article data-warning={monthlyShortages.length > 0}>
                        <strong>{monthlyShortages.length}</strong>
                        <span>insumos con saldo negativo</span>
                      </article>
                      <article data-warning={monthlyShortages.length > 0}>
                        <strong>
                          {formatNumber(
                            monthlyShortages.reduce(
                              (sum, item) => sum + item.toBuy,
                              0,
                            ),
                          )}
                        </strong>
                        <span>
                          unidades a comprar, redondeadas a{" "}
                          {formatNumber(monthlyPlan.roundingMultiple)}
                        </span>
                      </article>
                    </div>

                    {monthlyPlan.sourceCounts.analysisRows > 0 && (
                      <p
                        className={`monthly-comparison-summary ${
                          monthlyComparisonDifferences.length
                            ? "has-differences"
                            : ""
                        }`}
                      >
                        {monthlyComparisonDifferences.length
                          ? `${monthlyComparisonDifferences.length} insumos difieren del ANALISIS anterior. La tabla muestra el desvío para revisarlos.`
                          : "El cálculo automático coincide con el ANALISIS anterior en los insumos comparados."}
                      </p>
                    )}

                    <div className="monthly-months">
                      {monthlySummaries.map((month) => (
                        <article key={month.key}>
                          <span>{month.label}</span>
                          <strong>{formatNumber(month.boxes)} cajas</strong>
                          <small>{formatNumber(month.bottles)} botellas</small>
                        </article>
                      ))}
                    </div>

                    <article className="table-card">
                      <div className="table-toolbar">
                        <div>
                          <h2>Análisis automático de compra</h2>
                          <p>
                            El faltante exacto se transforma en una compra
                            positiva redondeada hacia arriba.
                          </p>
                        </div>
                        <label className="search-box">
                          <Icon name="search" />
                          <input
                            value={monthlyQuery}
                            onChange={(event) => setMonthlyQuery(event.target.value)}
                            placeholder="Buscar código o descripción"
                          />
                        </label>
                      </div>
                      <div className="monthly-formula">
                        <span>Stock</span>
                        <b>+</b>
                        <span>Pendiente</span>
                        <b>−</b>
                        <span>Necesidad</span>
                        <b>=</b>
                        <strong>Saldo</strong>
                        <b>→</b>
                        <span>Faltante exacto</span>
                        <b>→</b>
                        <strong>
                          Compra × {formatNumber(monthlyPlan.roundingMultiple)}
                        </strong>
                      </div>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Código</th>
                              <th>Descripción</th>
                              <th>Stock</th>
                              <th>Pendiente</th>
                              <th>Necesidad</th>
                              <th>Saldo</th>
                              <th>Faltante exacto</th>
                              <th>Compra redondeada</th>
                              {monthlyPlan.sourceCounts.analysisRows > 0 && (
                                <th>Control vs. ANALISIS</th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {monthlyAnalysis.map((item) => (
                              <tr
                                key={item.materialCode}
                                data-warning={item.toBuy > 0}
                              >
                                <td className="number-cell">{item.materialCode}</td>
                                <td>
                                  {item.description}
                                  {item.note && (
                                    <small className="cell-detail">{item.note}</small>
                                  )}
                                </td>
                                <td>{formatNumber(item.stock)}</td>
                                <td>{formatNumber(item.pending)}</td>
                                <td>{formatNumber(item.necessity)}</td>
                                <td className={item.balance < 0 ? "negative-balance" : "positive-balance"}>
                                  {formatNumber(item.balance)}
                                </td>
                                <td className={item.exactShortage > 0 ? "negative-balance" : "positive-balance"}>
                                  {item.exactShortage > 0
                                    ? formatNumber(item.exactShortage)
                                    : "—"}
                                </td>
                                <td className="number-cell purchase-quantity">
                                  {item.toBuy > 0 ? formatNumber(item.toBuy) : "—"}
                                </td>
                                {monthlyPlan.sourceCounts.analysisRows > 0 && (
                                  <td>
                                    {!item.comparison
                                      ? "Sin código comparable"
                                      : Math.abs(
                                            item.comparison.shortageDifference,
                                          ) <= 0.01
                                        ? "Coincide"
                                        : `Δ ${formatNumber(
                                            item.comparison.shortageDifference,
                                          )}`}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </article>

                    <article className="table-card">
                      <div className="table-toolbar">
                        <div>
                          <h2>Estimado por producto y mes</h2>
                          <p>
                            Presentación, cajas, botellas y códigos de insumos
                            tomados del archivo.
                          </p>
                        </div>
                      </div>
                      <div className="table-scroll">
                        <table className="monthly-estimate-table">
                          <thead>
                            <tr>
                              <th>Código</th>
                              <th>Producto</th>
                              <th>Presentación</th>
                              {monthlySummaries.map((month) => (
                                <th key={month.key}>{month.label}</th>
                              ))}
                              <th>Total cajas</th>
                              <th>Total botellas</th>
                              <th>Botella</th>
                              <th>Cierre</th>
                              <th>Cápsula</th>
                              <th>Caja</th>
                            </tr>
                          </thead>
                          <tbody>
                            {monthlyPlan.estimates.map((item) => (
                              <tr key={item.productCode}>
                                <td className="number-cell">{item.productCode}</td>
                                <td>{item.description}</td>
                                <td>{formatNumber(item.presentation)}</td>
                                {monthlySummaries.map((month) => (
                                  <td key={month.key}>
                                    {formatNumber(
                                      item.months.find(
                                        (value) => value.key === month.key,
                                      )?.boxes ?? 0,
                                    )}
                                  </td>
                                ))}
                                <td>{formatNumber(item.totalBoxes)}</td>
                                <td>{formatNumber(item.totalBottles)}</td>
                                <td>{item.materials.bottle || "—"}</td>
                                <td>
                                  {item.materials.cork ||
                                    item.materials.cap ||
                                    "—"}
                                </td>
                                <td>{item.materials.capsule || "—"}</td>
                                <td>{item.materials.box || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </article>
                  </>
                )}
              </div>
            ) : (
              <>
            <div className="bom-kpis">
              <article>
                <strong>{requirementState.mapped}</strong>
                <span>operaciones con ficha técnica</span>
              </article>
              <article data-warning={requirementState.blocked > 0}>
                <strong>{requirementState.blocked}</strong>
                <span>operaciones bloqueadas</span>
              </article>
              <article>
                <strong>{requirements.length}</strong>
                <span>insumos calculados</span>
              </article>
            </div>
            {requirementState.completed>0&&<p className="bom-message">{requirementState.completed} operaciones tachadas en Google Sheets se muestran como realizadas y fueron excluidas del consumo.</p>}
            {requirementState.error && (
              <p className="bom-message consumption-error">
                {requirementState.error}
              </p>
            )}
            {!requirementState.loading && requirements.length === 0 ? (
              <article className="empty-consumption">
                <span className="gated-icon">
                  <Icon name="clipboard" />
                </span>
                <h2>Esperando fichas técnicas</h2>
                <p>
                  El motor está listo. Cargá al menos una ficha técnica para comenzar a
                  calcular consumos reales; no se generan valores estimados.
                </p>
                <button
                  className="primary-button"
                  onClick={() => {
                    setView("bom");
                    void loadBoms();
                  }}
                >
                  Cargar primera ficha
                </button>
              </article>
            ) : (
              <article className="table-card">
                <div className="table-toolbar">
                  <div>
                    <h2>Necesidad bruta por insumo</h2>
                    <p>
                      {visibleRequirements.length} de {requirements.length}{" "}
                      insumos
                    </p>
                  </div>
                  <label className="search-box">
                    <Icon name="search" />
                    <input
                      value={requirementQuery}
                      onChange={(e) => setRequirementQuery(e.target.value)}
                      placeholder="Buscar insumo, producto o semana"
                    />
                  </label>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Tipo</th>
                        <th>Insumo</th>
                        <th>Consumo total</th>
                        <th>Semanas</th>
                        <th>Productos</th>
                        <th>Sustitutos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRequirements.map((item) => (
                        <tr key={`${item.materialCode}-${item.unit}`}>
                          <td>{item.category}</td>
                          <td className="record-product">
                            <strong>{item.materialCode}</strong>
                            <span>{item.materialName}</span>
                          </td>
                          <td className="number-cell">
                            {formatNumber(item.total)} {item.unit}
                          </td>
                          <td>
                            {item.weeks
                              .map(
                                (week) =>
                                  `${week.weekLabel}: ${formatNumber(week.quantity)}`,
                              )
                              .join(" · ")}
                          </td>
                          <td>{item.products.length}</td>
                          <td>{item.substitutes.join(", ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            )}
              </>
            )}
          </section>
        )}

        {view === "stock" && (
          <section>
            <div className="page-heading compact">
              <div>
                <p className="eyebrow">Prioridad 6</p>
                <h1>Stock de insumos</h1>
                <p>
                  Actualizá las existencias desde el reporte de insumos en
                  Excel.
                </p>
              </div>
            </div>
            <article className="stock-upload">
              <div className="upload-icon">
                <Icon name="sheet" />
              </div>
              <div>
                <h2>Actualizar stock desde Excel</h2>
                <p>
                  El reporte se agrupa por <strong>Producto</strong> y suma la
                  columna <strong>Cant</strong>.
                </p>
                <small>
                  Incluye depósitos 2, 13, C18, R18 y 2OB, cualquiera sea su estado
                  operativo. Los vencidos quedan excluidos.
                </small>
              </div>
              <input
                ref={stockFileRef}
                hidden
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => void selectStockFile(e.target.files?.[0])}
              />
              <button
                className="primary-button upload-button"
                disabled={stockImport.loading}
                onClick={() => stockFileRef.current?.click()}
              >
                {stockImport.fileName ? "Elegir otro archivo" : "Subir Excel"}
              </button>
            </article>
            {stockImport.fileName && (
              <article className="import-preview">
                <div>
                  <strong>{stockImport.fileName}</strong>
                  <p>{stockImport.message}</p>
                  {stockImport.includedRows > 0 && (
                    <small>
                      {stockImport.includedRows} registros incluidos ·{" "}
                      {stockImport.excludedRows} excluidos por vencimiento o
                      depósito
                    </small>
                  )}
                </div>
                {stockImport.errors.length > 0 && (
                  <div className="import-errors">
                    <strong>{stockImport.errors.length} observaciones</strong>
                    {stockImport.errors.slice(0, 5).map((error) => (
                      <span key={error}>{error}</span>
                    ))}
                  </div>
                )}
                {stockImport.items.length > 0 && (
                  <button
                    className="primary-button"
                    disabled={stockImport.loading}
                    onClick={() => void importStock()}
                  >
                    Importar {stockImport.items.length} insumos
                  </button>
                )}
              </article>
            )}
            <article className="table-card">
              <div className="table-toolbar">
                <div>
                  <h2>Stock disponible</h2>
                  <p>
                    {visibleStock.length} de {stock.length} insumos
                  </p>
                </div>
                <label className="search-box">
                  <Icon name="search" />
                  <input
                    value={stockQuery}
                    onChange={(e) => setStockQuery(e.target.value)}
                    placeholder="Buscar código, descripción, tipo o depósito"
                  />
                </label>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Código</th>
                      <th>Descripción</th>
                      <th>Disponible</th>
                      <th>Distribución por depósito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStock.map((item) => (
                      <tr key={item.materialCode}>
                        <td>{item.category}</td>
                        <td>{item.materialCode}</td>
                        <td>{item.materialName}</td>
                        <td className="number-cell">
                          {formatNumber(item.quantity)} {item.unit}
                        </td>
                        <td>{Object.keys(item.depots??{}).length?<div className="depot-list">{Object.entries(item.depots).sort(([a],[b])=>a.localeCompare(b)).map(([depot,quantity])=><span key={depot}><b>{depotLabel(depot)}</b> {formatNumber(quantity)}</span>)}</div>:<span className="muted-value">Sin detalle en el reporte</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details className="manual-stock">
                <summary>Corrección manual de un insumo</summary>
                <div className="bom-form">
                  <div className="bom-fields">
                    <label>
                      Código
                      <input
                        value={stockDraft.materialCode}
                        onChange={(e) =>
                          setStockDraft({
                            ...stockDraft,
                            materialCode: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Descripción
                      <input
                        value={stockDraft.materialName}
                        onChange={(e) =>
                          setStockDraft({
                            ...stockDraft,
                            materialName: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Categoría
                      <input
                        value={stockDraft.category}
                        onChange={(e) =>
                          setStockDraft({
                            ...stockDraft,
                            category: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Cantidad
                      <input
                        type="number"
                        min="0"
                        value={stockDraft.quantity}
                        onChange={(e) =>
                          setStockDraft({
                            ...stockDraft,
                            quantity: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => void saveStock()}
                  >
                    Guardar corrección
                  </button>
                </div>
              </details>
            </article>
          </section>
        )}

        {(view === "faltantes" ||
          (view === "compras" && purchaseMode === "weekly")) && (
          <section>
            <div className="page-heading compact">
              <div>
                <p className="eyebrow">
                  {view === "faltantes" ? "Prioridad 7" : "Prioridad 8"}
                </p>
                <h1>
                  {view === "faltantes" ? "Faltantes" : "Necesidades de compra"}
                </h1>
                <p>
                  {view === "faltantes"
                    ? "Demanda que supera el stock disponible."
                    : "Cantidades a comprar agrupadas por tipo de insumo."}
                </p>
              </div>
              <button
                className="refresh-button"
                onClick={() => void loadRequirements()}
              >
                {requirementState.loading ? "Calculando…" : "Recalcular"}
              </button>
            </div>
            {view === "compras" && (
              <nav className="purchase-mode-tabs" aria-label="Tipo de análisis de compras">
                <button
                  data-active={purchaseMode === "weekly"}
                  onClick={() => setPurchaseMode("weekly")}
                >
                  Programa semanal
                </button>
                <button
                  data-active={purchaseMode === "monthly"}
                  onClick={() => {
                    setPurchaseMode("monthly");
                    void loadMonthlyPlan();
                  }}
                >
                  Análisis mensual
                </button>
              </nav>
            )}
            <div className="bom-kpis">
              <article>
                <strong>{requirementState.mapped}</strong>
                <span>operaciones calculadas</span>
              </article>
              <article>
                <strong>{requirementState.provisional}</strong>
                <span>fichas provisionales del Sheet</span>
              </article>
              <article data-warning={shortages.length > 0}>
                <strong>{shortages.length}</strong>
                <span>insumos a comprar</span>
              </article>
            </div>
            {requirementState.completed>0&&<p className="bom-message">{requirementState.completed} operaciones ya realizadas fueron excluidas de faltantes y compras.</p>}
            {requirementState.error ? (
              <p className="bom-message consumption-error">
                {requirementState.error}
              </p>
            ) : shortages.length === 0 ? (
              <article className="empty-consumption">
                <h2>
                  {requirements.length
                    ? "No hay compras necesarias"
                    : "Todavía no hay consumos calculables"}
                </h2>
                <p>
                  {requirements.length
                    ? "El stock disponible cubre las necesidades del programa actual."
                    : `No se encontraron insumos para relacionar con el programa. ${requirementState.blocked} operaciones siguen bloqueadas.`}
                </p>
              </article>
            ) : (
              <article className="table-card">
                <div className="table-toolbar">
                  <div>
                    <h2>
                      {view === "compras"
                        ? "Materiales a comprar"
                        : "Materiales faltantes"}
                    </h2>
                    <p>
                      {visibleShortages.length} de {shortages.length} insumos
                    </p>
                  </div>
                  <div className="purchase-toolbar-actions">
                    <label className="search-box">
                      <Icon name="search" />
                      <input
                        value={shortageQuery}
                        onChange={(e) => setShortageQuery(e.target.value)}
                        placeholder="Buscar insumo, producto o semana"
                      />
                    </label>
                    {view === "compras" && (
                      <button
                        className="export-button"
                        onClick={() => void exportPurchases()}
                      >
                        Exportar Excel
                      </button>
                    )}
                  </div>
                </div>
                {view === "compras" ? (
                  <div className="purchase-groups">
                    {purchaseGroups.map((group) => (
                      <section className="purchase-group" key={group.category}>
                        <header>
                          <div>
                            <span>Tipo de insumo</span>
                            <h3>{group.category}</h3>
                          </div>
                          <div>
                            <strong>{group.items.length}</strong>
                            <span>materiales</span>
                          </div>
                          <div>
                            <strong>{formatNumber(group.total)}</strong>
                            <span>unidades a comprar</span>
                          </div>
                          <button className="export-button" onClick={()=>void exportPurchaseCategory(group.category,group.items)}>Exportar {group.category}</button>
                        </header>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Código</th>
                                <th>Descripción</th>
                                <th>Necesidad</th>
                                <th>Disponible</th>
                                <th>Comprar</th>
                                <th>Semana del faltante</th>
                                <th>Productos</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.items.map((item) => (
                                <tr key={item.materialCode}>
                                  <td className="number-cell">
                                    {item.materialCode}
                                  </td>
                                  <td>{item.materialName}</td>
                                  <td>{formatNumber(item.total)}</td>
                                  <td><strong>{formatNumber(item.available)}</strong>{Object.keys(item.depots??{}).length?<small className="cell-detail">{Object.entries(item.depots??{}).map(([depot,quantity])=>`${depotLabel(depot)}: ${formatNumber(quantity)}`).join(" · ")}</small>:null}</td>
                                  <td className="number-cell purchase-quantity">
                                    {formatNumber(item.shortage)}
                                  </td>
                                  <td>{firstShortageWeek(item)}</td>
                                  <td>{item.products.length}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Tipo</th>
                          <th>Insumo</th>
                          <th>Necesidad</th>
                          <th>Disponible</th>
                          <th>Faltante</th>
                          <th>Semana</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleShortages.map((item) => (
                          <tr key={item.materialCode}>
                            <td>{item.category}</td>
                            <td>
                              {item.materialCode} · {item.materialName}
                            </td>
                            <td>{formatNumber(item.total)}</td>
                            <td><strong>{formatNumber(item.available)}</strong>{Object.keys(item.depots??{}).length?<small className="cell-detail">{Object.entries(item.depots??{}).map(([depot,quantity])=>`${depotLabel(depot)}: ${formatNumber(quantity)}`).join(" · ")}</small>:null}</td>
                            <td className="number-cell">
                              {formatNumber(item.shortage)}
                            </td>
                            <td>{firstShortageWeek(item)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            )}
          </section>
        )}

        {view === "usuarios" && session.role === "admin" && (
          <section>
            <div className="page-heading compact">
              <div>
                <p className="eyebrow">Administración</p>
                <h1>{adminTab==="usuarios"?"Usuarios y permisos":adminTab==="configuracion"?"Configuración operativa":"Diagnóstico del sistema"}</h1>
                <p>{adminTab==="usuarios"?"Creá cuentas, definí accesos, restablecé contraseñas o desactivá usuarios.":adminTab==="configuracion"?"Consultá los parámetros activos sin modificar la lógica que ya está funcionando.":"Comprobá la conexión, la última lectura y los datos recibidos desde Google Sheets."}</p>
              </div>
            </div>
            <nav className="admin-tabs" aria-label="Secciones de administración">
              <button data-active={adminTab==="usuarios"} onClick={()=>setAdminTab("usuarios")}>Usuarios y permisos</button>
              <button data-active={adminTab==="configuracion"} onClick={()=>setAdminTab("configuracion")}>Configuración</button>
              <button data-active={adminTab==="diagnostico"} onClick={()=>setAdminTab("diagnostico")}>Diagnóstico</button>
            </nav>
            {adminTab==="usuarios"&&<article className="table-card">
              <div className="bom-form">
                <div className="bom-fields">
                  <label>
                    Nombre
                    <input
                      value={userDraft.name}
                      onChange={(e) =>
                        setUserDraft({ ...userDraft, name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Correo
                    <input
                      type="email"
                      value={userDraft.email}
                      onChange={(e) =>
                        setUserDraft({ ...userDraft, email: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Usuario
                    <input
                      value={userDraft.username}
                      onChange={(e) =>
                        setUserDraft({ ...userDraft, username: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    {userDraft.id
                      ? "Nueva contraseña (opcional)"
                      : "Contraseña temporal"}
                    <input
                      type="password"
                      value={userDraft.password}
                      onChange={(e) =>
                        setUserDraft({ ...userDraft, password: e.target.value })
                      }
                      placeholder={
                        userDraft.id
                          ? "Dejar vacío para conservarla"
                          : "Obligatoria para usuarios nuevos"
                      }
                    />
                  </label>
                  <label>
                    Perfil
                    <select
                      value={userDraft.role}
                      onChange={(e) =>
                        setUserDraft({ ...userDraft, role: e.target.value })
                      }
                    >
                      <option value="planner">Usuario normal</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </label>
                  <label>
                    Acceso
                    <select
                      value={userDraft.active ? "activo" : "inactivo"}
                      onChange={(e) =>
                        setUserDraft({
                          ...userDraft,
                          active: e.target.value === "activo",
                        })
                      }
                    >
                      <option value="activo">Habilitado</option>
                      <option value="inactivo">Bloqueado</option>
                    </select>
                  </label>
                </div>
                {userDraft.role !== "admin" && (
                  <fieldset className="permission-grid">
                    <legend>Módulos habilitados</legend>
                    {[
                      ["programacion", "Programación"],
                      ["productos", "Productos"],
                      ["bom", "Ficha técnica"],
                      ["consumos", "Consumos"],
                      ["stock", "Stock"],
                      ["faltantes", "Faltantes"],
                      ["compras", "Compras"],
                    ].map(([id, label]) => (
                      <label key={id}>
                        <input
                          type="checkbox"
                          checked={userDraft.permissions
                            .split(",")
                            .includes(id)}
                          onChange={(e) => {
                            const current = new Set(
                              userDraft.permissions.split(",").filter(Boolean),
                            );
                            if (e.target.checked) current.add(id);
                            else current.delete(id);
                            setUserDraft({
                              ...userDraft,
                              permissions: [...current].join(","),
                            });
                          }}
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                )}
                {userMessage && <p className="bom-message">{userMessage}</p>}
                <div className="user-form-actions">
                  <button
                    className="primary-button"
                    onClick={() => void saveUser()}
                  >
                    {userDraft.id ? "Guardar cambios" : "Crear usuario"}
                  </button>
                  {userDraft.id > 0 && (
                    <button
                      className="secondary-button"
                      onClick={() => setUserDraft(emptyUserDraft())}
                    >
                      Cancelar edición
                    </button>
                  )}
                </div>
              </div>
              <div className="table-toolbar">
                <div>
                  <h2>Usuarios registrados</h2>
                  <p>
                    {visibleUsers.length} de {users.length} usuarios
                  </p>
                </div>
                <label className="search-box">
                  <Icon name="search" />
                  <input
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    placeholder="Buscar nombre, usuario, correo o perfil"
                  />
                </label>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Usuario</th>
                      <th>Correo</th>
                      <th>Perfil</th>
                      <th>Acceso</th>
                      <th>Permisos</th>
                      <th>Contraseña</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleUsers.map((user) => (
                      <tr key={user.id}>
                        <td>{user.name}</td>
                        <td>{user.username || "—"}</td>
                        <td>{user.email}</td>
                        <td>
                          {user.role === "admin"
                            ? "Administrador"
                            : "Usuario normal"}
                        </td>
                        <td>
                          <span
                            className={`row-status ${user.active ? "valid" : "review"}`}
                          >
                            {user.active ? "Habilitado" : "Bloqueado"}
                          </span>
                        </td>
                        <td>
                          {user.permissions === "*"
                            ? "Todos"
                            : user.permissions.split(",").length + " módulos"}
                        </td>
                        <td>{user.passwordConfigured?"Configurada · editable":"Sin configurar"}</td>
                        <td>
                          <div className="row-actions">
                            <button onClick={() => editUser(user)}>
                              Editar
                            </button>
                            {user.username !== "admin" ? (
                              <>
                                <button onClick={() => void toggleUser(user)}>
                                  {user.active ? "Bloquear" : "Habilitar"}
                                </button>
                                <button
                                  className="danger"
                                  onClick={() => void deleteUser(user)}
                                >
                                  Eliminar
                                </button>
                              </>
                            ) : (
                              <span className="protected-user">
                                Cuenta protegida
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>}
            {adminTab==="configuracion"&&<article className="table-card admin-system-card">
              <div className="table-toolbar"><div><h2>Configuración operativa</h2><p>Solo el administrador puede modificar estos parámetros.</p></div><span className="row-status valid">Guardada en D1</span></div>
              <div className="admin-settings-form">
                <label>ID de Google Sheets<input value={settingsDraft.spreadsheetId} onChange={event=>setSettingsDraft(current=>({...current,spreadsheetId:event.target.value}))}/><small>No se muestran ni modifican aquí las credenciales privadas de Google.</small></label>
                <label>Sincronización automática (segundos)<input type="number" min="10" max="3600" value={settingsDraft.syncIntervalSeconds} onChange={event=>setSettingsDraft(current=>({...current,syncIntervalSeconds:Number(event.target.value)}))}/><small>Valor recomendado: 30 segundos. Las solicitudes simultáneas comparten una sola actualización.</small></label>
                <label>Caché compartida (segundos)<input type="number" min="0" max="300" value={settingsDraft.cacheSeconds} onChange={event=>setSettingsDraft(current=>({...current,cacheSeconds:Number(event.target.value)}))}/><small>Una sola lectura se reutiliza entre navegadores durante este período.</small></label>
                <label>Depósitos incluidos<input value={settingsDraft.includedDepots.join(", ")} onChange={event=>setSettingsDraft(current=>({...current,includedDepots:event.target.value.split(",").map(value=>value.trim().toUpperCase()).filter(Boolean)}))}/><small>Separados por coma. 13 = Producción · C18 = Calidad · 2 = Depósito 2.</small></label>
              </div>
              <div className="settings-actions"><button className="primary-button" onClick={()=>void saveSettings()}>Guardar configuración</button>{settingsMessage&&<span>{settingsMessage}</span>}</div>
              <div className="admin-config-grid">
                <section><span>Capacidad de importación</span><strong>Hasta 20.000 insumos</strong><small>La carga se realiza por lotes y verifica el total guardado.</small></section>
                <section><span>Base de datos</span><strong>Cloudflare D1</strong><small>Usuarios, fichas técnicas, stock y distribución por depósito.</small></section>
              </div>
              <div className="admin-protected-note"><strong>Protección de credenciales</strong><p>El correo de servicio y la clave privada de Google permanecen como secretos de Cloudflare. Desde aquí se modifican solamente los parámetros operativos seguros.</p></div>
            </article>}
            {adminTab==="diagnostico"&&<article className="table-card admin-system-card">
              <div className="table-toolbar"><div><h2>Estado de la integración</h2><p>Información de la sesión actual.</p></div><button className="export-button" disabled={refreshing} onClick={()=>void synchronizeProgram(true)}>{refreshing?"Probando…":"Probar conexión"}</button></div>
              <div className="admin-diagnostic-grid">
                <section data-ok={sourceState.live}><span>Conexión</span><strong>{sourceState.live?"Sincronizado en vivo":"Instantánea validada"}</strong><small>{sourceState.notice}</small></section>
                <section><span>Última lectura</span><strong>{new Intl.DateTimeFormat("es-AR",{dateStyle:"short",timeStyle:"medium"}).format(new Date(sourceState.fetchedAt))}</strong><small>Hora informada por la última respuesta válida.</small></section>
                <section><span>Semanas detectadas</span><strong>{weeks.length}</strong><small>{weeks.map(week=>week.label).join(" · ")||"Sin semanas reconocidas"}</small></section>
                <section><span>Operaciones recibidas</span><strong>{records.length}</strong><small>{records.filter(record=>record.action==="FRACCIONAR").length} fraccionar · {records.filter(record=>record.action==="VESTIR").length} vestir · {records.filter(record=>record.action==="ENCAJONAR").length} encajonar</small></section>
                <section><span>Stock almacenado</span><strong>{stock.length} insumos</strong><small>{Object.keys(stock.reduce<Record<string,number>>((all,item)=>{for(const depot of Object.keys(item.depots??{}))all[depot]=(all[depot]??0)+1;return all;},{})).join(" · ")||"Sin depósitos cargados"}</small></section>
                <section data-ok={!requirementState.error}><span>Motor de cálculo</span><strong>{requirementState.error?"Requiere atención":"Operativo"}</strong><small>{requirementState.error||`${requirementState.mapped} operaciones calculadas · ${requirementState.blocked} bloqueadas`}</small></section>
              </div>
              <div className="admin-protected-note"><strong>Si otro navegador actualiza y este no</strong><p>Use Probar conexión. Si la hora no cambia, recargue sin caché con Ctrl + Shift + R o cierre y vuelva a abrir la pestaña.</p></div>
            </article>}
          </section>
        )}

        {view === "pendiente" && (
          <section className="gated-view">
            <span className="gated-icon">
              <Icon name="lock" />
            </span>
            <p className="eyebrow">Desarrollo por prioridades</p>
            <h1>Este módulo se habilitará después</h1>
            <p>
              Primero debemos validar completamente la lectura del programa.
              Esto evita que las fichas técnicas, el stock y las compras se construyan sobre datos
              interpretados de forma incorrecta.
            </p>
            <button
              className="primary-button"
              onClick={() => setView("programacion")}
            >
              Continuar con Programación
            </button>
          </section>
        )}
      </div>
      <button
        className="chat-launcher"
        onClick={() => setChatOpen((value) => !value)}
        aria-label="Abrir asistente"
      >
        <Icon name={chatOpen ? "check" : "clipboard"} />
        <span>Consultar</span>
      </button>
      {chatOpen && (
        <aside className="chat-panel">
          <header>
            <div>
              <strong>Asistente de Insumos</strong>
              <small>Ayuda general con el estado actual del ERP</small>
            </div>
            <button onClick={() => setChatOpen(false)}>×</button>
          </header>
          <div className="chat-quick">
            <button disabled={chatLoading} onClick={() => void askAssistant("Dame un resumen de hoy")}>
              Resumen de hoy
            </button>
            <button
              disabled={chatLoading}
              onClick={() => void askAssistant("¿Qué cambió en la programación?")}
            >
              ¿Qué cambió?
            </button>
            <button
              disabled={chatLoading}
              onClick={() => void askAssistant("¿Cuál es el estado del sistema?")}
            >
              Estado del sistema
            </button>
            <button
              disabled={chatLoading}
              onClick={() => void askAssistant("¿Cómo funciona la aplicación?")}
            >
              Cómo funciona
            </button>
          </div>
          <div className="chat-messages">
            {chatMessages.map((message, index) => (
              <div className={`chat-message ${message.from}`} key={index}>
                {message.text}
              </div>
            ))}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void askAssistant(chatInput);
            }}
          >
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Preguntá sobre el funcionamiento del ERP"
              disabled={chatLoading}
            />
            <button disabled={chatLoading}>{chatLoading?"Pensando…":"Enviar"}</button>
          </form>
        </aside>
      )}
    </main>
  );
}
