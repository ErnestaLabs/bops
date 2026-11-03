import { NextResponse, type NextRequest } from "next/server";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const TAILNET_PATHS = new Set(["/api/apps/call", "/api/phone/agentphone", "/api/phone/openai", "/api/channels/slack/events"]);
const TUNNEL_PATHS = new Set(["/api/cloud/event"]);
const READS = new Set(["GET", "HEAD"]);
const OPEN_READS = (path: string) => path === "/api/health" || path.startsWith("/api/pages/") || path.startsWith("/api/files/") || /^\/api\/made-apps\/[^/]+\/view$/.test(path);
function fromWindow(request: NextRequest, want: string) {
  const got = request.cookies.get("bops_window")?.value ?? request.headers.get("x-bops-window") ?? "";
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}
const hostname = (host: string) => host.replace(/:\d+$/, "").toLowerCase();
const PUBLIC = new Set((process.env.BOPS_PUBLIC_HOST ?? "").split(",").map(h => hostname(h.trim())).filter(Boolean));
const HOSTED = !!process.env.BOPS_DATABASE_URL;
const ours = (name: string) => LOOPBACK.has(name) || PUBLIC.has(name) || (HOSTED && !PUBLIC.size);
export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const origin = request.headers.get("origin");
  const path = request.nextUrl.pathname;
  const method = request.method.toUpperCase();
  if (process.env.BOPS_PRIVATE_RUNTIME === "1") {
    // A host check is not a firewall. start.mjs also binds to 127.0.0.1.
    const token = process.env.BOPS_UI_TOKEN;
    if (!token || process.env.BOPS_PRIVATE_AUTH !== "loopback") return NextResponse.json({ error: "Private authentication is not configured." }, { status: 503 });
    if (!LOOPBACK.has(hostname(host))) return new NextResponse("Loopback only", { status: 403 });
    if (origin) {
      try { if (new URL(origin).host.toLowerCase() !== host.toLowerCase()) return new NextResponse("Invalid origin", { status: 403 }); }
      catch { return new NextResponse("Invalid origin", { status: 403 }); }
    }
    if ((path === "/api/health" && READS.has(method)) || path === "/api/private-login") return NextResponse.next();
    if (!fromWindow(request, token)) return NextResponse.json({ error: "Sign in at /api/private-login." }, { status: 401 });
    if (TAILNET_PATHS.has(path) || TUNNEL_PATHS.has(path)) return NextResponse.json({ error: "Legacy webhook and cloud routes are disabled." }, { status: 501 });
    return NextResponse.next();
  }
  // Preserve the upstream policy outside private mode.
  if (!ours(hostname(host)) && !TAILNET_PATHS.has(path)) return new NextResponse("Not allowed", { status: 403 });
  if (origin) {
    let from = "";
    try { from = new URL(origin).host; } catch {}
    if (from.toLowerCase() !== host.toLowerCase() && !PUBLIC.has(hostname(from))) return new NextResponse("Not allowed", { status: 403 });
  }
  const token = process.env.BOPS_UI_TOKEN;
  const open = TAILNET_PATHS.has(path) || TUNNEL_PATHS.has(path) || method === "OPTIONS" || (READS.has(method) && OPEN_READS(path));
  if (token && !open && !fromWindow(request, token)) return NextResponse.json({ error: "Only the Bops app can do that." }, { status: 403 });
  return NextResponse.next();
}
export const config = { matcher: "/api/:path*" };
