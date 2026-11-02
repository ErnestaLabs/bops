/** Authentication at the socket boundary, independent of Next's route/proxy build. */
import { timingSafeEqual } from 'node:crypto';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const DISABLED = new Set(['/api/cloud/event', '/api/apps/call', '/api/phone/agentphone', '/api/phone/openai', '/api/channels/slack/events']);
export function authorizeRequest(request, env = process.env) {
  const token = env.BOPS_UI_TOKEN;
  if (env.BOPS_PRIVATE_RUNTIME !== '1' || env.BOPS_PRIVATE_AUTH !== 'loopback' || !token || !/^[a-f0-9]{64}$/i.test(token)) return { status: 503, message: 'Private authentication is not configured.' };
  const host = request.headers.host;
  if (typeof host !== 'string' || /[\s/@\\?#]/.test(host)) return { status: 403, message: 'Invalid host.' };
  let url, authority;
  try { authority = new URL(`http://${host}`); url = new URL(request.url, authority); }
  catch { return { status: 400, message: 'Invalid request URL.' }; }
  if (!LOOPBACK.has(authority.hostname) || url.host !== authority.host || !request.url.startsWith('/') || request.url.startsWith('//') || request.url.includes('\\')) return { status: 403, message: 'Loopback only.' };
  const origin = request.headers.origin;
  if (origin && origin !== authority.origin) return { status: 403, message: 'Invalid origin.' };
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
