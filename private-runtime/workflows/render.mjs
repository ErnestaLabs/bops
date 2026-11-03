import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { architecture, workflows, states, recovery, schemaVersion } from './catalog.mjs';
export function renderWorkflowMap(target = fileURLToPath(new URL('../../public/workflows.html', import.meta.url)), check = false) {
  const template = readFileSync(new URL('./map.template.html', import.meta.url), 'utf8');
  const data = JSON.stringify({ architecture, workflows, states, recovery, schemaVersion }).replace(/</g, '\\u003c');
  const result = template.replace('__CATALOG__', data);
  if (check) {
    if (readFileSync(target, 'utf8') !== result) throw new Error('Workflow map is stale. Run node private-runtime/workflows/render.mjs');
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, result);
  }
  return target;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) console.log(renderWorkflowMap(undefined, process.argv.includes('--check')));
