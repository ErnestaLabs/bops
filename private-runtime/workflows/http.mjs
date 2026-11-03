/** Read-only map routes. Call ONLY after the existing private socket auth gate. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateCatalog, expandCatalog } from './contracts.mjs';
export function workflowCatalog() { const data=expandCatalog(JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url),'utf8'))); validateCatalog(data); return data; }
export function renderWorkflowMap() {
  return readFileSync(new URL('./board.html',import.meta.url),'utf8').replace('__CATALOG_JSON__',JSON.stringify(workflowCatalog()).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026'));
}
export function mapCsp(html) {
  const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`).join(' ');
  return `default-src 'none'; script-src ${scripts}; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
}
export function handleWorkflowMap(request,response) {
  const path=request.url?.split('?')[0];
  if(!['/workflow-map','/api/private-workflows/catalog'].includes(path))return false;
  if(!['GET','HEAD'].includes(request.method)){response.writeHead(405,{'Allow':'GET, HEAD','Cache-Control':'no-store'});response.end();return true;}
  const html=path==='/workflow-map',body=html?renderWorkflowMap():JSON.stringify(workflowCatalog());
  response.writeHead(200,{'Content-Type':html?'text/html; charset=utf-8':'application/json; charset=utf-8','Content-Length':String(Buffer.byteLength(body)),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(html?{'Content-Security-Policy':mapCsp(body),'X-Frame-Options':'DENY'}:{})});
  response.end(request.method==='HEAD'?undefined:body);return true;
}
