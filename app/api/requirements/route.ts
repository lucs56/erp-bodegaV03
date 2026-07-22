import { asc } from "drizzle-orm";
import { getDb } from "../../../db";
import { bomItems, bomSubstitutes, products, stockDepotItems,stockItems } from "../../../db/schema";
import { readLiveProgram } from "../../../lib/google-sheets";
import { programRecords } from "../../../lib/program-data";
import { buildEffectiveBoms, calculateRequirements } from "../../../lib/requirements";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [live, db] = await Promise.all([readLiveProgram(), getDb()]);
    const [productRows, itemRows, substituteRows, stock,depotRows] = await Promise.all([db.select().from(products).orderBy(asc(products.code)), db.select().from(bomItems), db.select().from(bomSubstitutes).orderBy(asc(bomSubstitutes.priority)),db.select().from(stockItems),db.select().from(stockDepotItems)]);
    const records = live ? live.weeks.flatMap((week) => week.records) : programRecords;
    const approvedBoms = productRows.map((product) => ({ productCode: product.code, items: itemRows.filter((item) => item.productId === product.id).map((item) => ({ ...item, substitutes: substituteRows.filter((substitute) => substitute.bomItemId === item.id).map((substitute) => substitute.materialCode) })) }));
    const effective=buildEffectiveBoms(records,approvedBoms);const calculated=calculateRequirements(records,effective.boms); const shortages=calculated.requirements.map((item)=>{const available=stock.find((s)=>s.materialCode===item.materialCode)?.quantity??0;const depots=Object.fromEntries(depotRows.filter(row=>row.materialCode===item.materialCode).map(row=>[row.depot,row.quantity]));return {...item,available,depots,shortage:Math.max(0,item.total-available)};}).filter((item)=>item.shortage>0); return Response.json({ source: { live: Boolean(live), fetchedAt: live?.fetchedAt }, ...calculated,...effective,stockItems:stock.length,shortages,purchases:shortages });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudo calcular el consumo." }, { status: 500 }); }
}
