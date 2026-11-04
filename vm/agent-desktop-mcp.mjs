#!/usr/bin/env node
// Opt-in Vercel Agent Desktop MCP bridge. This is intentionally app-scoped:
// the native desktop MCP has many machine-wide capabilities that Bops must not expose.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { offLimits } from "./mac-ui-mcp.mjs";

export const TOOLS = ["desktop_snapshot", "desktop_click", "desktop_set_value", "desktop_scroll_to"];
const REF = /^@?(s[a-zA-Z0-9_-]+):e[a-zA-Z0-9_-]+$/;
export function createGuard(apps) {
  const allowed = new Set(apps.map((x) => x.trim().toLowerCase()).filter(Boolean));
  if (!allowed.size) throw new Error("Set at least one approved app.");
  for (const app of allowed) if (offLimits({ name: app })) throw new Error("Protected app cannot be approved: " + app);
  const snapshots = new Map();
  const approved = (app) => typeof app === "string" && allowed.has(app.trim().toLowerCase()) && !offLimits({ name: app });
  function vet(name, args) {
    if (!TOOLS.includes(name)) return { ok: false, why: "Tool not permitted." };
    if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: false, why: "Arguments must be an object." };
    if (name === "desktop_snapshot") {
      if (!approved(args.app)) return { ok: false, why: "A named, approved app is required." };
      if (Object.keys(args).some((k) => k !== "app"))
        return { ok: false, why: "Only the approved app can be selected for a snapshot." };
      return { ok: true };
    }
    // Desktop actions require an element from a previously verified app snapshot.
    const ref = typeof args.ref === "string" ? args.ref : "";
    const match = ref.match(REF);
    if (!match || !snapshots.has(match[1])) return { ok: false, why: "Use a ref from an approved app snapshot." };
    const keys = name === "desktop_set_value" ? ["ref", "value"] : ["ref"];
    if (Object.keys(args).some((k) => !keys.includes(k)))
      return { ok: false, why: "Unexpected action argument or scope." };
    if (name === "desktop_set_value" && (typeof args.value !== "string" || args.value.length > 4000))
      return { ok: false, why: "Value must be a bounded string." };
    return { ok: true };
  }
  function remember(name, args, result) {
    if (name !== "desktop_snapshot") return true;
    const candidates = [result?.structuredContent, ...(result?.content ?? []).filter((c) => c?.type === "text").map((c) => {
      try { return JSON.parse(c.text); } catch { return null; }
    })];
    const data = candidates.map((x) => x?.data ?? x).find((x) => typeof x?.snapshot_id === "string" && typeof x?.app === "string");
    if (!data || !approved(data.app) || data.app.trim().toLowerCase() !== args.app.trim().toLowerCase()) return false;
    snapshots.set(data.snapshot_id, data.app);
    if (snapshots.size > 30) snapshots.delete(snapshots.keys().next().value);
    return true;
  }
  return { vet, remember };
}
function main() {
  const binIndex = process.argv.indexOf("--bin");
  const appsIndex = process.argv.indexOf("--apps");
  const bin = binIndex >= 0 ? process.argv[binIndex + 1] : "";
  const apps = appsIndex >= 0 ? process.argv[appsIndex + 1] : "";
  if (!bin?.startsWith("/") || !apps) throw new Error("Usage: --bin /absolute/agent-desktop --apps Safari,Notes");
  const guard = createGuard(apps.split(","));
  const child = spawn(bin, ["mcp"], { stdio: ["pipe", "pipe", "inherit"] });
  const pending = new Map();
  const reply = (m) => process.stdout.write(JSON.stringify(m) + "\n");
  const deny = (id, reason) => reply({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: reason }], isError: true } });
  createInterface({ input: child.stdout }).on("line", (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    const p = m.id !== undefined ? pending.get(m.id) : undefined;
    if (p) pending.delete(m.id);
    if (p?.method === "tools/list" && m.result)
      m.result.tools = (m.result.tools ?? []).filter((t) => TOOLS.includes(t.name));
    if (p?.method === "tools/call" && p.name === "desktop_snapshot" && !m.error && !m.result?.isError && !guard.remember(p.name, p.args, m.result)) {
      deny(m.id, "Desktop did not confirm the approved app and snapshot.");
      return;
    }
    reply(m);
  });
  createInterface({ input: process.stdin }).on("line", (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    const method = m.method;
    if (method === "tools/call") {
      const name = m.params?.name;
      const args = m.params?.arguments;
      const v = guard.vet(name, args);
      if (!v.ok) { deny(m.id, v.why); return; }
      pending.set(m.id, { method, name, args });
    } else if (method === "tools/list") {
      pending.set(m.id, { method });
    } else if (!["initialize", "notifications/initialized", "ping"].includes(method)) {
      if (m.id !== undefined) reply({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Unsupported MCP method." } });
      return;
    }
    child.stdin.write(JSON.stringify(m) + "\n");
  });
  child.on("exit", () => process.exit(1));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
