import test from 'node:test';
import assert from 'node:assert/strict';
import { loopbackAuthority } from '../request-origin.mjs';
import { authorizeRequest } from '../http-auth.mjs';

test('loopback origin uses the browser authority, including its tunnel port', () => {
  for (const host of ['127.0.0.1:41765', 'localhost:9000', '[::1]:3210', 'localhost']) {
    assert.equal(loopbackAuthority(host, `http://${host}`).origin, `http://${host}`);
  }
  const request = new Request('http://localhost:3000/api/private-login', {
    method: 'POST', headers: { Host: '127.0.0.1:41765', Origin: 'http://127.0.0.1:41765', 'X-Forwarded-Host': 'attacker.example', 'X-Forwarded-Proto': 'https' },
  });
  assert.equal(loopbackAuthority(request.headers.get('host'), request.headers.get('origin')).origin, 'http://127.0.0.1:41765');
});
test('missing, malformed and non-loopback authorities fail closed', () => {
  for (const host of [null, undefined, '', 'attacker.example', 'localhost.attacker.example', 'localhost@attacker.example', 'localhost/path', 'localhost\\path', 'localhost:0', 'localhost:65536', 'localhost:3210,attacker.example', 'localhost:abc', '127.1', '2130706433', 'localhost#x', 'localhost?x', ' localhost']) {
    assert.throws(() => loopbackAuthority(host, null));
  }
});
test('origin scheme, host and port must all match; null origin is not trusted', () => {
  for (const origin of ['https://localhost:3210', 'http://localhost:3211', 'http://127.0.0.1:3210', 'http://attacker.example', 'null', '']) {
    assert.throws(() => loopbackAuthority('localhost:3210', origin));
  }
  assert.equal(loopbackAuthority('localhost:3210', null).origin, 'http://localhost:3210');
});
test('login exception never bypasses origin validation at the socket boundary', () => {
  const env = { BOPS_PRIVATE_RUNTIME: '1', BOPS_PRIVATE_AUTH: 'loopback', BOPS_UI_TOKEN: 'b'.repeat(64) };
  const req = { method: 'POST', url: '/api/private-login', headers: { host: 'localhost:9000', origin: 'http://localhost:9000' } };
  assert.equal(authorizeRequest(req, env), null);
  assert.equal(authorizeRequest({ ...req, headers: { ...req.headers, origin: 'http://attacker.example' } }, env).status, 403);
});
