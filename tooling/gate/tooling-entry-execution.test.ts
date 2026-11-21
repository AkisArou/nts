import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PassThrough} from 'node:stream';
import {runScopedTooling} from './tooling-runner.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {spawnTest} from './test-wait.ts';
import {ToolingInstrumentError} from './step-result.ts';

function fixture(t:import('node:test').TestContext){
  const root=mkdtempSync(join(tmpdir(),'tooling-entry-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const output=new PassThrough();let text='';output.on('data',chunk=>text+=chunk);
  return {root,output,text:()=>text,write:(name:string,body:string)=>{const file=join(root,name+'.test.mjs');writeFileSync(file,body);return file;}};
}
test('each leased file has a distinct process and fresh globals; reuse fails that control',async t=>{
  const f=fixture(t),pids=join(f.root,'pids.jsonl');
  const files=['first','second'].map(name=>f.write(name,`import{test}from'node:test';import assert from'node:assert/strict';import{appendFileSync}from'node:fs';
test('fresh ${name}',()=>{appendFileSync(${JSON.stringify(pids)},JSON.stringify({pid:process.pid})+'\\n');assert.deepEqual(process.argv,[process.execPath,import.meta.filename]);assert.equal(globalThis.__ntsEntryFresh,undefined);globalThis.__ntsEntryFresh=true;});`));
  for(const file of files)assert.equal((await runScopedTooling([file],{fixture:true,memoryMax:512*2**20,output:f.output})).status,0,f.text());
  const rows=readFileSync(pids,'utf8').trim().split('\n').map(line=>JSON.parse(line));assert.equal(new Set(rows.map(row=>row.pid)).size,2);
  const reused=join(f.root,'reused.mjs');
  writeFileSync(reused,`import assert from'node:assert/strict';import{runToolingEntry}from${JSON.stringify(new URL('./tooling-test-runner.ts',import.meta.url).href)};
process.argv=[process.execPath,${JSON.stringify(files[0])}];const first=await runToolingEntry(${JSON.stringify(files[0])},()=>{});process.argv=[process.execPath,${JSON.stringify(files[1])}];const second=await runToolingEntry(${JSON.stringify(files[1])},()=>{});
assert.equal(first.status,0);assert.equal(second.status,1);assert.equal(second.completedFailures,1);`);
  const control=spawnTest(process.execPath,[reused],{env:fixtureEnvironment(t),encoding:'utf8'},'reused process counterfactual');
  assert.notEqual(control.status,0,control.stdout+control.stderr);assert.match(control.stdout+control.stderr,/fresh second/);
  const reusedRows=readFileSync(pids,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(reusedRows.length,4);assert.equal(reusedRows[2].pid,reusedRows[3].pid);
});
test('outside inactivity owner stops a hung file and retains its completed FAIL',async t=>{
  for(const failed of [false,true]){
    const f=fixture(t),file=f.write('hung',`import{test}from'node:test';test('completed',()=>{${failed?"throw Error('completed assertion');":''}});
test('hang outside the reporter',()=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);});`);
    const result=await runScopedTooling([file],{fixture:true,memoryMax:512*2**20,idleMs:250,output:f.output});
    assert.equal(result.status,failed?1:2,f.text());assert.equal(result.completedFailures,failed?1:0,f.text());
    assert.match(f.text(),/NOT RUN \(hung\).*hang outside the reporter/);
  }
});
test('an authenticated entry dying mid-file is FAIL and never a partial PASS',async t=>{
  for(const failed of [false,true]){
    const f=fixture(t),file=f.write('dies',`import{test}from'node:test';test('completed before death',()=>{${failed?"throw Error('prior completed failure');":''}});test('dies mid-file',()=>process.exit(7));`);
    const result=await runScopedTooling([file],{fixture:true,memoryMax:512*2**20,output:f.output});
    assert.equal(result.status,1,f.text());assert.equal(result.completedFailures,1,f.text());
    assert.match(f.text(),/process terminated mid-file.*1 completed assertion\(s\)/);
  }
});
test('a forged child frame cannot authorize a result',async t=>{
  const f=fixture(t),file=f.write('forged',`import{writeSync}from'node:fs';writeSync(3,JSON.stringify({version:1,nonce:'forged',file:import.meta.filename,pid:process.pid,sequence:2,event:'complete',id:1,name:'forged pass',failed:false})+'\\n');`);
  await assert.rejects(runScopedTooling([file],{fixture:true,memoryMax:512*2**20,output:f.output}),/foreign identity or sequence/);
});
test('a nonzero entry exit code cannot be replaced by passing assertions',async t=>{
  const f=fixture(t),file=f.write('exit-code',"import{test}from'node:test';test('passing assertion',()=>{process.exitCode=7;});");
  const result=await runScopedTooling([file],{fixture:true,memoryMax:512*2**20,output:f.output});
  assert.equal(result.status,1,f.text());assert.equal(result.completedFailures,1,f.text());
});
test('a file hitting its finite scope cap fails by name without losing its neighbour',async t=>{
  const f=fixture(t),file=f.write('oom',`import{test}from'node:test';test('own cap',()=>{Buffer.alloc(768*2**20,1);});`);
  const result=await runScopedTooling([file],{fixture:true,memoryMax:512*2**20,output:f.output});
  assert.equal(result.status,1,f.text());assert.match(f.text(),/process terminated mid-file/);
  const neighbour=f.write('neighbour',`import{test}from'node:test';test('unaffected neighbour',()=>{});`);
  assert.equal((await runScopedTooling([neighbour],{fixture:true,memoryMax:512*2**20,output:f.output})).status,0,f.text());
});
test('a test ended by an instrument fault holds its file; a definite failure beside it stays FAIL',async t=>{
  const instrument=JSON.stringify(new URL('./step-result.ts',import.meta.url).href);
  // #880's realization fault, as worker-memory.ts raises it inside a test.
  const realization=`new ToolingInstrumentError('tooling-setup','resident cap: nts-fixture-w0.slice cgroup realization failed after start job completed successfully (systemctl exit 0): ControlGroup is empty')`;
  const f=fixture(t),held=f.write('held',`import{test}from'node:test';import{ToolingInstrumentError}from${instrument};
test('passes',()=>{});test('realization',()=>{throw ${realization};});`);
  await assert.rejects(runScopedTooling([held],{fixture:true,memoryMax:512*2**20,output:f.output}),
    (error:unknown)=>error instanceof ToolingInstrumentError&&error.kind==='tooling-setup'&&/realization: resident cap: .*cgroup realization failed/.test(error.message));
  const beside=f.write('beside',`import{test}from'node:test';import{ToolingInstrumentError}from${instrument};
test('realization',()=>{throw ${realization};});test('assertion',()=>{throw Error('definite failure');});`);
  const red=await runScopedTooling([beside],{fixture:true,memoryMax:512*2**20,output:f.output});
  assert.equal(red.status,1,f.text());assert.equal(red.completedFailures,1,f.text());
  assert.match(red.observationFailure?.reason??'',/cgroup realization failed/);
  // Only the instance is the protocol: a same-named plain error is a failure.
  const named=f.write('named',`import{test}from'node:test';
test('lookalike',()=>{const error=Error('resident cap: lookalike');error.name='ToolingInstrumentError';error.kind='tooling-setup';throw error;});`);
  const lookalike=await runScopedTooling([named],{fixture:true,memoryMax:512*2**20,output:f.output});
  assert.equal(lookalike.status,1,f.text());assert.equal(lookalike.completedFailures,1,f.text());
  // A test that catches and asserts an instrument error is an ordinary pass.
  const caught=f.write('caught',`import{test}from'node:test';import assert from'node:assert/strict';import{ToolingInstrumentError}from${instrument};
test('asserts the fault',()=>{assert.throws(()=>{throw ${realization};},ToolingInstrumentError);});`);
  assert.equal((await runScopedTooling([caught],{fixture:true,memoryMax:512*2**20,output:f.output})).status,0,f.text());
});
