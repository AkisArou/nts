import assert from 'node:assert/strict';
import test from 'node:test';
import {COUNT_INSTRUMENT,COUNT_TARGET_INSTRUCTIONS,instructionCount,netCount} from './count-driver.ts';

test('the active pinned PMU must measure the whole instruction bracket',()=>{
  assert.equal(instructionCount('<not counted>,,cpu_atom/instructions/u,0,0.00,,\n319719383,,cpu_core/instructions/u,20645101,100.00,,\n'),319719383);
  assert.equal(instructionCount('80,,instructions:u,10,100.00,,\n'),80);
  for(const input of ['5,,cpu_core/instructions/u,10,50.00,,\n','no counters here\n'])assert.throws(()=>instructionCount(input),/count driver:/);
});

test('count sizing uses instructions and subtracts the matching empty bracket',async()=>{
  const calls:{n:number;warmup:number;arm:string}[]=[];
  const result=await netCount(async(n,warmup,arm)=>{
    calls.push({n,warmup,arm});
    // Setup costs can differ after warmup; the matching empty bracket owns it.
    return {instructions:(warmup?2300:2000)+n*6_000_000,value:{n,warmup,checksum:'same',nsPerOp:n?1:0}};
  });
  const reps=Math.ceil(COUNT_TARGET_INSTRUCTIONS/6_000_000);
  assert.deepEqual(calls,[{n:0,warmup:0,arm:'probe-empty'},{n:1,warmup:0,arm:'probe'},
    {n:0,warmup:reps,arm:'empty'},{n:reps,warmup:reps,arm:'work'}]);
  assert.equal(result.instructions,reps*6_000_000);assert.equal(result.instrument,COUNT_INSTRUMENT);
});

test('a changed checksum or work request and nonpositive net counts refuse',async()=>{
  for(const mode of ['checksum','work','net'])await assert.rejects(netCount(async(n,warmup,arm)=>({
    instructions:mode==='net'?2000:2000+n*6_000_000,
    value:{n:mode==='work'?n+1:n,warmup,checksum:mode==='checksum'&&arm==='work'?'changed':'same',nsPerOp:1},
  })),/count driver:/);
});
