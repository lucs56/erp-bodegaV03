import "server-only";
import * as XLSX from "xlsx";
import { parseProgramSheet, type ParsedWeek } from "./program-parser";
import { readSettings } from "./app-settings";
import { getD1Database } from "../db";

const DEFAULT_SHEET_ID = "1XL44rx3sNKpxowAQzY1iSjy7s8lYOsPTMngD6xeBDPQ";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let cachedToken: { value: string; expiresAt: number } | null = null;
let cachedProgram:{value:LiveProgram;expiresAt:number}|null=null;
let pendingProgram:Promise<LiveProgram|null>|null=null;

export type LiveProgram = {
  spreadsheetId: string;
  title: string;
  fetchedAt: string;
  weeks: ParsedWeek[];
};

export async function readLiveProgram(force=false): Promise<LiveProgram | null> {
  const settings=await readSettings();
  if(!force&&cachedProgram&&cachedProgram.expiresAt>Date.now())return cachedProgram.value;
  if(!force){const shared=await readSharedCache(settings.cacheSeconds);if(shared)return shared;}
  if(pendingProgram)return pendingProgram;
  pendingProgram=fetchLiveProgram(settings.spreadsheetId).then(async value=>{if(value){cachedProgram={value,expiresAt:Date.now()+settings.cacheSeconds*1000};await writeSharedCache(value);}return value;}).finally(()=>{pendingProgram=null;});
  return pendingProgram;
}

async function readSharedCache(maxAgeSeconds:number){try{const db=await getD1Database();const row=await db.prepare("SELECT value,fetched_at FROM program_cache WHERE key = ?").bind("live").first<{value:string;fetched_at:string}>();if(row&&Date.now()-new Date(row.fetched_at).getTime()<maxAgeSeconds*1000)return JSON.parse(row.value) as LiveProgram;}catch{}return null;}
export async function readLastStoredProgram(){try{const db=await getD1Database();const row=await db.prepare("SELECT value FROM program_cache WHERE key = ?").bind("live").first<{value:string}>();return row?.value?JSON.parse(row.value) as LiveProgram:null;}catch{return null;}}
async function writeSharedCache(value:LiveProgram){try{const db=await getD1Database();await db.prepare("INSERT INTO program_cache (key,value,fetched_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,fetched_at=excluded.fetched_at").bind("live",JSON.stringify(value),value.fetchedAt).run();}catch{}}

async function fetchLiveProgram(configuredSpreadsheetId:string): Promise<LiveProgram | null> {
  const runtimeEnv = await runtimeVariables();
  const serviceAccountEmail = runtimeEnv.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL;
  const privateKey = runtimeEnv.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const spreadsheetId = configuredSpreadsheetId || runtimeEnv.GOOGLE_SHEET_ID || DEFAULT_SHEET_ID;
  if (!serviceAccountEmail || !privateKey) return readPublicWorkbook(spreadsheetId);
  const token = await accessToken(serviceAccountEmail, privateKey);
  const metadataUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
  metadataUrl.searchParams.set("fields", "properties(title),sheets(properties(sheetId,title,index,hidden,gridProperties(rowCount)))");
  const metadata = await googleJson<{
    properties?: { title?: string };
    sheets?: Array<{ properties?: { sheetId?: number; title?: string; index?: number; hidden?: boolean; gridProperties?: { rowCount?: number } } }>;
  }>(metadataUrl, token);

  const tabs = (metadata.sheets ?? [])
    .map((sheet) => sheet.properties)
    .filter((properties): properties is NonNullable<typeof properties> => Boolean(properties?.title) && !properties?.hidden)
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  if (tabs.length === 0) throw new Error("La planilla no contiene pestañas visibles.");

  const batchUrl = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet`);
  batchUrl.searchParams.set("majorDimension", "ROWS");
  batchUrl.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  for (const tab of tabs) {
    const escapedTitle = String(tab.title).replace(/'/g, "''");
    const rowLimit = Math.min(tab.gridProperties?.rowCount ?? 1500, 5000);
    batchUrl.searchParams.append("ranges", `'${escapedTitle}'!A1:Z${rowLimit}`);
  }
  const values = await googleJson<{ valueRanges?: Array<{ values?: unknown[][] }> }>(batchUrl, token);
  const weeks = tabs
    .map((tab, index) => parseProgramSheet({
      sheetId: Number(tab.sheetId ?? 0),
      title: String(tab.title),
      values: values.valueRanges?.[index]?.values ?? [],
    }))
    .filter((week) => week.weekId !== "unknown");

  return {
    spreadsheetId,
    title: metadata.properties?.title ?? "Programación",
    fetchedAt: new Date().toISOString(),
    weeks,
  };
}

async function readPublicWorkbook(spreadsheetId:string):Promise<LiveProgram>{
  const url=new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export`);
  url.searchParams.set("format","xlsx");url.searchParams.set("_",Date.now().toString());
  const response=await fetch(url,{cache:"no-store",headers:{"cache-control":"no-cache, no-store",pragma:"no-cache"}});
  if(!response.ok)throw new Error(response.status===401||response.status===403?"Google Sheets no permite leer la programación. Compartila como lector mediante enlace.":`Google Sheets respondió ${response.status}.`);
  const workbook=XLSX.read(await response.arrayBuffer(),{type:"array",cellDates:true});
  const weeks=workbook.SheetNames.map((title,index)=>parseProgramSheet({sheetId:index+1,title,values:XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[title],{header:1,defval:"",raw:false})})).filter(week=>week.weekId!=="unknown");
  return{spreadsheetId,title:"Programación Junín",fetchedAt:new Date().toISOString(),weeks};
}

async function accessToken(email: string, privateKey: string) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64Url(new TextEncoder().encode(JSON.stringify({
    iss: email,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: now - 30,
    exp: now + 3600,
  })));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error(`Google rechazó la autenticación de solo lectura (${response.status}).`);
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Google no devolvió un token de acceso.");
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

async function googleJson<T>(url: URL, token: string): Promise<T> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`No se pudo leer Google Sheets (${response.status}).`);
  return response.json() as Promise<T>;
}

async function runtimeVariables() {
  const values: Record<string, string | undefined> = {
    GOOGLE_SHEET_ID: typeof process !== "undefined" ? process.env.GOOGLE_SHEET_ID : undefined,
    GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: typeof process !== "undefined" ? process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL : undefined,
    GOOGLE_SHEETS_PRIVATE_KEY: typeof process !== "undefined" ? process.env.GOOGLE_SHEETS_PRIVATE_KEY : undefined,
  };
  try {
    const workers = await import("cloudflare:workers");
    const workerEnv = workers.env as unknown as Record<string, unknown>;
    for (const name of Object.keys(values)) {
      if (!values[name] && typeof workerEnv[name] === "string") values[name] = workerEnv[name] as string;
    }
  } catch {
    // Node-based build validation does not expose the Cloudflare runtime module.
  }
  return values;
}

function pemBytes(pem: string) {
  const encoded = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
