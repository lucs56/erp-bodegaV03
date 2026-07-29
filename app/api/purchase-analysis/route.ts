import { sessionUser } from "../../../lib/auth";
import {
  deletePurchaseAnalysis,
  readPurchaseAnalysis,
  writePurchaseAnalysis,
} from "../../../lib/purchase-analysis-store";

export const dynamic = "force-dynamic";

function canUsePurchases(user: {
  role: string;
  permissions: string;
}) {
  return (
    user.role === "admin" ||
    user.permissions === "*" ||
    user.permissions.split(",").map((item) => item.trim()).includes("compras")
  );
}

export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    if (!user?.active) {
      return Response.json({ error: "Sesión requerida." }, { status: 401 });
    }
    if (!canUsePurchases(user)) {
      return Response.json({ error: "Acceso no autorizado." }, { status: 403 });
    }
    return Response.json(
      { analysis: await readPurchaseAnalysis() },
      { headers: { "cache-control": "no-store" } },
    );
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

export async function PUT(request: Request) {
  try {
    const user = await sessionUser(request);
    if (!user?.active) {
      return Response.json({ error: "Sesión requerida." }, { status: 401 });
    }
    if (!canUsePurchases(user)) {
      return Response.json({ error: "Acceso no autorizado." }, { status: 403 });
    }
    const analysis = await writePurchaseAnalysis(await request.json());
    return Response.json({ analysis });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo guardar el análisis de compras.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await sessionUser(request);
    if (!user?.active || user.role !== "admin") {
      return Response.json(
        { error: "Solo el administrador puede eliminar el análisis." },
        { status: 403 },
      );
    }
    await deletePurchaseAnalysis();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo eliminar el análisis.",
      },
      { status: 500 },
    );
  }
}

