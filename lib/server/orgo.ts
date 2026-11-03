import "server-only";
import * as legacy from "./orgo-legacy";
import { dockerComputer, ComputerError } from "@/private-runtime/computer.mjs";
export * from "./orgo-legacy";
const privateMode = () => process.env.BOPS_PRIVATE_RUNTIME === "1";
const local = dockerComputer();

/** Existing Bops sessions, input and screenshot routes now dispatch here. */
export const orgo = new Proxy({} as typeof legacy.orgo, {
  get(_target, name: keyof typeof legacy.orgo) {
    if (!privateMode()) return legacy.orgo[name];
    const fn = local.api[name as keyof typeof local.api];
    if (typeof fn !== "function") throw new Error(`Unsupported private computer operation: ${String(name)}`);
    return async (...args: unknown[]) => {
      try { return await Reflect.apply(fn, local.api, args); }
      catch (e) {
        if (e instanceof ComputerError) throw new legacy.OrgoError(e.message, e.status, e.code);
        throw e;
      }
    };
  },
});
export const madeByThisServer = (id: string) => privateMode() ? local.madeByThisServer(id) : legacy.madeByThisServer(id);
export const madeReady = (id: string) => { if (privateMode()) local.madeReady(id); else legacy.madeReady(id); };
export const computerChanges = () => privateMode() ? local.computerChanges() : legacy.computerChanges();
export const webrtcWanted = () => !privateMode() && legacy.webrtcWanted();
export const screenStreamWanted = () => !privateMode() && legacy.screenStreamWanted();
export const apiKey: typeof legacy.apiKey = async () => {
  if (privateMode()) throw new Error("Orgo credentials are not used by the private runtime.");
  return legacy.apiKey();
};
export const callOrgo: typeof legacy.callOrgo = (...args) => {
  if (privateMode()) return Promise.resolve(null);
  return legacy.callOrgo(...args);
};

/** Teams remain local; never bind private workspaces to Orgo projects. */
export const perWorkspaceProjects: typeof legacy.perWorkspaceProjects = (...args) => privateMode() ? Promise.resolve(false) : legacy.perWorkspaceProjects(...args);
