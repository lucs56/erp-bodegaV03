import { NextResponse } from "next/server";
import { readLastStoredProgram,readLiveProgram,type LiveProgram } from "../../../lib/google-sheets";

export const dynamic = "force-dynamic";

export async function GET(request:Request) {
  const params = new URL(request.url).searchParams;
  if (params.get("stored") === "1") {
    const stored = await readLastStoredProgram();
    return stored
      ? liveResponse(stored, true, "Última lectura compartida guardada en Cloudflare D1.")
      : snapshotResponse("Todavía no existe una lectura compartida guardada.");
  }
  if (params.get("background") === "1") {
    const stored = await readLastStoredProgram();
    await scheduleBackground(readLiveProgram(true).catch(() => null).then(() => undefined));
    return stored
      ? liveResponse(stored, true, "Sincronización iniciada en segundo plano.")
      : snapshotResponse("Sincronización inicial en curso. Los datos aparecerán automáticamente.");
  }
  try {
    const live = await readLiveProgram(params.get("fresh")==="1");
    if (live) {
      const records = live.weeks.flatMap((week) => week.records);
      return NextResponse.json(
        {
          source: { mode: "live", live: true, title: live.title, fetchedAt: live.fetchedAt },
          records,
          diagnostics: live.weeks.flatMap((week) => week.diagnostics.map((item) => ({ ...item, weekId: week.weekId, weekLabel: week.weekLabel }))),
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    return snapshotResponse("La conexión productiva de solo lectura todavía no está configurada.");
  } catch {
    const stored=await readLastStoredProgram();
    if(stored)return liveResponse(stored,false,"Google no respondió; se muestra la última lectura real guardada en D1.");
    return snapshotResponse("No se pudo leer Google Sheets y todavía no existe una lectura real guardada.");
  }
}

function liveResponse(live:LiveProgram,isLive:boolean,notice?:string){return NextResponse.json({source:{mode:isLive?"live":"stored",live:isLive,title:live.title,fetchedAt:live.fetchedAt,notice},records:live.weeks.flatMap(week=>week.records),diagnostics:live.weeks.flatMap(week=>week.diagnostics.map(item=>({...item,weekId:week.weekId,weekLabel:week.weekLabel})))},{headers:{"cache-control":"no-store"}});}

function snapshotResponse(notice: string) {
  return NextResponse.json(
    {
      source: { mode: "unavailable", live: false, title: "Programación", fetchedAt: new Date().toISOString(), notice },
      records: [],
      diagnostics: [],
    },
    { headers: { "cache-control": "no-store" } },
  );
}

async function scheduleBackground(task: Promise<void>) {
  try {
    const workers = await import("cloudflare:workers");
    workers.waitUntil(task);
  } catch {
    // La validación local no expone el módulo de Cloudflare. En ese entorno
    // dejamos que la tarea continúe sin bloquear la respuesta.
    void task;
  }
}
