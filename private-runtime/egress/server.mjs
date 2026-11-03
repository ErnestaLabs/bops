/** Tenant-scoped forward proxy: exact host allowlist, no interception of TLS,
 * no secrets, URL logging, persistent state, published port or Docker socket.
 * Docker's internal worker network prevents clients bypassing this proxy for IP
 * internet traffic. This is not a hostile-code sandbox or TLS content filter.
 */
import http from 'node:http';
import net from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allowHosts, resolveTarget, EgressDenied } from './policy.mjs';
const MAX_BODY = 8 * 1024 * 1024;
const MAX_RESPONSE = 64 * 1024 * 1024;
export function cleanHeaders(headers) {
  const blocked = new Set(['connection', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']);
  for (const name of String(headers.connection || '').split(',')) blocked.add(name.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([k]) => !blocked.has(k.toLowerCase())));
}
export function createEgressProxy({ allowed, resolveDNS, dial = (address, port) => net.connect({ host: address, port, family: 4 }), idleMs = 30000, lifetimeMs = 300000 } = {}) {
  if (!(allowed instanceof Set) || !allowed.size) throw new EgressDenied();
  const sockets = new Set();
  const open = async dest => {
    const socket = dial(dest.address, dest.port);
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.setTimeout(idleMs, () => socket.destroy());
    const lifetime = setTimeout(() => socket.destroy(), lifetimeMs);
    socket.once('close', () => clearTimeout(lifetime));
    await new Promise((ok, bad) => {
      const done = () => { socket.off('error', bad); ok(); };
      socket.once('error', bad); socket.once('connect', done);
      socket.once('close', () => { socket.off('connect', done); bad(new Error('Connection closed')); });
    });
    return socket;
  };
  const reject = (res, status = 403) => {
    if (!res.headersSent) { res.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', Connection: 'close' }); res.end(status === 403 ? 'Destination not permitted.\n' : 'Egress unavailable.\n'); }
    else res.destroy();
  };
  const server = http.createServer({ maxHeaderSize: 16384 }, async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"ok":true}'); return; }
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method)) return reject(res);
    req.pause();
    let upstreamSocket, upstream;
    req.on('error', () => { upstream?.destroy(); upstreamSocket?.destroy(); res.destroy(); });
    res.on('error', () => { upstream?.destroy(); upstreamSocket?.destroy(); });
    try {
      const dest = await resolveTarget(req.url, { allowed, resolve: resolveDNS });
      if (req.destroyed) return;
      upstreamSocket = await open(dest);
      if (req.destroyed) { upstreamSocket.destroy(); return; }
      const headers = { ...cleanHeaders(req.headers), host: dest.host, connection: 'close' };
      if (req.headers['content-length'] && Number(req.headers['content-length']) > MAX_BODY) { upstreamSocket.destroy(); return reject(res, 413); }
      const agent = new http.Agent({ keepAlive: false });
      agent.createConnection = () => upstreamSocket;
      upstream = http.request({ hostname: dest.host, port: 80, method: req.method, path: dest.path, headers,
        agent }, incoming => {
        res.writeHead(incoming.statusCode || 502, cleanHeaders(incoming.headers));
        let bytes = 0;
        incoming.on('data', part => { bytes += part.length; if (bytes > MAX_RESPONSE) { incoming.destroy(); res.destroy(); } });
        incoming.on('error', () => res.destroy());
        incoming.pipe(res);
      });
      upstream.on('error', () => reject(res, 502));
      res.once('close', () => { upstream.destroy(); upstreamSocket.destroy(); });
      req.once('aborted', () => upstream.destroy());
      let bytes = 0;
      req.on('data', part => { bytes += part.length; if (bytes > MAX_BODY) { upstream.destroy(); reject(res, 413); } });
      req.pipe(upstream); req.resume();
    } catch (error) { upstream?.destroy(); upstreamSocket?.destroy(); reject(res, error instanceof EgressDenied ? 403 : 502); }
  });
  server.on('connect', async (req, client, head) => {
    client.pause(); let upstream;
    try {
      const dest = await resolveTarget(req.url, { connect: true, allowed, resolve: resolveDNS });
      if (client.destroyed) return;
      upstream = await open(dest);
      if (client.destroyed) { upstream.destroy(); return; }
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.once('error', () => client.destroy()); client.once('error', () => upstream.destroy());
      upstream.once('close', () => client.destroy()); client.once('close', () => upstream.destroy());
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client); client.resume();
    } catch (error) {
      upstream?.destroy();
      client.end(`HTTP/1.1 ${error instanceof EgressDenied ? 403 : 502} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    }
  });
  server.on('connection', socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    // Handle errors even while DNS/connection validation is pending.
    socket.on('error', () => {});
    socket.setTimeout(idleMs, () => socket.destroy());
    const timer = setTimeout(() => socket.destroy(), lifetimeMs);
    socket.once('close', () => clearTimeout(timer));
  });
  server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 403 Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  server.on('clientError', (_error, socket) => socket.destroy());
  server.maxConnections = 64; server.headersTimeout = 10000; server.requestTimeout = 60000;
  return { server, async close() { for (const socket of sockets) socket.destroy(); await new Promise(done => server.close(done)); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const allowed = allowHosts(process.env.BOPS_EGRESS_ALLOW_HOSTS);
    const proxy = createEgressProxy({ allowed });
    proxy.server.listen(3128, '0.0.0.0');
    // Metadata only: no URLs, paths, headers, credentials or payloads in logs.
    proxy.server.on('listening', () => console.log('Private egress ready; exact-host policy active.'));
    proxy.server.on('error', () => { console.error('Private egress could not listen.'); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void proxy.close());
  } catch { console.error('Private egress refused configuration. Set an explicit comma-separated public hostname allowlist.'); process.exitCode = 1; }
}
