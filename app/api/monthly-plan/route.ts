import { getD1Database } from "../../../db";
import type {
  IncomingMaterial,
  MonthlyPlanRow,
} from "../../../lib/monthly-planning";

export const dynamic = "force-dynamic";

const MAX_PLAN_ROWS = 5_000;
const MAX_INCOMING_ROWS = 10_000;
const MAX_ROWS_PER_CHUNK = 1_000;
const MAX_JSON_CHARACTERS = 1_500_000;

const INSERT_PLAN_SQL = `
  INSERT INTO monthly_plan_rows (
    id, month, product_code, product_name, bottles,
    units_per_box, notes, updated_at
  )
  SELECT
    json_extract(entry.value, '$.id'),
    json_extract(entry.value, '$.month'),
    json_extract(entry.value, '$.productCode'),
    json_extract(entry.value, '$.productName'),
    CAST(json_extract(entry.value, '$.bottles') AS REAL),
    CAST(json_extract(entry.value, '$.unitsPerBox') AS INTEGER),
    json_extract(entry.value, '$.notes'),
    ?2
  FROM json_each(?1) AS entry
  WHERE json_valid(entry.value)
`;

const INSERT_INCOMING_SQL = `
  INSERT INTO incoming_materials (
    id, expected_month, material_code, material_name, quantity,
    supplier, order_reference, notes, updated_at
  )
  SELECT
    json_extract(entry.value, '$.id'),
    json_extract(entry.value, '$.expectedMonth'),
    json_extract(entry.value, '$.materialCode'),
    json_extract(entry.value, '$.materialName'),
    CAST(json_extract(entry.value, '$.quantity') AS REAL),
    json_extract(entry.value, '$.supplier'),
    json_extract(entry.value, '$.orderReference'),
    json_extract(entry.value, '$.notes'),
    ?2
  FROM json_each(?1) AS entry
  WHERE json_valid(entry.value)
`;

function jsonChunks<T>(values: T[]) {
  const chunks: string[] = [];
  let current: string[] = [];
  let characters = 2;

  for (const value of values) {
    const serialized = JSON.stringify(value);
    const separator = current.length ? 1 : 0;
    if (
      current.length > 0 &&
      (current.length >= MAX_ROWS_PER_CHUNK ||
        characters + separator + serialized.length > MAX_JSON_CHARACTERS)
    ) {
      chunks.push(`[${current.join(",")}]`);
      current = [];
      characters = 2;
    }
    current.push(serialized);
    characters += (current.length > 1 ? 1 : 0) + serialized.length;
  }

  if (current.length) chunks.push(`[${current.join(",")}]`);
  return chunks;
}

export async function GET() {
  try {
    const database = await getD1Database();
    const [plan, incoming] = await Promise.all([
      database
        .prepare(
          "SELECT id, month, product_code AS productCode, product_name AS productName, bottles, units_per_box AS unitsPerBox, notes FROM monthly_plan_rows ORDER BY month, product_code",
        )
        .all(),
      database
        .prepare(
          "SELECT id, expected_month AS expectedMonth, material_code AS materialCode, material_name AS materialName, quantity, supplier, order_reference AS orderReference, notes FROM incoming_materials ORDER BY expected_month, material_code",
        )
        .all(),
    ]);
    return Response.json({
      plan: plan.results as MonthlyPlanRow[],
      incoming: incoming.results as IncomingMaterial[],
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo leer la planificación mensual.",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const payload = (await request.json()) as {
      plan?: MonthlyPlanRow[];
      incoming?: IncomingMaterial[];
    };
    const plan = Array.isArray(payload.plan) ? payload.plan : [];
    const incoming = Array.isArray(payload.incoming) ? payload.incoming : [];

    if (plan.length > MAX_PLAN_ROWS || incoming.length > MAX_INCOMING_ROWS)
      return Response.json(
        { error: "La planificación supera el límite permitido." },
        { status: 400 },
      );
    if (
      plan.some(
        (row) =>
          !row.id ||
          !/^20\d{2}-(0[1-9]|1[0-2])$/.test(row.month) ||
          !row.productCode.trim() ||
          !Number.isFinite(Number(row.bottles)) ||
          Number(row.bottles) <= 0 ||
          ![6, 12].includes(Number(row.unitsPerBox)),
      )
    )
      return Response.json(
        {
          error:
            "Hay productos con mes, código, botellas o presentación inválidos.",
        },
        { status: 400 },
      );
    if (
      incoming.some(
        (row) =>
          !row.id ||
          !/^20\d{2}-(0[1-9]|1[0-2])$/.test(row.expectedMonth) ||
          !row.materialCode.trim() ||
          !Number.isFinite(Number(row.quantity)) ||
          Number(row.quantity) <= 0,
      )
    )
      return Response.json(
        { error: "Hay pendientes con mes, código o cantidad inválidos." },
        { status: 400 },
      );

    if (new Set(plan.map((row) => row.id)).size !== plan.length)
      return Response.json(
        { error: "El estimado contiene filas duplicadas." },
        { status: 400 },
      );
    if (new Set(incoming.map((row) => row.id)).size !== incoming.length)
      return Response.json(
        { error: "El archivo de pendientes contiene filas duplicadas." },
        { status: 400 },
      );

    const normalizedPlan = plan.map((row) => ({
      id: row.id,
      month: row.month,
      productCode: row.productCode.trim(),
      productName: row.productName.trim(),
      bottles: Number(row.bottles),
      unitsPerBox: Number(row.unitsPerBox),
      notes: row.notes ?? "",
    }));
    const normalizedIncoming = incoming.map((row) => ({
      id: row.id,
      expectedMonth: row.expectedMonth,
      materialCode: row.materialCode.trim(),
      materialName: row.materialName.trim(),
      quantity: Number(row.quantity),
      supplier: row.supplier ?? "",
      orderReference: row.orderReference ?? "",
      notes: row.notes ?? "",
    }));

    const database = await getD1Database();
    const now = new Date().toISOString();
    const statements = [
      database.prepare("DELETE FROM monthly_plan_rows"),
      database.prepare("DELETE FROM incoming_materials"),
      ...jsonChunks(normalizedPlan).map((json) =>
        database.prepare(INSERT_PLAN_SQL).bind(json, now),
      ),
      ...jsonChunks(normalizedIncoming).map((json) =>
        database.prepare(INSERT_INCOMING_SQL).bind(json, now),
      ),
    ];

    // Un único batch reemplaza Estimado y Pendientes de forma conjunta. Cada
    // consulta inserta hasta mil filas mediante json_each, evitando miles de
    // operaciones individuales y estados guardados a medias.
    await database.batch(statements);

    const verification = (await database
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM monthly_plan_rows) AS plan_total,
          (SELECT COUNT(*) FROM incoming_materials) AS incoming_total
      `)
      .first()) as { plan_total: number; incoming_total: number } | null;
    const savedPlan = Number(verification?.plan_total ?? 0);
    const savedIncoming = Number(verification?.incoming_total ?? 0);
    if (savedPlan !== plan.length || savedIncoming !== incoming.length)
      throw new Error(
        `La base confirmó ${savedPlan} de ${plan.length} filas del estimado y ${savedIncoming} de ${incoming.length} pendientes.`,
      );

    return Response.json({
      ok: true,
      plan: savedPlan,
      incoming: savedIncoming,
      updatedAt: now,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo guardar la planificación mensual.",
      },
      { status: 500 },
    );
  }
}
