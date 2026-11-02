import OpenAI, { type ClientOptions } from "openai";
import { APP_VERSION_HEADER, BOPS_STATE_LEVEL_HEADER, STATE_LEVEL, TELEMETRY_HEADER } from "@/cloud/protocol";
import { appVersion, telemetryHere } from "./app-version";
import { cloudProxy } from "./cloud";

/**
 * Transitional SDK adapter. BOPS_PRIVATE_RUNTIME routes compatible SDK calls
 * to a customer-selected endpoint and never proxies those calls through Bops Cloud.
 * This alone does not implement Responses, computer tools, Agents or realtime.
 */
export function openaiClient(opts: Omit<ClientOptions, "apiKey" | "defaultHeaders"> = {}) {
  const privateMode = process.env.BOPS_PRIVATE_RUNTIME === "1";
  const baseUrl = process.env.BOPS_INFERENCE_BASE_URL?.trim().replace(/\/+$/, "");
  if (privateMode) {
    if (!baseUrl) throw new Error("BOPS_INFERENCE_BASE_URL is required in private runtime mode");
    const u = new URL(baseUrl);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(u.hostname))) {
      throw new Error("Private inference endpoint must use HTTPS or loopback HTTP");
    }
  }
  const client = new OpenAI({
    ...opts,
    defaultHeaders: privateMode ? {} : {
      get [APP_VERSION_HEADER]() { return cloudProxy("openai") ? (appVersion() ?? null) : null; },
      get [BOPS_STATE_LEVEL_HEADER]() { return cloudProxy("openai") ? String(STATE_LEVEL) : null; },
      get [TELEMETRY_HEADER]() { return cloudProxy("openai") && !telemetryHere() ? "off" : null; },
    },
    apiKey: async () => {
      if (privateMode) return process.env.BOPS_INFERENCE_API_KEY || "local-no-key";
      const via = cloudProxy("openai");
      if (via) return via.key;
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new OpenAI.OpenAIError("No OpenAI key is set");
      return key;
    },
    ...(privateMode ? { baseURL: baseUrl } : {}),
  });
  if (privateMode) return client;
  let direct = client.baseURL;
  Object.defineProperty(client, "baseURL", {
    get: () => {
      const via = cloudProxy("openai");
      return via ? `${via.url}/v1` : direct;
    },
    set: (url: string) => void (direct = url),
    configurable: true,
  });
  return client;
}
