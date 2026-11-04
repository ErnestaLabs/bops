import { defineConfig } from "@trigger.dev/sdk";
import { selfHostedEndpoint } from "../../private-runtime/workflows/skyvern-client.mjs";

/** The single Trigger config. The CLI only reads this file, so everything that
 * decides where work runs lives here: the endpoint policy, the project ref and
 * the task directories. Both reconciled branches pointed the CLI at a different
 * directory, which meant one branch's tasks were silently never deployed.
 *
 * Fail closed instead of silently deploying to Trigger Cloud.
 */
const endpoint = selfHostedEndpoint(process.env.TRIGGER_API_URL);
if (new URL(endpoint).hostname.endsWith("trigger.dev")) throw new Error("Use a customer-owned Trigger.dev instance.");

// Canonical name first; the other branch's spelling still resolves.
const projectRef = (process.env.TRIGGER_PROJECT_REF ?? process.env.WORKFORCE_TRIGGER_PROJECT ?? "").trim();
if (!projectRef) throw new Error("TRIGGER_PROJECT_REF is required.");

export default defineConfig({
  project: projectRef,
  runtime: "node",
  dirs: ["./src", "./tasks"],
  maxDuration: 1200,
  retries: { enabledInDev: false, default: { maxAttempts: 1 } },
});
