import { getState } from "@/lib/server/store";
import { fromBopsWindow } from "@/lib/server/ui-token";
import { snapshot } from "@/private-runtime/workflows/snapshot.mjs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (process.env.BOPS_PRIVATE_RUNTIME !== "1" || !/^[a-f0-9]{64}$/i.test(process.env.BOPS_UI_TOKEN || "") || !fromBopsWindow(request)) {
    return Response.json({ error: "Private owner authentication required." }, { status: 401 });
  }
  return Response.json(snapshot(getState()), { headers: { "Cache-Control": "no-store" } });
}
