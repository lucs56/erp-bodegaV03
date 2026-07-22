import { eq } from "drizzle-orm";import { getDb } from "../db";import { appUsers } from "../db/schema";
const COOKIE="erp_session";const SECRET="erp-bodega-demo-secret-change-before-production";
async function digest(value:string){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,"0")).join("")}
async function signature(value:string){return digest(`${SECRET}:${value}`)}
export async function passwordHash(password:string){return digest(`erp-demo:${password}`)}
export async function createSession(username:string){const value=`${username}:${Date.now()+1000*60*60*12}`;return `${value}:${await signature(value)}`}
export async function sessionUser(request:Request){const token=request.headers.get("cookie")?.split(";").map(value=>value.trim()).find(value=>value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);if(!token)return null;const parts=token.split(":");if(parts.length!==3)return null;const value=`${parts[0]}:${parts[1]}`;if(await signature(value)!==parts[2]||Number(parts[1])<Date.now())return null;const db=await getDb();return (await db.select().from(appUsers).where(eq(appUsers.username,parts[0])).limit(1))[0]??null}
export function sessionCookie(token:string){return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`}
export function clearSessionCookie(){return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`}
