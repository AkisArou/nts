import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './run-fixture.ts';
import {runLanding,launcherEnvironment} from './run.ts';
import {candidateCommandAsync} from './candidate-environment.ts';
import {WithdrawalRequested} from './withdrawal-watch.ts';
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
