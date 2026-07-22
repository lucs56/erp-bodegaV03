import test from "node:test";
import assert from "node:assert/strict";
import { calculateMonthlyPurchases, normalizePlanningMonth, parseIncomingRows, parseMonthlyPlanRows } from "../lib/monthly-planning.ts";

test("importa estimados tanto en formato largo como por columnas mensuales",()=>{
  const long=parseMonthlyPlanRows([{"Mes":"Agosto 2026","Código producto":"P1","Producto":"Malbec","Botellas":1200,"Cj x":12}],2026);
  const wide=parseMonthlyPlanRows([{"Código":"P2","Descripción":"Chardonnay","Cj x":6,"Agosto":600,"Septiembre":900}],2026);
  assert.equal(long.items[0].month,"2026-08");assert.equal(long.items[0].unitsPerBox,12);
  assert.deepEqual(wide.items.map(item=>[item.month,item.bottles,item.unitsPerBox]),[["2026-08",600,6],["2026-09",900,6]]);
  assert.equal(normalizePlanningMonth("noviembre 2026"),"2026-11");
});

test("descuenta stock y pendientes por mes antes de planificar compras",()=>{
  const plan=[{id:"1",month:"2026-08",productCode:"P1",productName:"Malbec",bottles:150_000,unitsPerBox:12 as const,notes:""},{id:"2",month:"2026-09",productCode:"P1",productName:"Malbec",bottles:150_000,unitsPerBox:12 as const,notes:""}];
  const boms=[{code:"P1",name:"Malbec",items:[{materialCode:"B1",materialName:"Botella",category:"Botellas",quantity:1,unit:"unidad",action:"FRACCIONAR"},{materialCode:"C1",materialName:"Caja x12",category:"Cajas",quantity:1/12,unit:"unidad",action:"FRACCIONAR"}]}];
  const stock=[{materialCode:"B1",materialName:"Botella",category:"Botellas",quantity:200_000,unit:"unidad",depots:{"2":100_000,C18:100_000}},{materialCode:"C1",materialName:"Caja",category:"Cajas",quantity:0,unit:"unidad"}];
  const incoming=[{id:"i",expectedMonth:"2026-09",materialCode:"B1",materialName:"Botella",quantity:30_000,supplier:"",orderReference:"",notes:""}];
  const result=calculateMonthlyPurchases(plan,boms,stock,incoming);
  const bottles=result.lines.filter(line=>line.materialCode==="B1");
  assert.deepEqual(bottles.map(line=>[line.month,line.openingStock,line.incoming,line.purchase]),[["2026-08",200_000,0,0],["2026-09",50_000,30_000,70_000]]);
  assert.equal(result.lines.find(line=>line.materialCode==="C1"&&line.month==="2026-08")?.grossRequirement,12_500);
});

test("importa pendientes con mes de entrega",()=>{
  const parsed=parseIncomingRows([{"Código insumo":"B1","Descripción":"Botella","Cantidad pendiente":80_000,"Fecha entrega":"octubre 2026","OC":"45001"}],2026);
  assert.equal(parsed.items[0].expectedMonth,"2026-10");assert.equal(parsed.items[0].orderReference,"45001");
});
