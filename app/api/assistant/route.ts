import {
  generalAssistantFallback,
  type GeneralAssistantContext,
} from "../../../lib/assistant";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      question?: string;
      context?: GeneralAssistantContext;
    };
    const question = String(body.question ?? "").trim().slice(0, 800);
    if (!question || !body.context)
      return Response.json({ error: "La consulta está incompleta." }, { status: 400 });

    const fallback = generalAssistantFallback(question, body.context);
    const runtime = await runtimeVariables();
    if (!runtime.OPENAI_API_KEY)
      return Response.json({ answer: fallback, mode: "local" });

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${runtime.OPENAI_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: runtime.OPENAI_MODEL || "gpt-5.6-sol",
          instructions:
            "Sos el asistente general de un ERP industrial de insumos para una bodega. Respondé en español argentino, de forma breve, cordial y concreta. Explicá el funcionamiento general, estado, sincronización, cambios, módulos y errores usando exclusivamente el contexto agregado. No respondas búsquedas puntuales de códigos o insumos y no inventes datos; para eso indicá el módulo y su buscador. Las filas tachadas en Google Sheets son operaciones realizadas y están excluidas de consumos, faltantes y compras.",
          input: `CONTEXTO DEL ERP:\n${JSON.stringify(body.context)}\n\nPREGUNTA:\n${question}`,
          max_output_tokens: 260,
        }),
      });
      if (!response.ok) throw new Error(`OpenAI respondió ${response.status}.`);
      const payload = await response.json() as {
        output_text?: string;
        output?: Array<{
          content?: Array<{ type?: string; text?: string }>;
        }>;
      };
      const answer =
        payload.output_text?.trim() ||
        payload.output
          ?.flatMap((item) => item.content ?? [])
          .find((item) => item.type === "output_text" && item.text)
          ?.text?.trim();
      return Response.json({ answer: answer || fallback, mode: answer ? "ai" : "local" });
    } catch {
      return Response.json({ answer: fallback, mode: "local" });
    }
  } catch {
    return Response.json({ error: "No se pudo procesar la consulta." }, { status: 400 });
  }
}

async function runtimeVariables() {
  const values: Record<string, string | undefined> = {
    OPENAI_API_KEY:
      typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined,
    OPENAI_MODEL:
      typeof process !== "undefined" ? process.env.OPENAI_MODEL : undefined,
  };
  try {
    const workers = await import("cloudflare:workers");
    const workerEnv = workers.env as unknown as Record<string, unknown>;
    for (const name of Object.keys(values))
      if (!values[name] && typeof workerEnv[name] === "string")
        values[name] = workerEnv[name] as string;
  } catch {
    // La validación local no expone el entorno de Cloudflare.
  }
  return values;
}
