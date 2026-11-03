export class InferenceError extends Error { code: string; status: number; }
export function endpoint(value: string): string;
export function inputMessages(input: unknown): unknown[];
export function privateClient(options?: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch }): unknown;
