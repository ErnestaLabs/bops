import { fromBopsWindow } from "@/lib/server/ui-token";
import { activateStoredDraft } from "@/private-runtime/onboarding/transcript.mjs";
export const dynamic = "force-dynamic";
function authorized(request: Request) {
  return process.env.BOPS_PRIVATE_RUNTIME === "1" && /^[a-f0-9]{64}$/i.test(process.env.BOPS_UI_TOKEN || "") && fromBopsWindow(request);
}
export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Private owner authentication required." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const value = body as { clientId?: unknown; reviewHash?: unknown };
  if (typeof value.clientId !== "string" || typeof value.reviewHash !== "string") return Response.json({ error: "clientId and reviewHash are required." }, { status: 400 });
  try {
    const { active } = activateStoredDraft(value.clientId, value.reviewHash);
    return Response.json({ status: active.status, clientId: active.clientId, activatedAt: active.activatedAt, reviewHash: active.activation.approvedHash }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Activation failed." }, { status: 409 });
  }
}
