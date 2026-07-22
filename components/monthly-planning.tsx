"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  calculateMonthlyPurchases,
  parseIncomingRows,
  parseMonthlyPlanRows,
  type IncomingMaterial,
  type MonthlyBom,
  type MonthlyPlanRow,
  type MonthlyStock,
} from "../lib/monthly-planning";
import { suggestBomFromProgram } from "../lib/bom-suggestions";
import type { ProgramRecord } from "../lib/program-data";

type PlanningTab = "plan" | "incoming" | "result";
type ImportKind = "plan" | "incoming";
type ImportSummary = {
  fileName: string;
  rows: number;
  errors: string[];
};

const emptyImportSummary = (): ImportSummary => ({
  fileName: "",
  rows: 0,
  errors: [],
});
const createId = () => crypto.randomUUID();
const currentMonth = () => new Date().toISOString().slice(0, 7);
const formatNumber = (value: number) =>
  new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(value);
const monthLabel = (month: string) =>
  month
    ? new Intl.DateTimeFormat("es-AR", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${month}-01T00:00:00Z`))
    : "Sin mes";

async function readJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json"))
    throw new Error(`El servidor respondió ${response.status} sin datos válidos.`);
  return response.json() as Promise<T>;
}

export default function MonthlyPlanning() {
  const [plan, setPlan] = useState<MonthlyPlanRow[]>([]);
  const [incoming, setIncoming] = useState<IncomingMaterial[]>([]);
  const [boms, setBoms] = useState<MonthlyBom[]>([]);
  const [program, setProgram] = useState<ProgramRecord[]>([]);
  const [stock, setStock] = useState<MonthlyStock[]>([]);
  const [tab, setTab] = useState<PlanningTab>("plan");
  const [message, setMessage] = useState("Cargando planificación…");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [planImport, setPlanImport] = useState<ImportSummary>(
    emptyImportSummary,
  );
  const [incomingImport, setIncomingImport] = useState<ImportSummary>(
    emptyImportSummary,
  );
  const planFile = useRef<HTMLInputElement>(null);
  const incomingFile = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const monthlyResponse = await fetch("/api/monthly-plan", {
          cache: "no-store",
        });
        const monthlyPayload = await readJson<{
          plan?: MonthlyPlanRow[];
          incoming?: IncomingMaterial[];
          error?: string;
        }>(monthlyResponse);
        if (!monthlyResponse.ok)
          throw new Error(
            monthlyPayload.error ?? "No se pudo leer la planificación mensual.",
          );
        if (cancelled) return;
        setPlan(monthlyPayload.plan ?? []);
        setIncoming(monthlyPayload.incoming ?? []);
        setMessage("Cargando fichas y stock…");

        const [bomResponse, stockResponse] = await Promise.all([
          fetch("/api/bom", { cache: "no-store" }),
          fetch("/api/stock", { cache: "no-store" }),
        ]);
        const [bomPayload, stockPayload] = await Promise.all([
          readJson<{ products?: MonthlyBom[]; error?: string }>(bomResponse),
          readJson<{ items?: MonthlyStock[]; error?: string }>(stockResponse),
        ]);
        if (!bomResponse.ok)
          throw new Error(bomPayload.error ?? "No se pudieron leer las BOM.");
        if (!stockResponse.ok)
          throw new Error(stockPayload.error ?? "No se pudo leer el stock.");
        if (cancelled) return;
        setBoms(bomPayload.products ?? []);
        setStock(stockPayload.items ?? []);

        // La programación se carga al final porque puede requerir leer el
        // Sheet. El usuario ya puede ver estimados y pendientes mientras tanto.
        const programResponse = await fetch("/api/program?cached=1", {
          cache: "no-store",
        });
        if (programResponse.ok) {
          const programPayload = await readJson<{ records?: ProgramRecord[] }>(
            programResponse,
          );
          if (!cancelled) setProgram(programPayload.records ?? []);
        }
        if (!cancelled) setMessage("");
      } catch (error) {
        if (!cancelled)
          setMessage(
            error instanceof Error
              ? error.message
              : "No se pudo cargar el módulo.",
          );
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveBoms = useMemo(() => {
    const approved = new Set(
      boms.map((item) => item.code.trim().toUpperCase()),
    );
    const provisional = [
      ...new Set(program.map((row) => row.productCode).filter(Boolean)),
    ]
      .filter((code) => !approved.has(code.trim().toUpperCase()))
      .map((code) => {
        const rows = program.filter((row) => row.productCode === code);
        return {
          code,
          name: `${rows[0]?.brand ?? ""} · ${rows[0]?.variety ?? ""}`.trim(),
          items: suggestBomFromProgram(program, code).items,
        };
      })
      .filter((item) => item.items.length > 0);
    return [...boms, ...provisional];
  }, [boms, program]);

  const result = useMemo(
    () => calculateMonthlyPurchases(plan, effectiveBoms, stock, incoming),
    [plan, effectiveBoms, stock, incoming],
  );
  const visibleLines = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es");
    return term
      ? result.lines.filter((line) =>
          `${line.month} ${line.materialCode} ${line.materialName} ${line.category} ${line.products.join(" ")}`
            .toLocaleLowerCase("es")
            .includes(term),
        )
      : result.lines;
  }, [result.lines, query]);

  const addPlan = () =>
    setPlan((rows) => [
      ...rows,
      {
        id: createId(),
        month: currentMonth(),
        productCode: "",
        productName: "",
        bottles: 0,
        unitsPerBox: 12,
        notes: "",
      },
    ]);
  const addIncoming = () =>
    setIncoming((rows) => [
      ...rows,
      {
        id: createId(),
        expectedMonth: currentMonth(),
        materialCode: "",
        materialName: "",
        quantity: 0,
        supplier: "",
        orderReference: "",
        notes: "",
      },
    ]);

  const updatePlan = (rowId: string, values: Partial<MonthlyPlanRow>) =>
    setPlan((rows) =>
      rows.map((row) => {
        if (row.id !== rowId) return row;
        const next = { ...row, ...values };
        if (values.productCode !== undefined) {
          const product = effectiveBoms.find(
            (item) =>
              item.code.trim().toUpperCase() ===
              values.productCode?.trim().toUpperCase(),
          );
          if (product) next.productName = product.name;
        }
        return next;
      }),
    );

  const updateIncoming = (
    rowId: string,
    values: Partial<IncomingMaterial>,
  ) =>
    setIncoming((rows) =>
      rows.map((row) => {
        if (row.id !== rowId) return row;
        const next = { ...row, ...values };
        if (values.materialCode !== undefined) {
          const material = stock.find(
            (item) =>
              item.materialCode.trim().toUpperCase() ===
              values.materialCode?.trim().toUpperCase(),
          );
          if (material) next.materialName = material.materialName;
        }
        return next;
      }),
    );

  const readWorkbook = async (file: File, kind: ImportKind) => {
    setMessage(`Leyendo ${file.name}…`);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), {
        type: "array",
        cellDates: true,
      });
      const rows = workbook.SheetNames.flatMap((name) => {
        const sheet = workbook.Sheets[name];
        return sheet
          ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
              defval: "",
            })
          : [];
      });
      if (!rows.length) throw new Error("El archivo no contiene filas para leer.");

      if (kind === "plan") {
        const parsed = parseMonthlyPlanRows(rows);
        setPlanImport({
          fileName: file.name,
          rows: parsed.items.length,
          errors: parsed.errors,
        });
        if (!parsed.items.length) {
          setMessage(
            `No se reemplazó el estimado: ${file.name} no contiene filas válidas.`,
          );
          return;
        }
        setPlan(parsed.items);
        setTab("plan");
        setMessage(
          `${parsed.items.length} filas del estimado fueron leídas. Ahora podés cargar Pendientes o guardar ambos archivos.`,
        );
      } else {
        const parsed = parseIncomingRows(rows);
        setIncomingImport({
          fileName: file.name,
          rows: parsed.items.length,
          errors: parsed.errors,
        });
        if (!parsed.items.length) {
          setMessage(
            `No se reemplazaron los pendientes: ${file.name} no contiene filas válidas.`,
          );
          return;
        }
        setIncoming(parsed.items);
        setTab("incoming");
        setMessage(
          `${parsed.items.length} filas de pendientes fueron leídas. El estimado permanece cargado.`,
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo leer el Excel.",
      );
    }
  };

  const save = async () => {
    if (!plan.length) {
      setMessage("Cargá al menos una fila válida del estimado mensual.");
      return;
    }
    setSaving(true);
    setMessage("Guardando estimado y pendientes en Cloudflare D1…");
    try {
      const response = await fetch("/api/monthly-plan", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan, incoming }),
      });
      const payload = await readJson<{
        plan?: number;
        incoming?: number;
        error?: string;
      }>(response);
      if (!response.ok)
        throw new Error(payload.error ?? "No se pudo guardar.");
      setMessage(
        `Guardado completo: ${payload.plan ?? plan.length} filas de estimado y ${payload.incoming ?? incoming.length} pendientes.`,
      );
      setTab("result");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo guardar.",
      );
    } finally {
      setSaving(false);
    }
  };

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const append = (name: string, rows: Record<string, unknown>[]) => {
      const sheet = XLSX.utils.json_to_sheet(rows);
      if (sheet["!ref"]) sheet["!autofilter"] = { ref: sheet["!ref"] };
      sheet["!cols"] = [
        { wch: 16 },
        { wch: 18 },
        { wch: 38 },
        { wch: 18 },
        { wch: 18 },
        { wch: 18 },
        { wch: 18 },
        { wch: 24 },
        { wch: 50 },
      ];
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    };

    append(
      "Programa mensual",
      plan.map((row) => ({
        Mes: monthLabel(row.month),
        "Código producto": row.productCode,
        Producto: row.productName,
        Botellas: row.bottles,
        "Cj x": row.unitsPerBox,
        Cajas: Math.ceil(row.bottles / row.unitsPerBox),
        Observaciones: row.notes,
      })),
    );
    append(
      "Pendientes",
      incoming.map((row) => ({
        "Mes de entrega": monthLabel(row.expectedMonth),
        "Código insumo": row.materialCode,
        Insumo: row.materialName,
        "Cantidad pendiente": row.quantity,
        Proveedor: row.supplier,
        "Orden de compra": row.orderReference,
        Observaciones: row.notes,
      })),
    );
    append(
      "Compra planificada",
      result.lines.map((line) => ({
        Mes: monthLabel(line.month),
        "Código insumo": line.materialCode,
        Insumo: line.materialName,
        Tipo: line.category,
        "Necesidad bruta": line.grossRequirement,
        "Stock inicial": line.openingStock,
        "Pendiente por llegar": line.incoming,
        "Planificar compra": line.purchase,
        "Saldo proyectado": line.closingBalance,
        "Stock por depósito": Object.entries(line.depots)
          .map(([depot, quantity]) => `${depot}: ${formatNumber(quantity)}`)
          .join(" · "),
        Productos: line.products.join("; "),
      })),
    );
    XLSX.writeFile(
      workbook,
      `planificacion-mensual-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };

  const importIssues = (summary: ImportSummary) =>
    summary.errors.length > 0 ? (
      <div className="monthly-upload-errors">
        <strong>{summary.errors.length} filas para revisar</strong>
        {summary.errors.slice(0, 4).map((error) => (
          <span key={error}>{error}</span>
        ))}
      </div>
    ) : null;

  return (
    <section className="monthly-view">
      <div className="page-heading compact">
        <div>
          <p className="eyebrow">Planificación estratégica</p>
          <h1>Programa mensual de insumos</h1>
          <p>
            Convertí el estimado de vinos en necesidades, descontá stock y
            entregas pendientes, y planificá las compras.
          </p>
        </div>
        <div className="monthly-heading-actions">
          <button
            className="secondary-button"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? "Guardando…" : "Guardar ambos"}
          </button>
          <button className="export-button" onClick={() => void exportExcel()}>
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="monthly-flow">
        <div>
          <strong>1</strong>
          <span>Programa estimado</span>
        </div>
        <i />
        <div>
          <strong>2</strong>
          <span>BOM automática</span>
        </div>
        <i />
        <div>
          <strong>3</strong>
          <span>Stock + pendientes</span>
        </div>
        <i />
        <div>
          <strong>4</strong>
          <span>Compra planificada</span>
        </div>
      </div>

      <section className="monthly-upload-panel">
        <div className="monthly-upload-heading">
          <div>
            <p className="eyebrow">Archivos de entrada</p>
            <h2>Cargá el estimado y los pendientes</h2>
            <p>
              Son dos archivos independientes. Reemplazar uno no borra el otro
              hasta que confirmes Guardar ambos.
            </p>
          </div>
          <button
            className="primary-button"
            onClick={() => void save()}
            disabled={saving || !plan.length}
          >
            {saving ? "Guardando…" : "Guardar ambos y calcular"}
          </button>
        </div>

        <input
          ref={planFile}
          hidden
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void readWorkbook(file, "plan");
            event.target.value = "";
          }}
        />
        <input
          ref={incomingFile}
          hidden
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void readWorkbook(file, "incoming");
            event.target.value = "";
          }}
        />

        <div className="monthly-upload-grid">
          <article data-ready={plan.length > 0}>
            <div className="monthly-upload-card-title">
              <span>1</span>
              <div>
                <strong>Archivo de estimado mensual</strong>
                <small>Productos, meses, botellas y presentación 6/12.</small>
              </div>
            </div>
            <div className="monthly-upload-status">
              <strong>
                {planImport.fileName ||
                  (plan.length ? "Estimado guardado" : "Sin archivo")}
              </strong>
              <span>{plan.length} filas disponibles</span>
            </div>
            {importIssues(planImport)}
            <div className="monthly-upload-actions">
              <button
                className="secondary-button"
                onClick={() => planFile.current?.click()}
              >
                {plan.length ? "Reemplazar estimado" : "Subir estimado"}
              </button>
              <a href="/examples/Plantilla-Estimado-Mensual.xlsx" download>
                Descargar plantilla
              </a>
            </div>
          </article>

          <article data-ready={incoming.length > 0}>
            <div className="monthly-upload-card-title">
              <span>2</span>
              <div>
                <strong>Archivo de pendientes de recepción</strong>
                <small>Insumos, cantidades, entrega prevista, proveedor y OC.</small>
              </div>
            </div>
            <div className="monthly-upload-status">
              <strong>
                {incomingImport.fileName ||
                  (incoming.length ? "Pendientes guardados" : "Sin archivo")}
              </strong>
              <span>{incoming.length} filas disponibles</span>
            </div>
            {importIssues(incomingImport)}
            <div className="monthly-upload-actions">
              <button
                className="secondary-button"
                onClick={() => incomingFile.current?.click()}
              >
                {incoming.length
                  ? "Reemplazar pendientes"
                  : "Subir pendientes"}
              </button>
              <a href="/examples/Plantilla-Pendientes-Recepcion.xlsx" download>
                Descargar plantilla
              </a>
            </div>
          </article>
        </div>

        <div className="monthly-upload-summary">
          <span>
            Estimado: <strong>{plan.length}</strong>
          </span>
          <span>
            Pendientes: <strong>{incoming.length}</strong>
          </span>
          <span>
            Insumos a comprar: <strong>{result.lines.filter((line) => line.purchase > 0).length}</strong>
          </span>
        </div>
      </section>

      <nav className="monthly-tabs">
        <button data-active={tab === "plan"} onClick={() => setTab("plan")}>
          Programa estimado <b>{plan.length}</b>
        </button>
        <button
          data-active={tab === "incoming"}
          onClick={() => setTab("incoming")}
        >
          Pendientes por llegar <b>{incoming.length}</b>
        </button>
        <button data-active={tab === "result"} onClick={() => setTab("result")}>
          Resultado <b>{result.lines.filter((line) => line.purchase > 0).length}</b>
        </button>
      </nav>

      {message && <p className="monthly-message">{message}</p>}

      {tab === "plan" && (
        <article className="table-card">
          <div className="table-toolbar">
            <div>
              <h2>Productos estimados por mes</h2>
              <p>El código relaciona automáticamente cada vino con su ficha BOM.</p>
            </div>
            <div className="monthly-heading-actions">
              <button
                className="secondary-button"
                onClick={() => planFile.current?.click()}
              >
                Importar estimado
              </button>
              <button className="primary-button" onClick={addPlan}>
                Agregar producto
              </button>
            </div>
          </div>
          <datalist id="monthly-products">
            {effectiveBoms.map((product) => (
              <option key={product.code} value={product.code}>
                {product.name}
              </option>
            ))}
          </datalist>
          <div className="table-scroll">
            <table className="monthly-table">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th>Código producto</th>
                  <th>Producto</th>
                  <th>Botellas</th>
                  <th>Cj x</th>
                  <th>Cajas</th>
                  <th>Estado BOM</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plan.map((row) => {
                  const mapped = effectiveBoms.some(
                    (item) =>
                      item.code.trim().toUpperCase() ===
                      row.productCode.trim().toUpperCase(),
                  );
                  return (
                    <tr key={row.id}>
                      <td>
                        <input
                          type="month"
                          value={row.month}
                          onChange={(event) =>
                            updatePlan(row.id, { month: event.target.value })
                          }
                        />
                      </td>
                      <td>
                        <input
                          list="monthly-products"
                          value={row.productCode}
                          onChange={(event) =>
                            updatePlan(row.id, {
                              productCode: event.target.value,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          value={row.productName}
                          onChange={(event) =>
                            updatePlan(row.id, {
                              productName: event.target.value,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          value={row.bottles || ""}
                          onChange={(event) =>
                            updatePlan(row.id, {
                              bottles: Number(event.target.value),
                            })
                          }
                        />
                      </td>
                      <td>
                        <select
                          value={row.unitsPerBox}
                          onChange={(event) =>
                            updatePlan(row.id, {
                              unitsPerBox: Number(event.target.value) as 6 | 12,
                            })
                          }
                        >
                          <option value="6">6</option>
                          <option value="12">12</option>
                        </select>
                      </td>
                      <td className="number-cell">
                        {formatNumber(
                          Math.ceil(row.bottles / row.unitsPerBox),
                        )}
                      </td>
                      <td>
                        <span
                          className={`row-status ${mapped ? "valid" : "warning"}`}
                        >
                          {mapped ? "Relacionada" : "Falta BOM"}
                        </span>
                      </td>
                      <td>
                        <button
                          className="row-delete"
                          onClick={() =>
                            setPlan((rows) =>
                              rows.filter((item) => item.id !== row.id),
                            )
                          }
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!plan.length && (
            <div className="monthly-empty">
              Importá el estimado mensual o agregá el primer producto.
            </div>
          )}
        </article>
      )}

      {tab === "incoming" && (
        <article className="table-card">
          <div className="table-toolbar">
            <div>
              <h2>Compras pendientes de recepción</h2>
              <p>
                Se descuentan en el mes previsto antes de calcular una compra
                nueva.
              </p>
            </div>
            <div className="monthly-heading-actions">
              <button
                className="secondary-button"
                onClick={() => incomingFile.current?.click()}
              >
                Importar pendientes
              </button>
              <button className="primary-button" onClick={addIncoming}>
                Agregar pendiente
              </button>
            </div>
          </div>
          <datalist id="monthly-materials">
            {stock.map((item) => (
              <option key={item.materialCode} value={item.materialCode}>
                {item.materialName}
              </option>
            ))}
          </datalist>
          <div className="table-scroll">
            <table className="monthly-table">
              <thead>
                <tr>
                  <th>Mes de entrega</th>
                  <th>Código insumo</th>
                  <th>Insumo</th>
                  <th>Cantidad</th>
                  <th>Proveedor</th>
                  <th>OC / Pedido</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {incoming.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        type="month"
                        value={row.expectedMonth}
                        onChange={(event) =>
                          updateIncoming(row.id, {
                            expectedMonth: event.target.value,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        list="monthly-materials"
                        value={row.materialCode}
                        onChange={(event) =>
                          updateIncoming(row.id, {
                            materialCode: event.target.value,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        value={row.materialName}
                        onChange={(event) =>
                          updateIncoming(row.id, {
                            materialName: event.target.value,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={row.quantity || ""}
                        onChange={(event) =>
                          updateIncoming(row.id, {
                            quantity: Number(event.target.value),
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        value={row.supplier}
                        onChange={(event) =>
                          updateIncoming(row.id, {
                            supplier: event.target.value,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        value={row.orderReference}
                        onChange={(event) =>
                          updateIncoming(row.id, {
                            orderReference: event.target.value,
                          })
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="row-delete"
                        onClick={() =>
                          setIncoming((rows) =>
                            rows.filter((item) => item.id !== row.id),
                          )
                        }
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!incoming.length && (
            <div className="monthly-empty">
              No hay entregas pendientes cargadas. Podés subir el archivo o
              continuar con cero pendientes.
            </div>
          )}
        </article>
      )}

      {tab === "result" && (
        <>
          <div className="monthly-kpis">
            <article>
              <span>Necesidad bruta</span>
              <strong>{formatNumber(result.totalGross)}</strong>
            </article>
            <article>
              <span>Pendiente por llegar</span>
              <strong>{formatNumber(result.totalIncoming)}</strong>
            </article>
            <article data-warning={result.totalPurchase > 0}>
              <span>Planificar compra</span>
              <strong>{formatNumber(result.totalPurchase)}</strong>
            </article>
            <article data-warning={result.unmapped.length > 0}>
              <span>Productos sin BOM</span>
              <strong>{result.unmapped.length}</strong>
            </article>
          </div>
          {result.unmapped.length > 0 && (
            <div className="monthly-errors">
              <strong>
                No se calcularon estos productos porque falta su BOM
              </strong>
              {result.unmapped.map((row) => (
                <span key={row.id}>
                  {row.month} · {row.productCode} · {row.productName}
                </span>
              ))}
            </div>
          )}
          <article className="table-card">
            <div className="table-toolbar">
              <div>
                <h2>Plan de compra proyectado</h2>
                <p>
                  El saldo se arrastra mes a mes; una entrega futura no cubre
                  consumos anteriores.
                </p>
              </div>
              <label className="search-box">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar código, insumo, tipo o producto"
                />
              </label>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th>Tipo</th>
                    <th>Insumo</th>
                    <th>Necesidad</th>
                    <th>Stock inicial</th>
                    <th>Por llegar</th>
                    <th>Comprar</th>
                    <th>Saldo</th>
                    <th>Productos</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLines.map((line) => (
                    <tr key={`${line.month}-${line.materialCode}`}>
                      <td>{monthLabel(line.month)}</td>
                      <td>{line.category}</td>
                      <td>
                        <strong>{line.materialCode}</strong>
                        <small className="cell-detail">
                          {line.materialName}
                        </small>
                      </td>
                      <td>{formatNumber(line.grossRequirement)}</td>
                      <td>
                        <strong>{formatNumber(line.openingStock)}</strong>
                        {Object.keys(line.depots).length > 0 && (
                          <small className="cell-detail">
                            {Object.entries(line.depots)
                              .map(
                                ([depot, quantity]) =>
                                  `${depot}: ${formatNumber(quantity)}`,
                              )
                              .join(" · ")}
                          </small>
                        )}
                      </td>
                      <td>{formatNumber(line.incoming)}</td>
                      <td className={line.purchase > 0 ? "monthly-purchase" : ""}>
                        {formatNumber(line.purchase)}
                      </td>
                      <td>{formatNumber(line.closingBalance)}</td>
                      <td>{line.products.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </>
      )}
    </section>
  );
}
