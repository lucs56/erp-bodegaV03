export type MonthlyPlanRow = {
  id: string;
  month: string;
  productCode: string;
  productName: string;
  bottles: number;
  unitsPerBox: 6 | 12;
  notes: string;
};

export type IncomingMaterial = {
  id: string;
  expectedMonth: string;
  materialCode: string;
  materialName: string;
  quantity: number;
  supplier: string;
  orderReference: string;
  notes: string;
};

export type MonthlyBom = {
  code: string;
  name: string;
  items: Array<{materialCode:string;materialName:string;category:string;quantity:number;unit:string;action:string}>;
};

export type MonthlyStock = {materialCode:string;materialName:string;category:string;quantity:number;unit:string;depots?:Record<string,number>};

export type MonthlyPurchaseLine = {
  month:string;materialCode:string;materialName:string;category:string;unit:string;
  grossRequirement:number;openingStock:number;incoming:number;purchase:number;closingBalance:number;
  depots:Record<string,number>;products:string[];
};

const monthNames:Record<string,string>={enero:"01",febrero:"02",marzo:"03",abril:"04",mayo:"05",junio:"06",julio:"07",agosto:"08",septiembre:"09",setiembre:"09",octubre:"10",noviembre:"11",diciembre:"12"};
const normalize=(value:unknown)=>String(value??"").trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[_./-]+/g," ").replace(/\s+/g," ");
const valueFor=(row:Record<string,unknown>,aliases:string[])=>Object.entries(row).find(([key])=>aliases.includes(normalize(key)))?.[1];
const numeric=(value:unknown)=>{if(typeof value==="number")return value;const clean=String(value??"").trim().replace(/\s/g,"");if(!clean)return Number.NaN;return Number(clean.includes(",")&&clean.includes(".")?(clean.lastIndexOf(",")>clean.lastIndexOf(".")?clean.replace(/\./g,"").replace(",","."):clean.replace(/,/g,"")):clean.replace(",","."));};
const uid=()=>globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`;

export function normalizePlanningMonth(value:unknown,defaultYear=new Date().getFullYear()):string{
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}`;
  const text=String(value??"").trim();
  const iso=text.match(/\b(20\d{2})[-/]?(0?[1-9]|1[0-2])\b/);if(iso)return `${iso[1]}-${iso[2].padStart(2,"0")}`;
  const normalized=normalize(text);const name=Object.keys(monthNames).find(month=>normalized.includes(month));
  if(name){const year=normalized.match(/\b20\d{2}\b/)?.[0]??String(defaultYear);return `${year}-${monthNames[name]}`;}
  return "";
}

export function parseMonthlyPlanRows(rows:Record<string,unknown>[],defaultYear=new Date().getFullYear()):{items:MonthlyPlanRow[];errors:string[]}{
  const items:MonthlyPlanRow[]=[];const errors:string[]=[];
  rows.forEach((row,index)=>{
    const productCode=String(valueFor(row,["codigo","codigo producto","producto","sku"])??"").trim();
    const productName=String(valueFor(row,["descripcion","nombre","nombre producto","vino"])??"").trim();
    const unitsRaw=numeric(valueFor(row,["cj x","caja x","unidades por caja","presentacion","botellas por caja"]));
    const unitsPerBox=(unitsRaw===6?6:12) as 6|12;
    const notes=String(valueFor(row,["observaciones","notas"])??"").trim();
    const longMonth=normalizePlanningMonth(valueFor(row,["mes","periodo","fecha"]),defaultYear);
    const longBottles=numeric(valueFor(row,["botellas","cantidad botellas","cantidad","estimado"]));
    const candidates:Array<{month:string;bottles:number}>=[];
    if(longMonth&&Number.isFinite(longBottles))candidates.push({month:longMonth,bottles:longBottles});
    if(!candidates.length)for(const [header,value] of Object.entries(row)){const month=normalizePlanningMonth(header,defaultYear),bottles=numeric(value);if(month&&Number.isFinite(bottles))candidates.push({month,bottles});}
    if(!productCode&&!productName&&!candidates.length)return;
    if(!productCode){errors.push(`Fila ${index+2}: falta el código del producto.`);return;}
    if(!candidates.length){errors.push(`Fila ${index+2}: no se encontró mes y cantidad de botellas.`);return;}
    candidates.filter(candidate=>candidate.bottles>0).forEach(candidate=>items.push({id:uid(),month:candidate.month,productCode,productName,bottles:Math.round(candidate.bottles),unitsPerBox,notes}));
  });
  return{items,errors};
}

export function parseIncomingRows(rows:Record<string,unknown>[],defaultYear=new Date().getFullYear()):{items:IncomingMaterial[];errors:string[]}{
  const items:IncomingMaterial[]=[];const errors:string[]=[];
  rows.forEach((row,index)=>{const materialCode=String(valueFor(row,["codigo","codigo insumo","codigo material","insumo"])??"").trim();const materialName=String(valueFor(row,["descripcion","nombre insumo","nombre","material"])??"").trim();const quantity=numeric(valueFor(row,["cantidad pendiente","pendiente","cantidad","por recibir","saldo"]));const expectedMonth=normalizePlanningMonth(valueFor(row,["mes","fecha entrega","entrega","fecha prevista","periodo"]),defaultYear);if(!materialCode&&!materialName&&!Number.isFinite(quantity))return;if(!materialCode||!Number.isFinite(quantity)||quantity<=0||!expectedMonth){errors.push(`Fila ${index+2}: se requiere código, cantidad pendiente mayor a cero y mes de entrega.`);return;}items.push({id:uid(),expectedMonth,materialCode,materialName,quantity,supplier:String(valueFor(row,["proveedor"])??"").trim(),orderReference:String(valueFor(row,["orden de compra","oc","pedido","nro pedido"])??"").trim(),notes:String(valueFor(row,["observaciones","notas"])??"").trim()});});
  return{items,errors};
}

export function calculateMonthlyPurchases(plan:MonthlyPlanRow[],boms:MonthlyBom[],stock:MonthlyStock[],incoming:IncomingMaterial[]){
  const bomByCode=new Map(boms.map(item=>[item.code.trim().toUpperCase(),item]));const unmapped=plan.filter(row=>!bomByCode.has(row.productCode.trim().toUpperCase()));
  const demand=new Map<string,{month:string;materialCode:string;materialName:string;category:string;unit:string;quantity:number;products:Set<string>}>();
  for(const row of plan){const bom=bomByCode.get(row.productCode.trim().toUpperCase());if(!bom)continue;for(const item of bom.items.filter(item=>item.action.trim().toUpperCase()==="FRACCIONAR")){const isCase=normalize(item.category).includes("caja");const quantity=isCase?Math.ceil(row.bottles/row.unitsPerBox):row.bottles*item.quantity;const key=`${row.month}|${item.materialCode}`;const current=demand.get(key)??{month:row.month,materialCode:item.materialCode,materialName:item.materialName,category:item.category,unit:item.unit,quantity:0,products:new Set<string>()};current.quantity+=quantity;current.products.add(`${row.productCode} - ${row.productName||bom.name}`);demand.set(key,current);}}
  const months=[...new Set(plan.map(row=>row.month).filter(Boolean))].sort();const materialCodes=[...new Set([...demand.values()].map(item=>item.materialCode))];const lines:MonthlyPurchaseLine[]=[];
  for(const code of materialCodes){const stockItem=stock.find(item=>item.materialCode.trim().toUpperCase()===code.trim().toUpperCase());let balance=Number(stockItem?.quantity??0);for(const month of months){const openingStock=balance;const arriving=incoming.filter(entry=>entry.materialCode.trim().toUpperCase()===code.trim().toUpperCase()&&entry.expectedMonth===month).reduce((sum,entry)=>sum+entry.quantity,0);balance+=arriving;const item=demand.get(`${month}|${code}`);if(!item)continue;const purchase=Math.max(0,item.quantity-balance);balance=Math.max(0,balance-item.quantity);lines.push({month,materialCode:code,materialName:item.materialName||stockItem?.materialName||code,category:item.category||stockItem?.category||"Otros",unit:item.unit||stockItem?.unit||"unidad",grossRequirement:item.quantity,openingStock,incoming:arriving,purchase,closingBalance:balance,depots:stockItem?.depots??{},products:[...item.products]});}}
  return{lines,unmapped,totalGross:lines.reduce((sum,line)=>sum+line.grossRequirement,0),totalIncoming:incoming.reduce((sum,item)=>sum+item.quantity,0),totalPurchase:lines.reduce((sum,line)=>sum+line.purchase,0)};
}
