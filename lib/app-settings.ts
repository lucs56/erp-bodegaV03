import "server-only";
import { getD1Database } from "../db";

export type OperationalSettings={spreadsheetId:string;syncIntervalSeconds:number;cacheSeconds:number;includedDepots:string[]};
export const DEFAULT_SETTINGS:OperationalSettings={spreadsheetId:"1XL44rx3sNKpxowAQzY1iSjy7s8lYOsPTMngD6xeBDPQ",syncIntervalSeconds:60,cacheSeconds:60,includedDepots:["2","13","C18","R18","2OB"]};

export function validateSettings(value:Partial<OperationalSettings>):OperationalSettings{
  const spreadsheetId=String(value.spreadsheetId??"").trim();
  const syncIntervalSeconds=Number(value.syncIntervalSeconds);
  const cacheSeconds=Number(value.cacheSeconds);
  const includedDepots=[...new Set((value.includedDepots??[]).map(item=>String(item).trim().toUpperCase()).filter(Boolean))];
  if(!/^[a-zA-Z0-9_-]{20,}$/.test(spreadsheetId))throw new Error("El ID de Google Sheets no es válido.");
  if(!Number.isInteger(syncIntervalSeconds)||syncIntervalSeconds<10||syncIntervalSeconds>3600)throw new Error("La sincronización debe estar entre 10 y 3600 segundos.");
  if(!Number.isInteger(cacheSeconds)||cacheSeconds<0||cacheSeconds>300)throw new Error("La caché debe estar entre 0 y 300 segundos.");
  if(!includedDepots.length||includedDepots.length>20)throw new Error("Indicá entre 1 y 20 depósitos.");
  return{spreadsheetId,syncIntervalSeconds,cacheSeconds,includedDepots};
}

export async function readSettings():Promise<OperationalSettings>{
  try{
    const database=await getD1Database();
    const row=await database.prepare("SELECT value FROM app_settings WHERE key = ?").bind("operational").first<{value:string}>();
    return row?.value?validateSettings({...DEFAULT_SETTINGS,...JSON.parse(row.value)}):DEFAULT_SETTINGS;
  }catch{return DEFAULT_SETTINGS;}
}

export async function writeSettings(settings:OperationalSettings){
  const database=await getD1Database(),now=new Date().toISOString();
  await database.prepare("INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").bind("operational",JSON.stringify(settings),now).run();
}
