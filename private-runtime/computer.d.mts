export class ComputerError extends Error { code: string; status: number; }
export function workerId(value: unknown): string;
export function displayOf(value: unknown): number;
export function dockerComputer(options?: { env?: NodeJS.ProcessEnv }): {
  api: Record<string, (...args: never[]) => Promise<unknown>>;
  madeByThisServer(id: string): boolean;
  madeReady(id: string): boolean;
  computerChanges(): number;
};
