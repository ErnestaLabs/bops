import { fromBopsWindow } from "@/lib/server/ui-token";
import { extractTranscript, persistDraft } from "@/private-runtime/onboarding/transcript.mjs";
export const dynamic = "force-dynamic";
const MAX = 2 * 1024 * 1024;
function authorized(request: Request) {
  return process.env.BOPS_PRIVATE_RUNTIME === "1" && /^[a-f0-9]{64}$/i.test(process.env.BOPS_UI_TOKEN || "") && fromBopsWindow(request);
}
export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Private owner authentication required." }, { status: 401 });
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX + 16384) return Response.json({ error: "Transcript too large." }, { status: 413 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const value = body as { transcript?: unknown; type?: unknown; clientId?: unknown };
  if (typeof value.transcript !== "string" || typeof value.type !== "string" || typeof value.clientId !== "string") return Response.json({ error: "transcript, type and clientId are required." }, { status: 400 });
  try {
    const { draft } = await extractTranscript({ text: value.transcript, type: value.type, clientId: value.clientId });
    persistDraft(draft);
    return Response.json(draft, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Adaptation failed." }, { status: 422 });
  }
}
