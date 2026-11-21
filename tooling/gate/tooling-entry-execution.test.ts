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
test('only a host-state fault holds its file; every other failure beside or instead of it stays FAIL',async t=>{
  const imports=`import{test}from'node:test';import assert from'node:assert/strict';import{HostStateError}from${JSON.stringify(new URL('./host-state.ts',import.meta.url).href)};import{ToolingInstrumentError}from${JSON.stringify(new URL('./step-result.ts',import.meta.url).href)};`;
  // #880's realization fault, as worker-memory.ts raises it inside a test.
  const realization=`new HostStateError('tooling-setup','resident cap: nts-fixture-w0.slice cgroup realization failed after start job completed successfully (systemctl exit 0): ControlGroup is empty')`;
  const f=fixture(t),run=(name:string,body:string)=>runScopedTooling([f.write(name,imports+body)],{fixture:true,memoryMax:512*2**20,output:f.output});
  const held=(error:unknown)=>error instanceof ToolingInstrumentError&&error.kind==='tooling-setup'&&/cgroup realization failed/.test(error.message);
  await assert.rejects(run('held',`test('passes',()=>{});test('realization',()=>{throw ${realization};});`),held);
  // oracle-dependencies.test.ts's shape: the fault arrives as the actual of a
  // pattern assertion, never a cause.
  // Cleanup runs in hooks: a slice stop that meets the host fails the hook.
  await assert.rejects(run('hook',`test('cleanup',t=>{t.after(()=>{throw ${realization};});});`),held);
  await assert.rejects(run('pattern',`test('pattern',async()=>{await assert.rejects(Promise.reject(${realization}),/committed install inputs changed/);});`),held);
  const red=async(name:string,body:string,why:string)=>{
    const result=await run(name,body);
    assert.equal(result.status,1,why+'\n'+f.text());assert.ok(result.completedFailures>=1,why+'\n'+f.text());
    return result;
  };
  for(const [name,body,why] of [
    ['protocol',`test('protocol',()=>{throw new ToolingInstrumentError('tooling-setup','invalid tooling request fields');});`,'a protocol or validation result is evidence against the code'],
    ['lookalike',`test('lookalike',()=>{const error=Error('resident cap: lookalike');error.name='HostStateError';error.kind='tooling-setup';throw error;});`,'only the instance is the marker'],
    ['deeper',`test('refusal',()=>{throw new Error('start job failed: invalid unit configuration',{cause:${realization}});});`,'a refusal whose cleanup met the host is still a refusal'],
    ['beside-failure',`test('realization',()=>{throw ${realization};});test('assertion',()=>{throw Error('definite failure');});`,'a definite failure beside the fault'],
    ['beside-hook',`test('body',t=>{t.after(()=>{throw ${realization};});throw Error('definite failure');});`,'a failed body beside its failed cleanup hook'],
    ['beside-timeout',`test('realization',()=>{throw ${realization};});test('timeout',{timeout:100},()=>new Promise(()=>{}));`,'a timeout beside the fault'],
    ['beside-exit',`test('realization',()=>{throw ${realization};});test('exit code',()=>{process.exitCode=7;});`,'a nonzero exit beside the fault'],
  ] as const){
    const result=await red(name,body,why);
    // node keeps the body's own failure as the test's error; its hook's fault is not seen.
    if(name.startsWith('beside')&&name!=='beside-hook')assert.match(result.observationFailure?.reason??'',/cgroup realization failed/,why);
  }
  // A test that catches and asserts a host-state fault is an ordinary pass.
  assert.equal((await run('caught',`test('asserts the fault',()=>{assert.throws(()=>{throw ${realization};},HostStateError);});`)).status,0,f.text());
});
