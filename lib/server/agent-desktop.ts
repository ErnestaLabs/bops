import "server-only";
import { orgo } from "./orgo";

const OPS = ["snapshot","find","get","click","type","press","launch","wait"] as const;
type DesktopOp = (typeof OPS)[number];
type Args = { action?: DesktopOp; app?: string; ref?: string; role?: string; name?: string; text?: string; key?: string; property?: string; milliseconds?: number; exact?: boolean };
const safeText = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max;
const refPattern = /^@[A-Za-z0-9_-]{2,64}:[A-Za-z0-9_-]{1,64}$/;
const shq = (value: string) => "'" + value.replace(/'/g, "'\"'\"'") + "'";
const clip = (value: string, max = 16000) => value.length > max ? value.slice(0, max) + "\n… (cut)" : value;

export const AGENT_DESKTOP_TOOL = {
  type: "function",
  name: "desktop_accessibility",
  description: "Observe or operate a native app on your assigned private desktop through the OS accessibility tree. Snapshot/find before acting; refs are snapshot-scoped. Use this for native desktop UI, not web-page DOM work.",
  parameters: { type: "object", additionalProperties: false, required: ["action"], properties: {
    action: { type: "string", enum: OPS }, app: { type: "string" }, ref: { type: "string" }, role: { type: "string" }, name: { type: "string" },
    text: { type: "string" }, key: { type: "string" }, property: { type: "string" }, milliseconds: { type: "integer", minimum: 50, maximum: 30000 }, exact: { type: "boolean" }
  } }, strict: false,
} as const;

function command(a: Args): string[] {
  if (!OPS.includes(a.action as DesktopOp)) throw new Error("Invalid desktop action.");
  switch (a.action) {
    case "snapshot": if (!safeText(a.app,120)) throw new Error("snapshot requires app."); return ["snapshot","--app",a.app!,"-i","--compact"];
    case "find": {
      if (!safeText(a.app,120)) throw new Error("find requires app.");
      const out=["find","--app",a.app!]; if (a.role) out.push("--role",a.role); if (a.name) out.push("--name",a.name); if (a.exact) out.push("--exact"); return out;
    }
    case "get": if (!a.ref || !refPattern.test(a.ref) || !safeText(a.property,80)) throw new Error("get requires ref and property."); return ["get",a.ref,"--property",a.property!];
    case "click": if (!a.ref || !refPattern.test(a.ref)) throw new Error("click requires a valid snapshot ref."); return ["click",a.ref];
    case "type": if (!a.ref || !refPattern.test(a.ref) || typeof a.text!=="string" || a.text.length>4000) throw new Error("type requires ref and bounded text."); return ["type",a.ref,a.text];
    case "press": if (!safeText(a.key,120)) throw new Error("press requires key."); return ["press",a.key!];
    case "launch": if (!safeText(a.app,120) || !/^[A-Za-z0-9._+-]+$/.test(a.app!)) throw new Error("launch requires a simple app identifier."); return ["launch",a.app!];
    case "wait": { const ms=Number(a.milliseconds); if (!Number.isInteger(ms)||ms<50||ms>30000) throw new Error("wait requires 50-30000 milliseconds."); return ["wait",String(ms)]; }
  }
}
export async function runAgentDesktop(computerId: string, display: number, args: Args, signal?: AbortSignal): Promise<string> {
  if (!/^ernesta-[a-f0-9]{24}$/.test(computerId)) throw new Error("Agent Desktop is available only on a private Ernesta computer.");
  if (![99,100,101,102].includes(display)) throw new Error("Invalid desktop display.");
  const shell=["/usr/local/bin/bops-agent-desktop",String(display),...command(args)].map(shq).join(" ");
  const result=await orgo.bash(computerId,shell,35,signal?{signal}:undefined);
  const output=clip(result.output??"");
  if (result.exit_code!==0 && !output.trim()) throw new Error("Agent Desktop failed.");
  const envelope=JSON.parse(output); if (typeof envelope?.ok!=="boolean") throw new Error("Invalid Agent Desktop response.");
  return output;
}
