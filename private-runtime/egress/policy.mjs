/** Exact-host HTTP(S) egress policy. Public IPv4 only; every request re-resolves
 * and pins the checked address. There is deliberately no wildcard or private-IP
 * override in production configuration.
 */
import { isIP } from 'node:net';
import { resolve4 } from 'node:dns/promises';
import { assertDestination } from '../network-policy.mjs';
export class EgressDenied extends Error {
  constructor() { super('Destination not permitted.'); this.name = 'EgressDenied'; }
}
export function hostname(value) {
  if (typeof value !== 'string' || value.length > 253 || !/^[a-zA-Z0-9.-]+$/.test(value)) throw new EgressDenied();
  const host = value.toLowerCase().replace(/\.$/, '');
  if (isIP(host) || !host.includes('.') || !host.split('.').every(s => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s))) throw new EgressDenied();
  if (['localhost', 'local', 'internal', 'test', 'invalid'].some(s => host === s || host.endsWith(`.${s}`))) throw new EgressDenied();
  try { assertDestination(`https://${host}`); } catch { throw new EgressDenied(); }
  return host;
}
export function allowHosts(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 32768) throw new EgressDenied();
  const hosts = value.split(',').map(s => hostname(s.trim()));
  if (hosts.length > 128) throw new EgressDenied();
  return new Set(hosts);
}
export function publicIPv4(address) {
  // Azure's WireServer is a virtual platform endpoint despite its public-looking IP.
  if (isIP(address) !== 4 || address === '168.63.129.16') return false;
  const [a, b, c] = address.split('.').map(Number);
  // Non-global special-purpose blocks. Includes metadata/link-local, CGNAT,
  // multicast, benchmarking, documentation and deprecated relay ranges.
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && [0, 2].includes(c)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}
export function target(raw, connect = false) {
  if (typeof raw !== 'string' || raw.length > 16384 || /[\s\\#]/.test(raw)) throw new EgressDenied();
  if (connect && !/^[a-zA-Z0-9.-]+:443$/.test(raw)) throw new EgressDenied();
  let url;
  try { url = new URL(connect ? `https://${raw}` : raw); } catch { throw new EgressDenied(); }
  if (url.username || url.password || url.protocol !== (connect ? 'https:' : 'http:') || url.port) throw new EgressDenied();
  return { host: hostname(url.hostname), port: connect ? 443 : 80, path: url.pathname + url.search };
}
export async function resolveTarget(raw, { connect = false, allowed, resolve = resolve4, timeoutMs = 5000 } = {}) {
  const dest = target(raw, connect);
  if (!allowed?.has(dest.host)) throw new EgressDenied();
  let timer;
  try {
    const addresses = await Promise.race([
      resolve(dest.host),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new EgressDenied()), timeoutMs); }),
    ]);
    if (!Array.isArray(addresses) || !addresses.length || addresses.length > 64 || !addresses.every(publicIPv4)) throw new EgressDenied();
    return { ...dest, address: addresses[0] };
  } finally { clearTimeout(timer); }
}
