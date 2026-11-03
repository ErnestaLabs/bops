/** Make the exact same board portable, with no CDN, network requests or build tool. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = new URL('../../public/workforce-map/',import.meta.url);
const read = name => readFileSync(new URL(name,root),'utf8');
const strip = s => s.replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const script = ['catalogue.mjs','state.mjs','app.mjs'].map(name => strip(read(name))).join('\n').replaceAll('</script','<\\/script');
const html = read('index.html').replace('<link rel="stylesheet" href="style.css">',`<style>${read('style.css')}</style>`).replace('<script type="module" src="app.mjs"></script>',`<script type="module">${script}</script>`);
const target = resolve(process.argv[2] || 'workforce-control-map.html');
writeFileSync(target,html,{mode:0o644}); console.log(target);
