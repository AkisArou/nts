import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {ownMemoryEnv} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';
import {reserve,readLedger,yieldJobMemory} from './memory-ledger.ts';
import {peakReservation} from './step-scheduling.ts';

test('an idle owned forecast returns to observed use and one ordinary growth restores it',async t=>{
 const use=128*2**20,env=ownMemoryEnv(join(testScratch(t,'job-yield'),'memory'),undefined,{availableKiB:24*2**20,totalKiB:32*2**20,resident:{kind:'fixed',defaultBytes:use}});
 const held=await reserve({bytes:4*2**30,what:'owned yielding job',priority:'agent'},{env,used:()=>use});
 try{
  const before=held.bytes,yielded=await yieldJobMemory(held,env);
  assert.equal(held.bytes,peakReservation([use]));assert.equal(yielded.returned,before-held.bytes);
  assert.equal(readLedger(held.ledger).admitted.find(row=>row.id===held.id)?.bytes,held.bytes);
  const one=yielded.resume();assert.equal(yielded.resume(),one);await one;
  assert.equal(held.bytes,before);assert.equal(held.drained,0,'ordinary readmission is no protected backfill grant');
 }finally{held.release();await held.closed;}
});
test('an inherited yield has no parent mutation and cancellation owns the resume obligation',async t=>{
 const env=ownMemoryEnv(join(testScratch(t,'inherited-job-yield'),'memory')),held=await reserve({bytes:2**30,what:'parent job',priority:'agent'},{env});
 try{
  const child=await reserve({bytes:512*2**20,what:'inherited pool',priority:'agent'},{env:{...env,...held.env}});assert.equal(child.inherited,true);
  const before=held.bytes,stop=new AbortController(),yielded=await yieldJobMemory(child,env,stop.signal);
  assert.equal(yielded.returned,0);assert.equal(held.bytes,before);stop.abort();await assert.rejects(yielded.resume(),{name:'AbortError'});
  assert.equal(held.bytes,before);
 }finally{held.release();await held.closed;}
});
