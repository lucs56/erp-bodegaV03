import { getD1Database } from "../../../db";
import { sessionUser } from "../../../lib/auth";
import {
  normalizeMonthlyPurchasePlan,
  type MonthlyPurchasePlanPayload,
} from "../../../lib/monthly-purchases";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    if (!user?.active)
      return Response.json({ error: "Sesión requerida." }, { status: 401 });
    const database = await getD1Database();
    const row = await database
      .prepare(
        "SELECT file_name, period_label, payload, imported_by, imported_at FROM monthly_purchase_plans WHERE key = ?",
      )
      .bind("latest")
      .first<{
        file_name: string;
        period_label: string;
        payload: string;
        imported_by: string;
        imported_at: string;
      }>();
    if (!row) return Response.json({ plan: null });
    return Response.json({
      plan: {
        ...JSON.parse(row.payload),
        fileName: row.file_name,
        periodLabel: row.period_label,
        importedBy: row.imported_by,
        importedAt: row.imported_at,
      },
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "No se pudo leer el análisis mensual." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await sessionUser(request);
    if (!user?.active)
      return Response.json({ error: "Sesión requerida." }, { status: 401 });
    const plan = normalizeMonthlyPurchasePlan(
      await request.json() as MonthlyPurchasePlanPayload,
    );
    const database = await getD1Database();
    const importedAt = new Date().toISOString();
    await database
      .prepare(`
        INSERT INTO monthly_purchase_plans
          (key, file_name, period_label, payload, imported_by, imported_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(key) DO UPDATE SET
          file_name = excluded.file_name,
          period_label = excluded.period_label,
          payload = excluded.payload,
          imported_by = excluded.imported_by,
          imported_at = excluded.imported_at
      `)
      .bind(
        "latest",
        plan.fileName,
        plan.periodLabel,
        JSON.stringify(plan),
        user.username || user.email,
        importedAt,
      )
      .run();
    return Response.json({
      ok: true,
      plan: {
        ...plan,
        importedBy: user.username || user.email,
        importedAt,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar el análisis mensual." },
      { status: 400 },
    );
  }
}
