import test from 'node:test';
import assert from 'node:assert/strict';
import {ancestorMemoryIncident,memoryAncestors} from './memory-ancestry.ts';
import {memoryCause} from '../census/worker-memory.ts';

test('an ancestor kill names the firing cap rather than assigning a host-pressure verdict',()=>{
  const old={oom:0,kills:0,limitBytes:6*2**30,ancestors:[{group:'/owned/step/workers',limit:2*2**30,oom:1}]};
  const now={...old,kills:1,ancestors:[{...old.ancestors[0]!,oom:2}]};
  assert.throws(()=>memoryCause(old,now,0,0),error=>error instanceof Error&&/ancestor-cap/.test(error.message)&&error.message.includes('/owned/step/workers')&&error.message.includes(String(2*2**30))&&error.message.includes(String(6*2**30)));
  assert.equal(memoryCause({oom:0,kills:0},{oom:0,kills:1},0,0),'system-pressure');
  assert.equal(memoryCause(old,now,0,1),'aggregate-pressure','an observed local aggregate keeps its replay/budget policy');
});
test('local counters choose the nearest firing ancestor and reject a backwards observation',()=>{
  const rows=memoryAncestors('/owned/step/case',group=>({max:group==='/owned/step'?200:1000,oom:0}));
  assert.deepEqual(rows.map(row=>row.group),['/owned/step','/owned']);
  assert.equal(ancestorMemoryIncident(rows,rows),undefined);
  assert.equal(ancestorMemoryIncident(rows,rows.map(row=>({...row,oom:1})))?.group,'/owned/step');
  assert.throws(()=>ancestorMemoryIncident([{group:'/owned',limit:100,oom:1}],[{group:'/owned',limit:100,oom:0}]),/went backwards/);
});
