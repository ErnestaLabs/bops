import "server-only";
import * as legacy from "./plan-legacy";
import { orgo } from "./orgo";
import { stateEpoch } from "./store";
import { workspaceOf } from "@/lib/types";
export * from "./plan-legacy";
const privateMode = () => process.env.BOPS_PRIVATE_RUNTIME === "1";
export const makeMainComputer: typeof legacy.makeMainComputer = async (...args) => {
  if (!privateMode()) return legacy.makeMainComputer(...args);
  const [bot, name, epoch = stateEpoch()] = args;
  if (epoch !== stateEpoch()) throw new Error("Deployment state changed during provisioning.");
  return orgo.create(name, { wsId: workspaceOf(bot) });
};
export const makeOwnComputer: typeof legacy.makeOwnComputer = async (...args) => {
  if (!privateMode()) return legacy.makeOwnComputer(...args);
  const [bot, , name, epoch = stateEpoch()] = args;
  if (epoch !== stateEpoch()) throw new Error("Deployment state changed during provisioning.");
  // Fresh workers, never a copy of another bot's logged-in browser.
  return orgo.create(name, { wsId: workspaceOf(bot) });
};
export const orgoPlan: typeof legacy.orgoPlan = (...args) => privateMode() ? Promise.resolve(null) : legacy.orgoPlan(...args);
export const noOwnComputer: typeof legacy.noOwnComputer = (...args) => privateMode() ? Promise.resolve(null) : legacy.noOwnComputer(...args);
export const noMainComputer: typeof legacy.noMainComputer = (...args) => privateMode() ? Promise.resolve(null) : legacy.noMainComputer(...args);
export const holdFreeAgain: typeof legacy.holdFreeAgain = (...args) => privateMode() ? Promise.resolve(null) : legacy.holdFreeAgain(...args);
