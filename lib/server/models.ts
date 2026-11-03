import "server-only";
/** Private model selection never inherits an upstream GPT default. */
export function setting(fallback: string, ...names: string[]): string {
  const privateMode = process.env.BOPS_PRIVATE_RUNTIME === "1";
  if (privateMode && names.some(n => n.endsWith("_MODEL"))) {
    return process.env.BOPS_INFERENCE_MODEL?.trim() || "private-provider-not-configured";
  }
  if (privateMode && names.includes("BOPS_SPEED")) return "standard";
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return fallback;
}
