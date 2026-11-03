/** Public-safe transport errors. Never include provider response bodies or keys. */
export class InferenceError extends Error {
  constructor(message, code = 'invalid_request', status = 400) {
    super(message); this.name = 'InferenceError'; this.code = code; this.status = status;
  }
}
export const fail = (message, code, status) => { throw new InferenceError(message, code, status); };
