/** Process-local vendor egress guard, preloaded before Next and inherited by Node children.
 * Not an OS firewall: customer firewalls must also govern browsers/non-Node processes.
 */
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const DENIED = ['openai.com', 'orgo.ai', 'bops.bot', 'x.ai'];
export function assertDestination(input) {
  let host;
  if (typeof input === 'string' || input instanceof URL) host = new URL(input).hostname;
  else if (input?.url) host = new URL(input.url).hostname;
  else host = input?.hostname || input?.host || 'localhost';
  host = String(host).replace(/:\d+$/, '').toLowerCase().replace(/\.$/, '');
  if (DENIED.some(d => host === d || host.endsWith(`.${d}`))) throw new Error('Legacy vendor destination blocked by private-runtime policy.');
}
export function installPolicy() {
  if (globalThis[Symbol.for('ernesta.private.network-policy')]) return;
  globalThis[Symbol.for('ernesta.private.network-policy')] = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    assertDestination(input);
    // No hidden redirects to a different inference/telemetry provider.
    return originalFetch(input, { ...options, redirect: 'error' });
  };
  for (const transport of [http, https]) {
    const request = transport.request;
    transport.request = function (...args) {
      assertDestination(args[0]);
      if (args[1] && typeof args[1] === 'object') assertDestination(args[1]);
      return Reflect.apply(request, this, args);
    };
    transport.get = function (...args) { const request = this.request(...args); request.end(); return request; };
  }
  syncBuiltinESMExports();
}
if (process.env.BOPS_PRIVATE_RUNTIME === '1') installPolicy();
