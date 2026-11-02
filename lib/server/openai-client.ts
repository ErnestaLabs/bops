import type { ClientOptions } from "openai";
import { openaiClient as legacyClient } from "./openai-client-legacy";
import { privateClient } from "@/private-runtime/inference.mjs";

/** Keep the existing Bops call sites; private mode translates to hosted Chat Completions.
 * The cast is an integration boundary, not a claim of full SDK compatibility.
 * Unsupported SDK surfaces fail explicitly without contacting a legacy provider.
 */
export function openaiClient(opts: Omit<ClientOptions, "apiKey" | "defaultHeaders"> = {}): ReturnType<typeof legacyClient> {
  return process.env.BOPS_PRIVATE_RUNTIME === "1"
    ? privateClient() as unknown as ReturnType<typeof legacyClient>
    : legacyClient(opts);
}
