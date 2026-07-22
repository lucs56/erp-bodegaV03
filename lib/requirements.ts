import type { ProgramRecord } from "./program-data";
import { suggestBomFromProgram } from "./bom-suggestions.ts";

export type BomDefinition = { productCode: string; items: Array<{ materialCode: string; materialName: string; category: string; quantity: number; unit: string; action: string; substitutes: string[] }> };
export type MaterialRequirement = { materialCode: string; materialName: string; category: string; unit: string; total: number; substitutes: string[]; weeks: Array<{ weekId: string; weekLabel: string; quantity: number }>; products: Array<{ productCode: string; productName: string; quantity: number }> };

export function buildEffectiveBoms(records:ProgramRecord[],approved:BomDefinition[]){const approvedCodes=new Set(approved.map(bom=>bom.productCode));const provisional=[...new Set(records.map(record=>record.productCode).filter(Boolean))].filter(code=>!approvedCodes.has(code)).map(productCode=>({productCode,items:suggestBomFromProgram(records,productCode).items})).filter(bom=>bom.items.length>0);return{boms:[...approved,...provisional],approvedProducts:approved.length,provisionalProducts:provisional.length};}

export function calculateRequirements(records: ProgramRecord[], boms: BomDefinition[]) {
  const bomByProduct = new Map(boms.map((bom) => [bom.productCode, bom]));
  const mapped = records.filter((record) => record.productCode && bomByProduct.has(record.productCode));
  const blocked = records.filter((record) => !record.productCode || !bomByProduct.has(record.productCode));
  const requirements = new Map<string, MaterialRequirement>();
  for (const record of mapped) {
    const bom = bomByProduct.get(record.productCode)!;
    for (const item of bom.items.filter((candidate) => candidate.action === record.action)) {
      const consumed = record.bottles * item.quantity;
      const key = `${item.materialCode}|${item.unit}`;
      const current = requirements.get(key) ?? { materialCode: item.materialCode, materialName: item.materialName, category: item.category, unit: item.unit, total: 0, substitutes: item.substitutes, weeks: [], products: [] };
      current.total += consumed;
      const week = current.weeks.find((value) => value.weekId === record.weekId);
      if (week) week.quantity += consumed; else current.weeks.push({ weekId: record.weekId, weekLabel: record.weekLabel, quantity: consumed });
      const product = current.products.find((value) => value.productCode === record.productCode);
      const productName = `${record.brand} · ${record.variety} ${record.vintage}`.trim();
      if (product) product.quantity += consumed; else current.products.push({ productCode: record.productCode, productName, quantity: consumed });
      requirements.set(key, current);
    }
  }
  return { requirements: [...requirements.values()].sort((a, b) => a.category.localeCompare(b.category) || a.materialCode.localeCompare(b.materialCode)), mappedOperations: mapped.length, blockedOperations: blocked.length, blockedProducts: [...new Map(blocked.map((record) => [record.productCode || `fila-${record.sourceRow}`, { productCode: record.productCode, productName: `${record.brand} · ${record.variety} ${record.vintage}`.trim(), sourceSheet: record.sourceSheet, sourceRow: record.sourceRow }])).values()] };
}
