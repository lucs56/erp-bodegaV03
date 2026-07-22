import { getD1Database } from "../../../../db";

type Item={materialCode?:string;materialName?:string;category?:string;quantity?:number;unit?:string;depots?:Record<string,number>};
export const dynamic="force-dynamic";
const CHUNK_SIZE=75;

export async function POST(request:Request){
  try{
    const payload=await request.json() as {items?:Item[]};
    if(!Array.isArray(payload.items)||!payload.items.length||payload.items.length>20_000)
      return Response.json({error:"El archivo debe contener entre 1 y 20.000 insumos."},{status:400});
    const now=new Date().toISOString();
    const values=payload.items.map(item=>({materialCode:item.materialCode?.trim()??"",materialName:item.materialName?.trim()??"",category:item.category?.trim()||"Otros",quantity:Number(item.quantity),unit:item.unit?.trim()||"unidad",depots:item.depots??{}}));
    if(values.some(item=>!item.materialCode||!item.materialName||!Number.isFinite(item.quantity)||item.quantity<0))
      return Response.json({error:"Hay filas con código, descripción o cantidad inválidos."},{status:400});

    const database=await getD1Database();
    for(let start=0;start<values.length;start+=CHUNK_SIZE){
      const chunk=values.slice(start,start+CHUNK_SIZE);
      await database.batch(chunk.map(item=>database.prepare(`
        INSERT INTO stock_items (material_code,material_name,category,quantity,unit,updated_at)
        VALUES (?1,?2,?3,?4,?5,?6)
        ON CONFLICT(material_code) DO UPDATE SET
          material_name=excluded.material_name,category=excluded.category,quantity=excluded.quantity,
          unit=excluded.unit,updated_at=excluded.updated_at
      `).bind(item.materialCode,item.materialName,item.category,item.quantity,item.unit,now)));
    }
    const depotValues=values.flatMap(item=>Object.entries(item.depots).filter(([,quantity])=>Number.isFinite(Number(quantity))&&Number(quantity)>=0).map(([depot,quantity])=>({materialCode:item.materialCode,depot:depot.trim().toUpperCase(),quantity:Number(quantity)}))).filter(item=>item.depot);
    for(let start=0;start<depotValues.length;start+=CHUNK_SIZE){
      const chunk=depotValues.slice(start,start+CHUNK_SIZE);
      await database.batch(chunk.map(item=>database.prepare(`
        INSERT INTO stock_depot_items (material_code,depot,quantity,updated_at)
        VALUES (?1,?2,?3,?4)
        ON CONFLICT(material_code,depot) DO UPDATE SET quantity=excluded.quantity,updated_at=excluded.updated_at
      `).bind(item.materialCode,item.depot,item.quantity,now)));
    }

    // El Excel representa una foto completa del stock: los códigos ausentes no
    // deben sobrevivir de una importación anterior y falsear los faltantes.
    await database.prepare("DELETE FROM stock_items WHERE updated_at <> ?1").bind(now).run();
    await database.prepare("DELETE FROM stock_depot_items WHERE updated_at <> ?1").bind(now).run();
    const verification=await database.prepare("SELECT COUNT(*) AS total FROM stock_items WHERE updated_at = ?1").bind(now).first<{total:number}>();
    const saved=Number(verification?.total??0);
    if(saved!==values.length)throw new Error(`La base confirmó ${saved} de ${values.length} insumos; la importación no se consideró completa.`);
    return Response.json({ok:true,imported:values.length,saved,depotRecords:depotValues.length,updatedAt:now});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"No se pudo importar el stock."},{status:500});}
}
