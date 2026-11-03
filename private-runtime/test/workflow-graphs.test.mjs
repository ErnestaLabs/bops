import test from 'node:test';
import assert from 'node:assert/strict';
import {FLOWS} from '../../public/workforce-map/catalogue.mjs';
import {workflowGraph,systemGraph,validateGraph} from '../../public/workforce-map/graphs.mjs';
for(const flow of FLOWS) test(`connected authored graph: ${flow.id}`,()=>{
 const g=workflowGraph(flow.id);assert.equal(validateGraph(g),true);
 assert.equal(g.flow,flow);assert.ok(g.nodes.length>=9);assert.ok(g.edges.some(e=>e.kind==='exception'));assert.ok(g.nodes.some(n=>n.kind==='decision'));
 assert.match(g.mode,/not live/);assert.equal(new Set(g.edges.map(e=>e.id)).size,g.edges.length);
 for(const n of g.nodes){assert.ok(n.title&&n.owner&&n.origin);assert.ok(Number.isFinite(n.x)&&Number.isFinite(n.y));}
});
test('recipes have distinct concrete steps, not the same generic eight cards',()=>{
 const signatures=FLOWS.map(f=>workflowGraph(f.id).nodes.slice(0,7).map(n=>n.title).join('|'));
 assert.equal(new Set(signatures).size,FLOWS.length);
});
test('uncertain send cannot lead directly to another send',()=>{
 const g=workflowGraph('send-approved');
 assert.ok(g.edges.some(e=>e.from==='n4'&&e.to==='unknown'));
 assert.ok(g.edges.some(e=>e.from==='unknown'&&e.to==='lookup'));
 assert.ok(!g.edges.some(e=>e.from==='unknown'&&e.to==='n4'));
 assert.ok(g.edges.some(e=>e.from==='lookup'&&e.to==='reapprove'));
 assert.ok(g.edges.some(e=>e.from==='reapprove'&&e.to==='n2'));
 assert.ok(g.edges.some(e=>e.from==='lookup'&&e.to==='n5'));
});
test('architecture has valid clickable links to known workflows',()=>{
 const g=systemGraph();assert.equal(validateGraph(g),true);
 for(const n of g.nodes)if(n.open)assert.ok(FLOWS.some(f=>f.id===n.open));
});
test('unknown workflows and dangling or broken graphs are rejected',()=>{
 assert.throws(()=>workflowGraph('not-mapped'));
 const g=workflowGraph('chat');g.edges.push({id:'bad',from:'n0',to:'nonexistent'});assert.throws(()=>validateGraph(g));
});
