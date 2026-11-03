import { timingSafeEqual } from "node:crypto";
import { loopbackAuthority } from "@/private-runtime/request-origin.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" };
let attempts = 0;
let windowStart = 0;
const active = () => process.env.BOPS_PRIVATE_RUNTIME === "1" && process.env.BOPS_PRIVATE_AUTH === "loopback" && !!process.env.BOPS_UI_TOKEN;
export function GET() {
  if (!active()) return new Response("Private login is not enabled.", { status: 404, headers });
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Private workforce login</title><body style="font:18px system-ui;max-width:32rem;margin:12vh auto;padding:1rem"><h1>Your private workforce</h1><p>Enter the owner token stored on this server. Never send it through chat.</p><form method="post"><label>Owner token <input name="token" type="password" required autocomplete="current-password" style="display:block;width:100%;margin:1rem 0"></label><button>Sign in</button></form></body></html>`, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}
export async function POST(request: Request) {
  if (!active()) return new Response("Private login is not enabled.", { status: 404, headers });
  // Use the browser's validated loopback authority, not Next's internal URL.
  try { loopbackAuthority(request.headers.get("host"), request.headers.get("origin")); }
  catch { return new Response("Invalid host or origin.", { status: 403, headers }); }
  if (Date.now() - windowStart > 60000) { attempts = 0; windowStart = Date.now(); }
  if (++attempts > 10) return new Response("Try again later.", { status: 429, headers: { ...headers, "Retry-After": "60" } });
  const reader = request.body?.getReader();
  if (!reader) return new Response("Missing token.", { status: 400, headers });
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 4096) { await reader.cancel(); return new Response("Request too large.", { status: 413, headers }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const given = new URLSearchParams(Buffer.concat(chunks).toString()).get("token") || "";
  const want = process.env.BOPS_UI_TOKEN!;
  const a = Buffer.from(given), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Invalid token.", { status: 401, headers });
  attempts = 0;
  return new Response(null, { status: 303, headers: { ...headers, Location: "/", "Set-Cookie": `bops_window=${encodeURIComponent(want)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` } });
}
