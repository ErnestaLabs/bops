// No native computer is touched. Exercises app allowlist, ref provenance and tool restrictions.
import assert from "node:assert/strict";
import { createGuard, TOOLS } from "../vm/agent-desktop-mcp.mjs";

assert.deepEqual(TOOLS, ["desktop_snapshot", "desktop_click", "desktop_set_value", "desktop_scroll_to"]);
assert.throws(() => createGuard([]), /approved app/);
assert.throws(() => createGuard(["Terminal"]), /Protected app/);
assert.throws(() => createGuard(["Bops"]), /Protected app/);
assert.throws(() => createGuard(["Keychain Access"]), /Protected app/);

const guard = createGuard(["Safari", "Notes"]);
assert.equal(guard.vet("desktop_snapshot", { app: "Safari" }).ok, true);
assert.equal(guard.vet("desktop_snapshot", { app: "Notes" }).ok, true);
for (const app of ["Bops", "Terminal", "System Settings", "Passwords", "Chrome"])
  assert.equal(guard.vet("desktop_snapshot", { app }).ok, false, app);
for (const args of [{}, { app: "Safari", root: "@s111:e1" }, { app: "Safari", surface: "focused" }])
  assert.equal(guard.vet("desktop_snapshot", args).ok, false);
for (const tool of ["desktop_clipboard_get", "desktop_press", "desktop_launch", "desktop_close_app", "desktop_screenshot", "desktop_batch"])
  assert.equal(guard.vet(tool, { ref: "@s111:e1" }).ok, false, tool);
assert.equal(guard.vet("desktop_click", { ref: "@s111:e1" }).ok, false);
assert.equal(guard.remember("desktop_snapshot", { app: "Safari" }, {
  content: [{ type: "text", text: JSON.stringify({ ok: true, data: { app: "Safari", snapshot_id: "s111" } }) }],
}), true);
assert.equal(guard.vet("desktop_click", { ref: "@s111:e1" }).ok, true);
assert.equal(guard.vet("desktop_set_value", { ref: "@s111:e2", value: "hello" }).ok, true);
assert.equal(guard.vet("desktop_scroll_to", { ref: "@s111:e3" }).ok, true);
assert.equal(guard.vet("desktop_click", { ref: "@s222:e1" }).ok, false);
assert.equal(guard.vet("desktop_click", { ref: "@s111:e1", headed: true }).ok, false);
assert.equal(guard.remember("desktop_snapshot", { app: "Safari" }, {
  content: [{ type: "text", text: JSON.stringify({ ok: true, data: { app: "Bops", snapshot_id: "s999" } }) }],
}), false);
assert.equal(guard.vet("desktop_click", { ref: "@s999:e1" }).ok, false);
console.log("Agent Desktop app/ref guard: passed");
