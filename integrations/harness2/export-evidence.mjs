/** Build a sanitized Harness² improvement bundle from workflow evidence.
 * This is intentionally conservative: identifiers and counters only, no prompts,
 * secrets, raw browser content, screenshots, cookies, or external response bodies.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { createHash } from "node:crypto";

const input = process.argv[2], outDir = resolve(process.argv[3] || ".scratch/harness2");
if (!input) throw new Error("Usage: node export-evidence.mjs <run-json> [output-dir]");
const raw = JSON.parse(readFileSync(resolve(input),"utf8"));
const safe = {
  schemaVersion: 1,
  sourceFile: basename(input),
  workflowId: String(raw.workflowId || raw.workflow || "unknown").slice(0,128),
  state: String(raw.state || "unknown").slice(0,64),
  errorCode: raw.errorCode ? String(raw.errorCode).slice(0,64) : null,
  attempts: Number.isFinite(raw.attempts) ? raw.attempts : null,
  stepStates: Array.isArray(raw.events) ? raw.events.slice(-200).map(e => ({
    type: String(e.type || "").slice(0,64),
    from: String(e.from || "").slice(0,64),
    to: String(e.to || "").slice(0,64),
    errorCode: e.errorCode ? String(e.errorCode).slice(0,64) : null
  })) : []
};
const body = JSON.stringify(safe,null,2)+"
";
safe.digest = createHash("sha256").update(body).digest("hex");
mkdirSync(outDir,{recursive:true,mode:0o700});
writeFileSync(resolve(outDir,"evidence.json"),JSON.stringify(safe,null,2)+"
",{mode:0o600});
console.log(resolve(outDir,"evidence.json"));
