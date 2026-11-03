/** One customer-owned HTTP server. Every request is authenticated before Next runs.
 * No second unprotected listener. Use an SSH tunnel for remote owner access.
 */
import { createServer } from 'node:http';
import next from 'next';
import { authorizeRequest, rejectRequest } from './http-auth.mjs';
const port = Number(process.env.PORT) || 3210;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid PORT.');
const dev = process.argv.includes('--dev');
const app = next({ dev, dir: process.cwd(), hostname: '127.0.0.1', port });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer(async (request, response) => {
  const decision = authorizeRequest(request);
  if (decision) return rejectRequest(response, decision);
  try { await handle(request, response); }
  catch (error) {
    console.error('Private request failed:', error instanceof Error ? error.message : 'unknown error');
    if (!response.headersSent) rejectRequest(response, { status: 500, message: 'Application request failed.' });
    else response.destroy();
  }
});
server.on('upgrade', (request, socket) => {
  const decision = authorizeRequest(request) || { status: 501 };
  socket.end(`HTTP/1.1 ${decision.status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
});
server.headersTimeout = 15000;
server.requestTimeout = 120000;
await new Promise((ok, bad) => { server.once('error', bad); server.listen(port, '127.0.0.1', ok); });
console.log(`Authenticated private server ready at http://127.0.0.1:${port}`);
let closing = false;
async function close() {
  if (closing) return; closing = true;
  server.closeAllConnections(); server.close();
  try { await app.close(); } finally { process.exit(0); }
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
