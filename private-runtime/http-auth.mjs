/** Authentication at the socket boundary, independent of Next's route/proxy build. */
import { timingSafeEqual } from 'node:crypto';
import { loopbackAuthority } from './request-origin.mjs';
const DISABLED = new Set(['/api/cloud/event', '/api/apps/call', '/api/phone/agentphone', '/api/phone/openai', '/api/channels/slack/events']);
export function authorizeRequest(request, env = process.env) {
  const token = env.BOPS_UI_TOKEN;
  if (env.BOPS_PRIVATE_RUNTIME !== '1' || env.BOPS_PRIVATE_AUTH !== 'loopback' || !token || !/^[a-f0-9]{64}$/i.test(token)) return { status: 503, message: 'Private authentication is not configured.' };
  let url, authority;
  try { authority = loopbackAuthority(request.headers.host, request.headers.origin); }
  catch { return { status: 403, message: 'Invalid host or origin.' }; }
  try { url = new URL(request.url, authority); }
  catch { return { status: 400, message: 'Invalid request URL.' }; }
  if (url.host !== authority.host || !request.url.startsWith('/') || request.url.startsWith('//') || request.url.includes('\\')) return { status: 403, message: 'Loopback only.' };
  const method = request.method?.toUpperCase() || 'GET';
  // Only literal public paths: encoded or normalized aliases still require login.
  const rawPath = request.url.split('?')[0];
  if (rawPath === '/api/health' && ['GET', 'HEAD'].includes(method)) return { status: 200, health: true };
  if (rawPath === '/api/private-login' && ['GET', 'POST'].includes(method)) return null;
  const cookies = String(request.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith('bops_window='));
  const got = cookies.length === 1 ? cookies[0].slice('bops_window='.length) : cookies.length ? '' : request.headers['x-bops-window'];
  const a = Buffer.from(typeof got === 'string' ? got : ''), b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { status: rawPath.startsWith('/api/') ? 401 : 303, message: 'Sign in at /api/private-login.', ...(rawPath.startsWith('/api/') ? {} : { location: '/api/private-login' }) };
  if (DISABLED.has(url.pathname)) return { status: 501, message: 'Legacy cloud and webhook routes are disabled.' };
  return null;
}
export function rejectRequest(response, decision) {
  response.statusCode = decision.status;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (decision.location) response.setHeader('Location', decision.location);
  response.end(JSON.stringify(decision.health ? { ok: true, privateRuntime: true } : { error: decision.message }));
}
