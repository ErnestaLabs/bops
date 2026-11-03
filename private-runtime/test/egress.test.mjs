import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { allowHosts, hostname, publicIPv4, resolveTarget, target } from '../egress/policy.mjs';
import { cleanHeaders, createEgressProxy } from '../egress/server.mjs';
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', r));

test('egress requires explicit exact hostnames and rejects vendor endpoints and wildcards', () => {
  assert.deepEqual([...allowHosts('Example.COM, www.example.com')], ['example.com', 'www.example.com']);
  for (const value of ['', '*', '*.example.com', 'example.com,,other.com', 'https://example.com', 'example.com:443', 'evil@example.com', 'localhost', 'localhost.local', 'host.internal', '127.0.0.1', '::1', 'bad_name.com', 'bad..com', '-bad.com', 'éxample.com', 'api.openai.com', 'www.orgo.ai', 'bops.bot', 'api.x.ai']) assert.throws(() => allowHosts(value), { name: 'EgressDenied' }, value);
  assert.equal(hostname('www.example.com.'), 'www.example.com');
});
test('non-global IPv4 and all IPv6 destinations are denied', () => {
  for (const ip of ['0.1.2.3', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.2.1', '100.64.0.1', '100.127.255.255', '192.0.0.8', '192.0.2.1', '192.88.99.1', '198.18.1.1', '198.19.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1', '::ffff:8.8.8.8', '2606:4700::1111', '2130706433', '0x7f000001', '8.8.8.8evil']) assert.equal(publicIPv4(ip), false, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '100.63.255.255', '100.128.0.1', '172.32.0.1']) assert.equal(publicIPv4(ip), true, ip);
});
test('only HTTP port 80 and CONNECT port 443 can be requested', () => {
  assert.deepEqual(target('http://example.com/a?b=c'), { host: 'example.com', port: 80, path: '/a?b=c' });
  assert.equal(target('example.com:443', true).host, 'example.com');
  for (const value of ['http://127.0.0.1', 'http://2130706433', 'http://0x7f000001', 'https://example.com', 'ftp://example.com', 'http://example.com:8080', 'http://secret@example.com', 'http://example.com/#evil', 'http://example.com\\evil', '//example.com', '/health']) assert.throws(() => target(value), value);
  for (const value of ['example.com:80', 'example.com:22', 'example.com:0443', 'example.com:443/evil', '[::1]:443', 'example.com', 'example.com:443@evil.com:443']) assert.throws(() => target(value, true), value);
});
test('DNS is checked on every request and mixed/private answers fail closed', async () => {
  const allowed = allowHosts('example.com'); let calls = 0;
  const resolve = async () => { calls++; return calls === 1 ? ['8.8.8.8'] : ['10.0.0.1']; };
  assert.equal((await resolveTarget('http://example.com', { allowed, resolve })).address, '8.8.8.8');
  await assert.rejects(resolveTarget('http://example.com', { allowed, resolve }));
  await assert.rejects(resolveTarget('http://example.com', { allowed, resolve: async () => ['8.8.8.8', '127.0.0.1'] }));
  await assert.rejects(resolveTarget('http://sub.example.com', { allowed, resolve: () => { throw new Error('Must not resolve unapproved host'); } }), { name: 'EgressDenied' });
  await assert.rejects(resolveTarget('http://example.com', { allowed, resolve: () => new Promise(() => {}), timeoutMs: 5 }));
});
test('proxy and hop-by-hop headers cannot escape to the destination', () => {
  const result = cleanHeaders({ connection: 'X-Secret, keep-alive', 'x-secret': 'never', 'proxy-authorization': 'never', 'x-forwarded-for': 'never', 'content-type': 'text/plain', authorization: 'site-auth' });
  assert.deepEqual(result, { 'content-type': 'text/plain', authorization: 'site-auth' });
});
test('real HTTP proxy pins its checked address, strips proxy credentials and rejects redirect targets', async t => {
  let got; const dialed = [];
  const fixture = http.createServer((req, res) => { got = { url: req.url, headers: req.headers }; res.end('allowed-public-response'); });
  await listen(fixture);
  const proxy = createEgressProxy({ allowed: allowHosts('allowed.example.com'), resolveDNS: async () => ['8.8.8.8'],
    dial: (address, port) => { dialed.push([address, port]); return net.connect(fixture.address().port, '127.0.0.1'); } });
  await listen(proxy.server);
  t.after(async () => { await proxy.close(); fixture.closeAllConnections(); await new Promise(r => fixture.close(r)); });
  const request = (path, headers = {}) => new Promise((ok, bad) => {
    const req = http.get({ host: '127.0.0.1', port: proxy.server.address().port, path, headers }, res => { let body = ''; res.on('data', x => body += x); res.on('end', () => ok({ status: res.statusCode, body })); }); req.on('error', bad);
  });
  const response = await request('http://allowed.example.com/private-path', { Host: 'attacker.example.com', 'Proxy-Authorization': 'secret' });
  assert.equal(response.status, 200); assert.equal(response.body, 'allowed-public-response');
  assert.equal(got.headers.host, 'allowed.example.com'); assert.equal(got.headers['proxy-authorization'], undefined);
  assert.deepEqual(dialed, [['8.8.8.8', 80]]);
  assert.equal((await request('http://attacker.example.com')).status, 403);
  assert.equal((await request('http://169.254.169.254/latest/meta-data')).status, 403);
  assert.equal(dialed.length, 1, 'Denied traffic must never connect upstream');
});
test('CONNECT relays opaque bytes only after approved hostname and public IP checks', async t => {
  const fixture = net.createServer(s => s.pipe(s)); await listen(fixture);
  const proxy = createEgressProxy({ allowed: allowHosts('allowed.example.com'), resolveDNS: async () => ['1.1.1.1'], dial: (address, port) => { assert.equal(address, '1.1.1.1'); assert.equal(port, 443); return net.connect(fixture.address().port, '127.0.0.1'); } });
  await listen(proxy.server); t.after(async () => { await proxy.close(); await new Promise(r => fixture.close(r)); });
  const result = await new Promise((ok, bad) => {
    const s = net.connect(proxy.server.address().port, '127.0.0.1'); let data = '', sent = false;
    s.setTimeout(3000, () => s.destroy(new Error('Tunnel timed out'))); s.on('error', bad);
    s.on('connect', () => s.write('CONNECT allowed.example.com:443 HTTP/1.1\r\nHost: allowed.example.com:443\r\n\r\n'));
    s.on('data', b => { data += b; if (!sent && data.includes('\r\n\r\n')) { assert.match(data, /^HTTP\/1.1 200/); sent = true; s.write('opaque-test-payload'); } if (data.includes('opaque-test-payload')) { s.destroy(); ok(data); } });
  });
  assert.match(result, /opaque-test-payload/);
});

import { proxyConfiguration, proxyTopology, validateNetwork, WORKER_PROXY } from '../egress/client.mjs';
import { dockerComputer } from '../computer.mjs';
function topology() {
  const env = { BOPS_PRIVATE_INSTALL_ID: 'test-install', BOPS_WORKER_NETWORK: 'test-egress', BOPS_WORKER_PROXY: WORKER_PROXY };
  const network = { Internal: true, Driver: 'bridge', EnableIPv6: false, Labels: { 'ernesta.egress': 'true' }, Options: { 'com.docker.network.bridge.gateway_mode_ipv4': 'isolated' }, Containers: { proxy123: {} } };
  const container = { Id: 'proxy123', Config: { Labels: { 'ernesta.egress': 'true' } }, State: { Running: true, Health: { Status: 'healthy' } }, HostConfig: { PortBindings: {} }, NetworkSettings: { Networks: { 'test-egress': { Aliases: ['bops-egress'] } } } };
  return { env, network, container, exec: async args => JSON.stringify(args[0] === 'network' ? [network] : [container]) };
}
test('proxy mode requires the exact bundled endpoint and isolated internal topology', async () => {
  const fixture = topology();
  assert.equal(proxyConfiguration({}), null);
  assert.throws(() => proxyConfiguration({ BOPS_WORKER_PROXY: 'http://user:secret@proxy.example.com' }));
  assert.throws(() => proxyConfiguration({ ...fixture.env, BOPS_WORKER_NETWORK: 'bridge' }));
  assert.equal((await proxyTopology(fixture.env, fixture.exec)).proxyId, 'proxy123');
  for (const override of [{ Internal: false }, { Driver: 'host' }, { Options: {} }, { Labels: {} }, { EnableIPv6: true }]) assert.throws(() => validateNetwork({ ...fixture.network, ...override }));
  fixture.container.State.Health.Status = 'unhealthy';
  await assert.rejects(proxyTopology(fixture.env, fixture.exec));
  fixture.container.State.Health.Status = 'healthy';
  fixture.container.HostConfig.PortBindings = { '3128/tcp': [{ HostPort: '3128' }] };
  await assert.rejects(proxyTopology(fixture.env, fixture.exec));
});
test('proxy-mode workers receive only explicit proxy variables and cannot be created without valid egress', async () => {
  const fixture = topology(); let run;
  const exec = async args => { if (args[0] === 'run') { run = args; return 'container'; } return fixture.exec(args); };
  await dockerComputer({ env: { ...fixture.env, BOPS_INFERENCE_API_KEY: 'not-in-worker', BOPS_UI_TOKEN: 'also-not-in-worker' }, exec }).api.create('Web worker');
  assert.equal(run[run.indexOf('--dns') + 1], '127.0.0.1');
  assert.ok(run.includes(`HTTP_PROXY=${WORKER_PROXY}`)); assert.ok(run.includes(`https_proxy=${WORKER_PROXY}`));
  assert.ok(run.includes(`BOPS_WORKER_PROXY=${WORKER_PROXY}`));
  assert.equal(run.join(' ').includes('not-in-worker'), false);
  run = null; fixture.network.Internal = false;
  await assert.rejects(dockerComputer({ env: fixture.env, exec }).api.create('Must refuse'), { code: 'invalid_egress' });
  assert.equal(run, null);
});
