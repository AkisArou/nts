import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Worker} from 'node:worker_threads';
import {startCpuLoad} from './cpu-load.ts';

test('load readiness proves work and close drains every owned thread',async()=>{
  const load=await startCpuLoad(2);
  try{assert.ok(load.progress().every(blocks=>blocks>0));}
  finally{await load.close();}
  const stopped=load.progress();await load.close();assert.deepEqual(load.progress(),stopped);
});

test('a load startup failure drains workers which already started',async()=>{
  const made:Worker[]=[];
  await assert.rejects(startCpuLoad(2,request=>{
    const worker=request.index===1
      ?new Worker(new URL('./cpu-load-worker.ts',import.meta.url),{workerData:request})
      :new Worker(new URL('./cpu-load-failed-worker-fixture.ts',import.meta.url),{workerData:{...request,stage:'startup'}});
    made.push(worker);return worker;
  }),/deliberate load startup failure/);
  assert.ok(made.every(worker=>worker.threadId===-1));
});

test('a ready worker failure remains a named observation failure through drain',async()=>{
  let worker:Worker|undefined;
  const load=await startCpuLoad(1,request=>{
    worker=new Worker(new URL('./cpu-load-failed-worker-fixture.ts',import.meta.url),{workerData:{...request,stage:'live'}});
    return worker;
  });
  worker!.postMessage('fail');await assert.rejects(load.failed,/deliberate live load failure/);
  await assert.rejects(load.close(),/deliberate live load failure/);
  assert.equal(worker!.threadId,-1);
});
