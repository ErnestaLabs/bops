import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { authorizeRequest, rejectRequest } from '../http-auth.mjs';
const token = 'b'.repeat(64), env = { BOPS_PRIVATE_RUNTIME: '1', BOPS_PRIVATE_AUTH: 'loopback', BOPS_UI_TOKEN: token };
const request = (url = '/api/state', headers = {}, method = 'GET') => ({ url, method, headers: { host: '127.0.0.1:3210', ...headers } });
test('all private API paths reject missing or bad authentication', () => {
  for (const url of ['/api/state', '/api/account', '/api/files/a', '/api/sessions', '/api/chats/x/messages']) for (const method of ['GET','HEAD','POST','DELETE','OPTIONS']) assert.equal(authorizeRequest(request(url, {}, method), env).status,401);
  assert.equal(authorizeRequest(request('/api/state', { cookie: 'bops_window=wrong' }), env).status,401);
});
test('private HTTP boundary permits only explicit login and health exceptions', () => {
  assert.equal(authorizeRequest(request('/api/health'), env).health,true);
  assert.equal(authorizeRequest(request('/api/private-login'), env),null);
  assert.equal(authorizeRequest(request('/api/health', {}, 'POST'),env).status,401);
  for (const url of ['/api/health/', '/api/%68ealth','/api/a/../health']) assert.equal(authorizeRequest(request(url), env).status,401);
});
test('authentication is constant-time, cookie or desktop header, and duplicate cookies fail closed', () => {
  assert.equal(authorizeRequest(request('/api/state', { cookie: `bops_window=${token}` }),env), null);
  assert.equal(authorizeRequest(request('/api/state', { 'x-bops-window':token }),env), null);
  assert.equal(authorizeRequest(request('/api/state', { cookie: `bops_window=${token}; bops_window=wrong` }),env).status,401);
  assert.equal(authorizeRequest(request('/api/state', { cookie: 'bops_window='+'界'.repeat(64) }),env).status,401);
});
test('foreign origins and DNS-rebinding hostnames are rejected even with token', () => {
  for (const headers of [{host:'attacker.example'}, {origin:'https://attacker.example'}, {host:'localhost@attacker.example'}, {origin:'null'}]) assert.equal(authorizeRequest(request('/api/state', {...headers,'x-bops-window':token}),env).status,403);
  assert.equal(authorizeRequest(request('http://attacker.example/api/health'),env).status,403);
});
test('configuration is fail-closed and legacy webhook routes are disabled', () => {
  assert.equal(authorizeRequest(request(),{}).status,503);
  assert.equal(authorizeRequest(request('/api/cloud/event',{'x-bops-window':token}),env).status,501);
});
test('real HTTP listener does not invoke application before authentication', async t => {
  let calls=0;
  const server=createServer((req,res)=>{ const d=authorizeRequest(req,env); if(d)return rejectRequest(res,d); calls++;res.end('protected'); });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/state')).status,401); assert.equal(calls,0);
  assert.equal((await fetch(base+'/api/state',{headers:{Cookie:`bops_window=${token}`}})).status,200); assert.equal(calls,1);
});
