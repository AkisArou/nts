import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {toolingFileResults} from './tooling-file-admission.ts';
import type {ToolingFileReply} from './tooling-file-worker.ts';
import type {ToolingTimes} from './tooling-runner.ts';
import {readStepInstrument} from './step-result.ts';
import {CaseMemoryLease} from './case-memory.ts';
import {reserve,readLedger,type Reservation} from './memory-ledger.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';
import {waitFor} from './test-wait.ts';
import {caseMemoryKey,unitReservation,type CostHistory} from './step-scheduling.ts';
import {STEPS} from './step-table.mjs';
import {childSlice,newToolingSlice,toolingSlice,toolingSliceArgs,unitComponent} from './tooling-slice.ts';

const GiB=2**30,files=['/repo/a.test.ts','/repo/b.test.ts'];
const times:ToolingTimes={version:1,wallMs:1,concurrency:2,files:[]};
const reply=(path:string,status:0|1|2,completedFailures=0):ToolingFileReply=>({path,bucket:'tooling',result:{status,completedFailures}});

test('tooling file slices retain the common resident worker ancestry',()=>{
  let parent=newToolingSlice();
  for(const component of ['w',unitComponent('r'),unitComponent('c'),'w0','w10']){
    parent=childSlice(parent,component);
    assert.equal(toolingSlice({NTS_TOOLING_SLICE:parent}),parent);
  }
  assert.equal(toolingSliceArgs({NTS_TOOLING_SLICE:parent},'agent')[0],'--slice='+parent);
  assert.ok(newToolingSlice(false,{NTS_TOOLING_SLICE:parent}).startsWith(parent.slice(0,-6)+'-r'));
  assert.throws(()=>toolingSlice({NTS_TOOLING_SLICE:'app.slice'}),/invalid tooling slice/);
});

test('completed assertions survive an unfinished file and retain the hang diagnostic',t=>{
  const root=testScratch(t,'tooling-file-results'),frame=join(root,'instrument.json');
  const env={NTS_GATE_STEP:'tooling',NTS_GATE_STEP_ATTEMPT:'files',NTS_GATE_STEP_RESULT:frame};
  const result=toolingFileResults(files,[reply(files[0]!,1,2),reply(files[1]!,2)],times,env);
  assert.equal(result.status,1);assert.equal(result.completedFailures,2);
  const instrument=readStepInstrument(frame,'tooling','files');
  assert.equal(instrument?.kind,'hung');assert.equal(instrument?.verdict,'FAIL');assert.equal(instrument?.completedFailures,2);
  assert.match(instrument!.reason,/b\.test\.ts/);
});

test('missing and broken file observations cannot manufacture a successful collector',()=>{
  assert.throws(()=>toolingFileResults(files,[reply(files[0]!,0)],times),/missing tooling file result/);
  assert.throws(()=>toolingFileResults(files,[reply(files[0]!,0),{path:files[1]!,bucket:'infrastructure-error',why:'lost observer'}],times),/lost observer/);
  const failed=toolingFileResults(files,[reply(files[0]!,1,1)],times,{},Error('worker retirement failed'));
  assert.equal(failed.status,1);assert.equal(failed.completedFailures,1);
  assert.match(failed.observationFailure!.reason,/missing tooling file result/);
  assert.match(failed.observationFailure!.reason,/worker retirement failed/);
});

test('a file must answer once under its owned identity',()=>{
  assert.throws(()=>toolingFileResults(files,[reply(files[0]!,0),reply(files[0]!,0)],times),/duplicate or unowned/);
  assert.throws(()=>toolingFileResults(files,[reply('/unowned.test.ts',0)],times),/duplicate or unowned/);
  assert.deepEqual(toolingFileResults(files,files.map(file=>reply(file,0)),times),{status:0,completedFailures:0,times});
});

test('per-file tooling admission fits beside two ordinary jobs while the historical whole step waits; full memory still waits',async t=>{
  const root=testScratch(t,'tooling-file-ledger'),memory=ownMemory(root,{totalKiB:31*2**20,availableKiB:20*2**20});
  const cancelled=new AbortController(),holders:Reservation[]=[],used=new Map<string,number>();
  const options={env:memory,used:(entry:{what:string})=>used.get(entry.what)??0,signal:cancelled.signal,report:()=>{}};
  t.after(async()=>{cancelled.abort();for(const holder of holders)holder.release();await Promise.all(holders.map(holder=>holder.closed));});
  for(const what of ['ordinary agent one','ordinary agent two']){
    const holder=await reserve({bytes:4*GiB,priority:'agent',what},options);holders.push(holder);used.set(what,4*GiB);
  }
  const legacy:CostHistory={steps:new Map([['tooling',{memory:{unit:'step',peaks:[16*GiB]}}]]),jobs:new Map()};
  const whole=unitReservation(legacy,{step:'tooling'},'step',GiB);
  assert.equal(whole.bytes,20*GiB);
  const stopWhole=new AbortController();
  const blocked=reserve({bytes:whole.bytes,priority:'agent',what:'whole tooling'}, {...options,signal:stopWhole.signal});
  const withdrawn=assert.rejects(blocked,/abort/i);
  await waitFor('whole-step tooling waits behind the two live jobs',()=>readLedger(memory.NTS_MEMORY_LEDGER).waiting.some(row=>row.what==='whole tooling'));
  stopWhole.abort();await withdrawn;
  assert.equal(STEPS.find(step=>step.name==='tooling')?.elastic,true,'production tooling selects per-case accounting');
  const token=unitReservation(legacy,{step:'tooling'},'token',GiB);
  assert.notEqual(token.bytes,whole.bytes,'a fixed-step sample cannot size the elastic runner');
  const identity={step:'tooling',backend:'node',path:'tooling/heavy.test.ts'},key=caseMemoryKey(identity);
  const lease=new CaseMemoryLease(identity,{history:()=>new Map([[key,[2.5*GiB]]]),completed:()=>{},open:()=>{throw Error('decision must not open a host scope');}});
  assert.equal(lease.bytes,3.125*GiB);
  const file=await reserve({bytes:lease.bytes,priority:'agent',what:'one admitted tooling file'},options);holders.push(file);
  assert.equal(file.active(),true);file.release();await file.closed;
  ownMemory(root,{totalKiB:31*2**20,availableKiB:2*2**20});
  const stopFull=new AbortController();
  const full=reserve({bytes:lease.bytes,priority:'agent',what:'file on full machine'},{...options,signal:stopFull.signal});
  const fullWithdrawn=assert.rejects(full,/abort/i);
  await waitFor('a genuinely full supplied machine refuses even one file',()=>readLedger(memory.NTS_MEMORY_LEDGER).waiting.some(row=>row.what==='file on full machine'));
  stopFull.abort();await fullWithdrawn;
  assert.equal(readLedger(memory.NTS_MEMORY_LEDGER).admitted.length,2,'neither wait held idle tooling memory');
});
