import { sessionUser } from "../../../lib/auth";
import {
  readPurchaseAnalysis,
  writePurchaseAnalysis,
} from "../../../lib/purchase-analysis-store";
import type { PurchaseAnalysisSnapshot } from "../../../lib/purchase-analysis";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    if (!user?.active)
      return Response.json({ error: "Sesión requerida." }, { status: 401 });
    return Response.json(await readPurchaseAnalysis(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo leer el análisis de compras.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await sessionUser(request);
    if (!user?.active)
      return Response.json({ error: "Sesión requerida." }, { status: 401 });
    const payload = (await request.json()) as Partial<PurchaseAnalysisSnapshot>;
    const snapshot = await writePurchaseAnalysis({
      rows: Array.isArray(payload.rows) ? payload.rows : [],
      sourceFiles: Array.isArray(payload.sourceFiles)
        ? payload.sourceFiles
        : [],
      periodLabel: String(payload.periodLabel || ""),
    });
    return Response.json(snapshot, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo guardar el análisis de compras.",
      },
      { status: 500 },
    );
  }
}
