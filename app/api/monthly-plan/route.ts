import { getD1Database } from "../../../db";
import type { IncomingMaterial, MonthlyPlanRow } from "../../../lib/monthly-planning";

export const dynamic="force-dynamic";

export async function GET(){
  try{
    const database=await getD1Database();
    const [plan,incoming]=await Promise.all([
      database.prepare("SELECT id, month, product_code AS productCode, product_name AS productName, bottles, units_per_box AS unitsPerBox, notes FROM monthly_plan_rows ORDER BY month, product_code").all<MonthlyPlanRow>(),
      database.prepare("SELECT id, expected_month AS expectedMonth, material_code AS materialCode, material_name AS materialName, quantity, supplier, order_reference AS orderReference, notes FROM incoming_materials ORDER BY expected_month, material_code").all<IncomingMaterial>(),
    ]);
    return Response.json({plan:plan.results,incoming:incoming.results});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"No se pudo leer la planificación mensual."},{status:500});}
}

export async function PUT(request:Request){
  try{
    const payload=await request.json() as {plan?:MonthlyPlanRow[];incoming?:IncomingMaterial[]};
    const plan=Array.isArray(payload.plan)?payload.plan:[];const incoming=Array.isArray(payload.incoming)?payload.incoming:[];
    if(plan.length>5_000||incoming.length>10_000)return Response.json({error:"La planificación supera el límite permitido."},{status:400});
    if(plan.some(row=>!row.id||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(row.month)||!row.productCode.trim()||!Number.isFinite(Number(row.bottles))||Number(row.bottles)<=0||![6,12].includes(Number(row.unitsPerBox))))return Response.json({error:"Hay productos con mes, código, botellas o presentación inválidos."},{status:400});
    if(incoming.some(row=>!row.id||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(row.expectedMonth)||!row.materialCode.trim()||!Number.isFinite(Number(row.quantity))||Number(row.quantity)<=0))return Response.json({error:"Hay pendientes con mes, código o cantidad inválidos."},{status:400});
    const database=await getD1Database();const now=new Date().toISOString();
    const statements=[database.prepare("DELETE FROM monthly_plan_rows"),database.prepare("DELETE FROM incoming_materials"),...plan.map(row=>database.prepare("INSERT INTO monthly_plan_rows (id,month,product_code,product_name,bottles,units_per_box,notes,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)").bind(row.id,row.month,row.productCode.trim(),row.productName.trim(),Number(row.bottles),Number(row.unitsPerBox),row.notes??"",now)),...incoming.map(row=>database.prepare("INSERT INTO incoming_materials (id,expected_month,material_code,material_name,quantity,supplier,order_reference,notes,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)").bind(row.id,row.expectedMonth,row.materialCode.trim(),row.materialName.trim(),Number(row.quantity),row.supplier??"",row.orderReference??"",row.notes??"",now))];
    await database.batch(statements);
    return Response.json({ok:true,plan:plan.length,incoming:incoming.length,updatedAt:now});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"No se pudo guardar la planificación mensual."},{status:500});}
}
