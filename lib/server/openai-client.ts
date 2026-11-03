import type { ClientOptions } from "openai";
import { openaiClient as legacyClient } from "./openai-client-legacy";
import { applicationClient } from "@/private-runtime/client-surface.mjs";

/** The private adapter exposes an ordinary, introspection-safe client object.
 * Unsupported services fail at invocation; no vendor fallback is permitted.
 */
export function openaiClient(opts: Omit<ClientOptions, "apiKey" | "defaultHeaders"> = {}): ReturnType<typeof legacyClient> {
  return process.env.BOPS_PRIVATE_RUNTIME === "1"
    ? applicationClient() as unknown as ReturnType<typeof legacyClient>
    : legacyClient(opts);
}
