import "server-only";
import * as legacy from "./orgo-auth-legacy";
export * from "./orgo-auth-legacy";
const privateMode = () => process.env.BOPS_PRIVATE_RUNTIME === "1";
/** No legacy keychain lookup, remote sign-in, or cloud-proxy credential in private mode. */
export const loadOrgoKey: typeof legacy.loadOrgoKey = (...args) => privateMode() ? Promise.resolve(null) : legacy.loadOrgoKey(...args);
export const orgoKey: typeof legacy.orgoKey = () => privateMode() ? null : legacy.orgoKey();
export const cloudKey: typeof legacy.cloudKey = () => privateMode() ? null : legacy.cloudKey();
/** Fail closed for leftover account/plan paths, rather than contact the vendor. */
export const orgoOrigin = () => {
  if (privateMode()) throw new Error("Orgo account services are disabled in private mode.");
  return legacy.orgoOrigin();
};
