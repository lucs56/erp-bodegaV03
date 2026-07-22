import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { bomItems, bomSubstitutes, products } from "../../../db/schema";
export const dynamic = "force-dynamic";

type Item = { materialCode?: string; materialName?: string; category?: string; quantity?: number; unit?: string; action?: string; substitutes?: string[] };
export async function GET() {
  try {
    const db = await getDb();
    const [productRows, itemRows, substituteRows] = await Promise.all([db.select().from(products).orderBy(asc(products.code)), db.select().from(bomItems).orderBy(asc(bomItems.id)), db.select().from(bomSubstitutes).orderBy(asc(bomSubstitutes.priority))]);
    return Response.json({ products: productRows.map((product) => ({ ...product, items: itemRows.filter((item) => item.productId === product.id).map((item) => ({ ...item, substitutes: substituteRows.filter((substitute) => substitute.bomItemId === item.id).map((substitute) => substitute.materialCode) })) })) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudieron leer las BOM." }, { status: 500 }); }
}
export async function POST(request: Request) {
  try {
    const payload = await request.json() as { code?: string; name?: string; items?: Item[] };
    const code = payload.code?.trim(); const name = payload.name?.trim();
    const items = (payload.items ?? []).map((item) => ({ materialCode: item.materialCode?.trim() ?? "", materialName: item.materialName?.trim() ?? "", category: item.category?.trim() || "Otros", quantity: Number(item.quantity), unit: item.unit?.trim() || "unidad", action: item.action?.trim().toUpperCase() ?? "", substitutes: [...new Set((item.substitutes ?? []).map((value) => value.trim()).filter(Boolean))] }));
    if (!code || !name) return Response.json({ error: "Código y nombre son obligatorios." }, { status: 400 });
    if (!items.length || items.some((item) => !item.materialCode || !item.materialName || !item.action || !Number.isFinite(item.quantity) || item.quantity <= 0)) return Response.json({ error: "Cada BOM necesita al menos un insumo válido con cantidad mayor que cero." }, { status: 400 });
    const db = await getDb(); const existing = await db.select().from(products).where(eq(products.code, code)).limit(1);
    const [product] = existing.length ? await db.update(products).set({ name, active: true, updatedAt: new Date().toISOString() }).where(eq(products.id, existing[0].id)).returning() : await db.insert(products).values({ code, name, updatedAt: new Date().toISOString() }).returning();
    await db.delete(bomItems).where(eq(bomItems.productId, product.id));
    for (const item of items) { const [saved] = await db.insert(bomItems).values({ productId: product.id, materialCode: item.materialCode, materialName: item.materialName, category: item.category, quantity: item.quantity, unit: item.unit, action: item.action }).returning(); if (item.substitutes.length) await db.insert(bomSubstitutes).values(item.substitutes.map((materialCode, index) => ({ bomItemId: saved.id, materialCode, priority: index + 1 }))); }
    return Response.json({ ok: true, productId: product.id });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudo guardar la BOM." }, { status: 500 }); }
}
