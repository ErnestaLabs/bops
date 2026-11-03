import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { allowHosts, publicIPv4, resolveTarget } from '../egress/policy.mjs';
import { createEgressProxy } from '../egress/server.mjs';
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', r));
const request = (port, path, method = 'GET') => new Promise((ok, bad) => {
  const req = http.request({ host: '127.0.0.1', port, path, method }, res => { let body = ''; res.on('data', b => body += b); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body })); });
  req.on('error', bad); req.end();
});
test('public-looking cloud platform addresses cannot be reached through an approved DNS name', async () => {
  assert.equal(publicIPv4('168.63.129.16'), false);
  await assert.rejects(resolveTarget('http://approved.example.com', { allowed: allowHosts('approved.example.com'), resolve: async () => ['168.63.129.16'] }));
});
test('HTTP redirect is returned, not followed; its new hostname needs independent approval', async t => {
  let upstreamCalls = 0;
  const fixture = http.createServer((_req, res) => { upstreamCalls++; res.writeHead(302, { Location: 'http://unapproved.example.com/path' }); res.end(); }); await listen(fixture);
  const proxy = createEgressProxy({ allowed: allowHosts('approved.example.com'), resolveDNS: async () => ['8.8.8.8'], dial: () => net.connect(fixture.address().port, '127.0.0.1') }); await listen(proxy.server);
  t.after(async () => { await proxy.close(); fixture.closeAllConnections(); await new Promise(r => fixture.close(r)); });
  const redirected = await request(proxy.server.address().port, 'http://approved.example.com');
  assert.equal(redirected.status, 302);
  assert.equal((await request(proxy.server.address().port, redirected.headers.location)).status, 403);
  assert.equal(upstreamCalls, 1);
});
test('denied CONNECT and unsafe methods never dial an upstream', async t => {
  let dialed = 0;
  const proxy = createEgressProxy({ allowed: allowHosts('approved.example.com'), dial: () => { dialed++; throw new Error('must not dial'); } }); await listen(proxy.server); t.after(() => proxy.close());
  assert.equal((await request(proxy.server.address().port, 'http://approved.example.com', 'TRACE')).status, 403);
  for (const dest of ['169.254.169.254:443', 'unapproved.example.com:443', 'approved.example.com:22']) {
    const response = await new Promise((ok, bad) => {
      const s = net.connect(proxy.server.address().port, '127.0.0.1'); let text = '';
      s.on('connect', () => s.write(`CONNECT ${dest} HTTP/1.1\r\nHost: ${dest}\r\n\r\n`));
      s.on('data', b => text += b); s.on('end', () => ok(text)); s.on('error', bad);
    });
    assert.match(response, /^HTTP\/1.1 403/);
  }
  assert.equal(dialed, 0);
});
test('DNS and transport diagnostics are never reflected to the worker', async t => {
  const secret = 'private-internal-diagnostic';
  const proxy = createEgressProxy({ allowed: allowHosts('approved.example.com'), resolveDNS: async () => { throw new Error(secret); } }); await listen(proxy.server); t.after(() => proxy.close());
  const response = await request(proxy.server.address().port, 'http://approved.example.com');
  assert.equal(response.status, 502); assert.equal(response.body.includes(secret), false);
});
