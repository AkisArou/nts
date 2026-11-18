import assert from 'node:assert/strict';
import {test} from 'node:test';
import {workerMemoryCause} from './worker-pool.ts';
import {memoryCause,type MemoryCounters} from './worker-memory.ts';
import {PressureError} from '../gate/step-result.ts';

const before:MemoryCounters={oom:0,kills:0,limitBytes:6*2**30,ancestors:[{group:'/step',limit:12*2**30,oom:0}]};
const descendant={...before,oom:1,kills:1};
test('completed rows own descendant budgets; only the worker local OOM names its budget',()=>{
  assert.equal(memoryCause(before,descendant,0,0),'own-limit','the old hierarchical classification reproduced the bug');
  assert.equal(workerMemoryCause(before,descendant,0,0,0,0,true),undefined);
  assert.equal(workerMemoryCause(before,descendant,0,1,0,0,true),'own-limit');
  assert.equal(workerMemoryCause(before,{...before,oom:1},0,1,0,0,false),'own-limit','a local allocation failure need not kill a process');
});
test('a missing row and genuine aggregate or ancestor incidents cannot become a pass',()=>{
  assert.equal(workerMemoryCause(before,descendant,0,0,0,0,false),'system-pressure');
  assert.equal(workerMemoryCause(before,descendant,0,0,0,1,true),'aggregate-pressure');
  assert.throws(()=>workerMemoryCause(before,{...descendant,ancestors:[{group:'/step',limit:12*2**30,oom:1}]},0,0,0,0,true),PressureError);
  assert.equal(workerMemoryCause(before,{...before,kills:1},0,0,0,0,true),'system-pressure','an unexplained kill is pressure');
  assert.throws(()=>workerMemoryCause(descendant,before,0,0,0,0,true),/backwards/);
});
