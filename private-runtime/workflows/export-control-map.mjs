import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWorkflowMap, workflowCatalog } from './http.mjs';
const file=resolve(process.argv[2]||'workforce-map.html');
writeFileSync(file,renderWorkflowMap(),{mode:0o600});
console.log(JSON.stringify({file,workflows:workflowCatalog().workflows.length,liveActions:false}));
