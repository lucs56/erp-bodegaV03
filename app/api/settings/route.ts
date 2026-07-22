import { sessionUser } from "../../../lib/auth";
import { readSettings,validateSettings,writeSettings } from "../../../lib/app-settings";

export async function GET(request:Request){
  const user=await sessionUser(request);if(!user||!user.active)return Response.json({error:"Sesión requerida."},{status:401});
  return Response.json({settings:await readSettings()});
}
export async function PUT(request:Request){
  try{const user=await sessionUser(request);if(!user||user.role!=="admin")return Response.json({error:"Solo el administrador puede modificar la configuración."},{status:403});const settings=validateSettings(await request.json());await writeSettings(settings);return Response.json({settings});}
  catch(error){return Response.json({error:error instanceof Error?error.message:"No se pudo guardar la configuración."},{status:400});}
}
