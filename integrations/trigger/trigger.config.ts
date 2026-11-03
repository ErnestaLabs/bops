import { defineConfig } from "@trigger.dev/sdk";
import { selfHostedEndpoint } from "../../private-runtime/workflows/skyvern-client.mjs";

// Fail closed instead of silently deploying to Trigger Cloud.
const endpoint = selfHostedEndpoint(process.env.TRIGGER_API_URL);
if (new URL(endpoint).hostname.endsWith("trigger.dev")) throw new Error("Use a customer-owned Trigger.dev instance.");
if (!process.env.TRIGGER_PROJECT_REF?.trim()) throw new Error("TRIGGER_PROJECT_REF is required.");

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF,
  runtime: "node",
  dirs: ["./src"],
  maxDuration: 1200,
  retries: { enabledInDev: false, default: { maxAttempts: 1 } },
});
