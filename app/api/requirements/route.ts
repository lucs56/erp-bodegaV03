import { asc } from "drizzle-orm";
import { getDb } from "../../../db";
import { bomItems, bomSubstitutes, products, stockDepotItems,stockItems } from "../../../db/schema";
import { readLastStoredProgram, readLiveProgram } from "../../../lib/google-sheets";
import { programRecords } from "../../../lib/program-data";
import { buildEffectiveBoms, calculateRequirements } from "../../../lib/requirements";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [stored, db] = await Promise.all([readLastStoredProgram(), getDb()]);
    // El cálculo reutiliza la última programación sincronizada. Solamente lee
    // Google aquí durante el primer arranque, cuando aún no existe caché D1.
    const live = stored ?? await readLiveProgram();
    const [productRows, itemRows, substituteRows, stock,depotRows] = await Promise.all([db.select().from(products).orderBy(asc(products.code)), db.select().from(bomItems), db.select().from(bomSubstitutes).orderBy(asc(bomSubstitutes.priority)),db.select().from(stockItems),db.select().from(stockDepotItems)]);
    const records = live ? live.weeks.flatMap((week) => week.records) : programRecords;

    const substitutesByItem = new Map<number, string[]>();
    for (const substitute of substituteRows) {
      const values = substitutesByItem.get(substitute.bomItemId) ?? [];
      values.push(substitute.materialCode);
      substitutesByItem.set(substitute.bomItemId, values);
    }
    const itemsByProduct = new Map<number, typeof itemRows>();
    for (const item of itemRows) {
      const values = itemsByProduct.get(item.productId) ?? [];
      values.push(item);
      itemsByProduct.set(item.productId, values);
    }
    const approvedBoms = productRows.map((product) => ({
      productCode: product.code,
      items: (itemsByProduct.get(product.id) ?? []).map((item) => ({
        ...item,
        substitutes: substitutesByItem.get(item.id) ?? [],
      })),
    }));

    const stockByCode = new Map(
      stock.map((item) => [item.materialCode, Number(item.quantity) || 0]),
    );
    const depotsByCode = new Map<string, Record<string, number>>();
    for (const row of depotRows) {
      const values = depotsByCode.get(row.materialCode) ?? {};
      values[row.depot] = Number(row.quantity) || 0;
      depotsByCode.set(row.materialCode, values);
    }

    const effective=buildEffectiveBoms(records,approvedBoms);
    const calculated=calculateRequirements(records,effective.boms);
    const shortages=calculated.requirements.map((item)=>{
      const available=stockByCode.get(item.materialCode)??0;
      const depots=depotsByCode.get(item.materialCode)??{};
      return {...item,available,depots,shortage:Math.max(0,item.total-available)};
    }).filter((item)=>item.shortage>0);
    return Response.json({ source: { live: Boolean(live), fetchedAt: live?.fetchedAt }, ...calculated,...effective,stockItems:stock.length,shortages,purchases:shortages },{headers:{"cache-control":"no-store"}});
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudo calcular el consumo." }, { status: 500 }); }
}
