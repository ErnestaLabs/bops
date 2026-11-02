import "server-only";
import * as legacy from "./orgo-sign-in-legacy";
export * from "./orgo-sign-in-legacy";
export const authStatus: typeof legacy.authStatus = async (...args) => {
  if (process.env.BOPS_PRIVATE_RUNTIME !== "1") return legacy.authStatus(...args);
  // This is deployment identity, NOT the authentication check. proxy.ts requires
  // the private deployment's HTTP-only UI-token cookie before API access.
  if (!process.env.BOPS_UI_TOKEN || process.env.BOPS_PRIVATE_AUTH !== "loopback")
    throw new Error("Start private mode with its authenticated loopback launcher.");
  return { signedIn: true, user: { id: "private-owner", name: "Owner" }, needsSignIn: false, cloudProblem: false };
};
export const startSignIn: typeof legacy.startSignIn = (...args) => {
  if (process.env.BOPS_PRIVATE_RUNTIME === "1") return Promise.reject(new Error("Use this deployment's private login, not Orgo sign-in."));
  return legacy.startSignIn(...args);
};
