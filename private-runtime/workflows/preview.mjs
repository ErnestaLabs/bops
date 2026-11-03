/** Loopback-only, read-only visual scaffold. No provider keys or production state loaded. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../../public/workforce-map/',import.meta.url);
const types = { 'index.html':'text/html; charset=utf-8','style.css':'text/css; charset=utf-8','app.mjs':'text/javascript; charset=utf-8','catalogue.mjs':'text/javascript; charset=utf-8','state.mjs':'text/javascript; charset=utf-8','graphs.mjs':'text/javascript; charset=utf-8' };
const port = Number(process.env.WORKFORCE_PREVIEW_PORT || 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');
const server = createServer(async (req,res) => {
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
  const path = req.url?.split('?')[0]; const name = path === '/' ? 'index.html' : path?.slice(1);
  if (!Object.hasOwn(types,name)) { res.writeHead(404,{'Content-Type':'application/json'}); return res.end(JSON.stringify({ error:'Preview only. No live API.' })); }
  try { const data = await readFile(new URL(name,root)); res.writeHead(200,{'Content-Type':types[name],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(req.method === 'HEAD' ? undefined : data); }
  catch { res.writeHead(500); res.end('Preview unavailable'); }
});
server.listen(port,'127.0.0.1',() => console.log(`Workflow scaffold: http://127.0.0.1:${port} (rehearsal only)`));
