import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fixture} from './run-fixture.ts';
import {runLanding,launcherEnvironment} from './run.ts';
import {candidateCommandAsync} from './candidate-environment.ts';
import {WithdrawalRequested,WithdrawalWatch} from './withdrawal-watch.ts';
import {Queue} from './queue.ts';
import {readLedger} from '../gate/memory-ledger.ts';
import {waitFor} from '../gate/test-wait.ts';
import {ownMemory} from '../gate/test-memory.ts';
import {historyFile,writeCostHistory} from '../gate/step-scheduling.ts';
import {STEPS} from '../gate/step-table.mjs';

test('cancelling a GNU time wrapped candidate reaches and joins its actual payload',async t=>{
  const f=fixture(t),options=f.options([]),ready=join(f.controls,'ready'),done=join(f.controls,'done'),release=join(f.controls,'release');
  const abort=new AbortController();
  const source=`import {existsSync,watch,writeFileSync} from 'node:fs';
import {registerCommandCloser} from ${JSON.stringify(new URL('../differential/command-entry/main.ts',import.meta.url).href)};
let finish;const closed=new Promise(resolve=>{finish=resolve;});
const watcher=watch(${JSON.stringify(f.controls)},()=>{if(existsSync(${JSON.stringify(release)})){watcher.close();finish();}});
registerCommandCloser('actual time payload',{cancel:()=>{watcher.close();finish();},close:async()=>{await closed;writeFileSync(${JSON.stringify(done)},'joined');}});
writeFileSync(${JSON.stringify(ready)},'ready');await closed;`;
  const pending=candidateCommandAsync(process.execPath,{tree:f.tree,run:f.run,owned:options.owned!,command:['/usr/bin/time','-f','%e','-o',join(f.controls,'time'),process.execPath,'--input-type=module','-e',source]},launcherEnvironment(options.env),{signal:abort.signal});
  try{
    await waitFor('the actual payload behind GNU time',()=>existsSync(ready));
    abort.abort(new WithdrawalRequested('fixture'));
    const result=await pending;
    assert.equal(result.cancelled,true);assert.equal(readFileSync(done,'utf8'),'joined');
    assert.equal(result.error,undefined,result.stderr??'');
  }finally{writeFileSync(release,'release');abort.abort(new WithdrawalRequested('fixture'));await pending;}
});

test('an already requested withdrawal starts neither a compiler nor an admission',async t=>{
  const f=fixture(t),abort=new AbortController();abort.abort(new WithdrawalRequested('before-start'));
  const ran=await runLanding(f.options(['build','outcomes'],{signal:abort.signal}));
  assert.equal(ran.state,'cancelled');assert.deepEqual(f.calls(),[]);
  assert.equal(existsSync(join(f.run,'build.log')),false);
  assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER),{waiting:[],admitted:[]});
});

test('withdrawal removes a pending build admission without starting the compiler',async t=>{
  const f=fixture(t),abort=new AbortController(),workers=STEPS.find(row=>row.name==='build')!.slots;
  mkdirSync(f.memory.NTS_GATE_COSTS_DIR,{recursive:true});
  assert.equal(writeCostHistory(historyFile(f.memory),{jobs:[{key:'landing-build',basis:'worker',width:workers,peak:Math.floor(8*2**30/workers/1.25)*workers}]}),undefined);
  ownMemory(join(f.own,'memory'),{availableKiB:4*2**20});
  const pending=runLanding(f.options(['build'],{signal:abort.signal}));
  try{
    await waitFor('the build admission request',()=>readLedger(f.memory.NTS_MEMORY_LEDGER).waiting.length===1);
    abort.abort(new WithdrawalRequested('admission'));
    // Even when capacity returns immediately, the accepted cancellation must
    // prevent the compiler. This also lets the old ignoring policy complete.
    ownMemory(join(f.own,'memory'));
    const ran=await pending;assert.equal(ran.state,'cancelled','accepted withdrawal started the compiler instead of cancelling admission');
    assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER),{waiting:[],admitted:[]});
    assert.equal(existsSync(join(f.target,'nts-dev/nts')),false);
  }finally{abort.abort(new WithdrawalRequested('cleanup'));ownMemory(join(f.own,'memory'));await pending;}
});

test('withdrawal of a running build joins the timed payload before releasing its reservation and publishing',async t=>{
  const f=fixture(t),abort=new AbortController(),ready=join(f.controls,'build-ready'),done=join(f.controls,'build-done'),release=join(f.controls,'release');
  const source=`import {existsSync,watch,writeFileSync} from 'node:fs';
import {registerCommandCloser} from ${JSON.stringify(new URL('../differential/command-entry/main.ts',import.meta.url).href)};
let finish;const closed=new Promise(resolve=>{finish=resolve;});
const watcher=watch(${JSON.stringify(f.controls)},()=>{if(existsSync(${JSON.stringify(release)})){watcher.close();finish();}});
registerCommandCloser('build payload',{cancel:()=>{watcher.close();finish();},close:async()=>{await closed;writeFileSync(${JSON.stringify(done)},'closed');}});
writeFileSync(${JSON.stringify(ready)},'ready');await closed;`;
  const pending=runLanding(f.options(['build'],{signal:abort.signal,build:[process.execPath,'--input-type=module','-e',source]}));
  try{
    await waitFor('the timed build payload',()=>existsSync(ready));
    assert.equal(readLedger(f.memory.NTS_MEMORY_LEDGER).admitted.length,1);
    abort.abort(new WithdrawalRequested('running-build'));
    const ran=await pending;assert.equal(ran.state,'cancelled',ran.message);
    assert.equal(readFileSync(done,'utf8'),'closed');
    assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER),{waiting:[],admitted:[]});
    assert.equal(JSON.parse(readFileSync(join(f.run,'landing.json'),'utf8')).state,'cancelled');
  }finally{writeFileSync(release,'release');abort.abort(new WithdrawalRequested('cleanup'));await pending;}
});

test('withdrawal reaches a running gate and requires its scope drain before the terminal',async t=>{
  const f=fixture(t),abort=new AbortController();f.control('outcomes','stuck');
  const pending=runLanding(f.options(['build','outcomes'],{signal:abort.signal}));
  try{
    await waitFor('the running outcomes scope',()=>f.calls().some(line=>line.startsWith('outcomes ')));
    abort.abort(new WithdrawalRequested('running-gate'));
    const ran=await pending;assert.equal(ran.state,'cancelled',ran.message);
    const summary=JSON.parse(readFileSync(join(f.run,'summary.json'),'utf8'));
    assert.equal(summary.scope_cleanup.state,'complete');assert.equal(summary.diagnostics.state,'complete');
    assert.equal(existsSync(join(f.tree,'target/gate-scope-owner.json')),false);
    assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER),{waiting:[],admitted:[]});
  }finally{abort.abort(new WithdrawalRequested('cleanup'));await pending;}
});

test('withdrawal at the memory retry boundary starts no replacement attempt',async t=>{
  const f=fixture(t),abort=new AbortController();f.control('outcomes','pressure');
  const ran=await runLanding(f.options(['build','outcomes'],{signal:abort.signal,hold:()=>abort.abort(new WithdrawalRequested('retry-boundary'))}));
  assert.equal(ran.state,'cancelled',ran.message);
  assert.equal(f.calls().filter(line=>line.startsWith('outcomes ')).length,1);
  assert.equal(existsSync(join(f.run,'attempt-2')),false);
  assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER),{waiting:[],admitted:[]});
});

test('a real runner retains a failed scope certificate and recovers through the repeated durable withdrawal',async t=>{
  const f=fixture(t);
  // This kernel control corrupts GateScopes' own receipt. Live resident
  // observation lets that owner certify its real drain, without the fixed
  // packet's receipt rule rejecting the same corruption during sampling.
  ownMemory(dirname(f.memory.NTS_MEMINFO),{resident:{kind:'live'}});
  const options=f.options(['build','outcomes']);f.control('outcomes','stuck');
  const queue=new Queue(join(f.own,'queue')),entry=queue.submit(options.commit);queue.take();
  const watch=new WithdrawalWatch(queue),cancellation=watch.entry(entry.id),reasons:string[]=[];
  const owner=join(f.tree,'target/gate-scope-owner.json');let original:string|undefined,finished=false;
  const pending=runLanding({...options,signal:cancellation.signal,drainRetry:cancellation.waitForRetry,cancellationHold:reason=>reasons.push(reason)});
  pending.then(()=>{finished=true;},()=>{finished=true;});
  try{
    await waitFor('the real outcomes scope to start',()=>f.calls().some(line=>line.startsWith('outcomes ')));
    original=readFileSync(owner,'utf8');
    const future=JSON.stringify({...JSON.parse(original),version:2})+'\n';writeFileSync(owner,future);
    queue.withdraw(entry.id);
    await waitFor('the retained future-version scope refusal',()=>reasons.some(reason=>reason.includes('future state version 2')),
      {stopped:()=>finished?'runner finished before certifying its scope':undefined});
    assert.equal(finished,false);assert.equal(readFileSync(owner,'utf8'),future);
    assert.equal(existsSync(join(f.run,'landing.json')),false,'a failed certificate must not publish a terminal');
    assert.equal(queue.withdrawRequested(entry.id),true);
    writeFileSync(owner,original);original=undefined;
    assert.equal(queue.withdraw(entry.id),'requested');
    const ran=await pending;assert.equal(ran.state,'cancelled',ran.message);
    assert.equal(existsSync(owner),false,'the existing dead-owner reaper certified and closed the root');
    assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER),{waiting:[],admitted:[]});
    assert.equal(JSON.parse(readFileSync(join(f.run,'landing.json'),'utf8')).state,'cancelled');
  }finally{
    if(original!==undefined&&existsSync(owner))writeFileSync(owner,original);
    queue.withdraw(entry.id);await pending;cancellation.close();watch.close();
  }
});
