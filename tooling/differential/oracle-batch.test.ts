import {testEnvironment,testEnvironmentHandoff} from "../gate/test-environment.ts";
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {spawnTest,waitFor} from '../gate/test-wait.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {removable} from '../gate/run-temporary.ts';
import {gateEnvironment,hostEnvironment,oracleStepEnvironment,sealOracleRun} from '../gate/canonical-environment.ts';
import {readLedger,reserve} from '../gate/memory-ledger.ts';
import {ownMemory,ownMemoryEnv,withoutHanded} from '../gate/test-memory.ts';
import {oracleWorkspaceFixture} from './oracle-workspace-fixture.ts';

for(const mode of ['virtual','timeout','memory-cap','runaway','pressure'] as const){
  test(`finite oracle preparation records ${mode} at the compiler boundary`,t=>{
    const root=testScratch(t,'oracle-compile-bound'),script=join(root,'control.mjs');
    const active=new URL('../gate/active-command.ts',import.meta.url).href;
    const emit=new URL('./oracle-emit.ts',import.meta.url).href;
    const batch=new URL('./oracle-batch.ts',import.meta.url).href;
    writeFileSync(script,`
import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const root=${JSON.stringify(root)},mode=${JSON.stringify(mode)};
const real=await import(${JSON.stringify(active)});
const calls=[];
mock.module(${JSON.stringify(active)},{namedExports:{...real,activeCommand:async(command,args,options)=>{
  calls.push({command,args,options});
  return real.activeCommand(command,args,{...options,pollMs:50,
    ...(options.eachProcessCpuSeconds&&mode!=='runaway'?{eachProcessCpuSeconds:0.2}:{}),
    ...(mode==='runaway'?{cpuBudgetSeconds:0.2}:{}),
    // Make the old incorrect group limit observable without a 15 second spin.
    ...(options.cpuBudgetSeconds===15?{cpuBudgetSeconds:0.2}:{})});
}}});
class OracleWorker{
  identity={fixture:true};
  async prepareBatch([request],run){
    mkdirSync(request.directory,{recursive:true});
    const python=request.entry.endsWith('next.ts')?'print("following case ran")':mode==='virtual'
      ?'import mmap; reservation=mmap.mmap(-1,8*1024**3); print("reserved",len(reservation))'
      :mode==='memory-cap'||mode==='pressure'
      ?'x=bytearray(512*1024**2); print(len(x))'
      :'while True: pass';
    const source='import subprocess,sys; r=subprocess.run([sys.executable,"-c",'+JSON.stringify(python)+']); sys.exit(r.returncode)';
    const result=await run('python3',['-c',source],root);
    if(result.status!==0)throw Error('fixture compiler failed: '+result.stderr);
    return [{manifest:join(request.directory,'manifest.json')}];
  }
  close(){}
}
mock.module(${JSON.stringify(emit)},{namedExports:{...await import(${JSON.stringify(emit)}),OracleWorker,TypeScriptDiagnosticError:class extends Error{}}});
const {prepareOracles,preparedOracle}=await import(${JSON.stringify(batch)});
const {CaseBudgetError,PressureError,publishPressure}=await import(${JSON.stringify(new URL('../gate/step-result.ts',import.meta.url).href)});
const budget=mode==='timeout'||mode==='memory-cap';
const requests=[{key:'case',options:{entry:join(root,'input.ts'),directory:join(root,'emit')}}];
if(budget)requests.push({key:'next',options:{entry:join(root,'next.ts'),directory:join(root,'following')}});
const prepare=()=>prepareOracles(requests,{
  directory:join(root,'preparation'),toolchain:root,workers:1,env:${testEnvironmentHandoff(["NTS_MEMORY_RESERVATION","NTS_GATE_STEP","NTS_GATE_STEP_ATTEMPT","NTS_GATE_STEP_RESULT","NTS_GATE_STEP_MEMORY_BYTES"])},memoryBytes:mode==='memory-cap'?128*2**20:2*2**30});
if(mode==='pressure'){
  await assert.rejects(prepare(),error=>{
    assert.ok(error instanceof PressureError,String(error));
    assert.match(error.message,/aggregate reservation is smaller/);
    publishPressure(error);return true;
  });
  const verdict=JSON.parse(readFileSync(process.env.NTS_GATE_STEP_RESULT));
  assert.equal(verdict.kind,'memory-pressure');assert.equal(verdict.verdict,'INSTRUMENT');
  assert.equal(existsSync(join(root,'preparation/members.json')),false,'pressure publishes no case row');
  assert.equal(calls.length,1);
}else{
const result=await prepare();
const member=result.case;
if(mode==='virtual')assert.ok(member.prepared,JSON.stringify(member));
else if(mode==='memory-cap')assert.match(member.memoryCap??'',/memory.cap|resident|budget/i);
else if(mode==='timeout')assert.match(member.timeout??'',/CPU bound/);
else assert.match(member.instrument??'',/runaway.*CPU/);
const finished=JSON.parse(readFileSync(join(root,'preparation/request-0/finished.json')));
assert.equal(finished.status,mode==='virtual'?'complete':mode==='runaway'?'instrument':mode);
assert.equal(calls.length,budget?2:1);
if(budget){
  assert.ok(result.next.prepared,'a bounded failure does not stop the following case');
  assert.equal(existsSync(process.env.NTS_GATE_STEP_RESULT),false,'budget exhaustion publishes no instrument hold');
  assert.throws(()=>preparedOracle(member,'consumer'),error=>{
    assert.ok(error instanceof CaseBudgetError);publishPressure(error);return true;
  });
  const verdict=JSON.parse(readFileSync(process.env.NTS_GATE_STEP_RESULT));
  assert.equal(verdict.kind,'case-budget');assert.equal(verdict.verdict,'FAIL');
}

assert.equal(calls[0].options.eachProcessCpuSeconds,real.COMPILE_CPU_BOUND_SECONDS);
assert.equal(calls[0].options.cpuBudgetSeconds,undefined,'the generic runaway budget stays at its default');
assert.ok(!calls[0].args.some(arg=>String(arg).startsWith('--as=')),'virtual space is not resident memory');
}
`);
    const run=spawnTest(process.execPath,['--experimental-test-module-mocks',script],{
      encoding:'utf8',env:ownMemoryEnv(join(root,'memory'),{...testEnvironment(),...(mode==='pressure'?{NTS_GATE_STEP_MEMORY_BYTES:String(128*2**20)}:{}),NTS_GATE_TOKEN_HELD:undefined,NTS_GATE_STEP:'oracle-control',NTS_GATE_STEP_ATTEMPT:'control',NTS_GATE_STEP_RESULT:join(root,'result.json')}),cwd:root,
    },`oracle ${mode} compiler control`);
    assert.equal(run.status,0,run.stdout+run.stderr);
    if(mode==='virtual')assert.match(readFileSync(join(root,'preparation/request-0/project-0/stdout'),'utf8'),/reserved 8589934592/);
  });
}

test('preparation inside a reservation asks for nothing whatever the host reads; alone, it waits its turn in the ledger and starts no compiler first',async t=>{
  const root=testScratch(t,'oracle-step-admission'),tree=join(root,'tree'),run=join(root,'run'),home=join(root,'home');
  try{
    mkdirSync(tree);mkdirSync(home);
    copyModuleClosure(['tooling/gate/canonical-environment.ts'],tree);
    oracleWorkspaceFixture(t,tree);
    // The job's own ledger and reading: room for the step's reservation, and
    // then none of the machine's memory available at all.
    const memoryDirectory=join(root,'memory'),ample={availableKiB:64_000_000,totalKiB:64_000_000},memory=ownMemory(memoryDirectory,ample);
    const planned=await sealOracleRun(gateEnvironment({...hostEnvironment(process.env),HOME:home},{run,oracleRoot:tree,oracleAdmissionContext:'gate',owned:{...memory}}));
    const step=withoutHanded(oracleStepEnvironment(planned.env,'tests'));
    // A gate step's reservation, which counts this test's children.
    const held=await reserve({bytes:8*2**30,what:'tests step'},{env:{...step}});
    t.after(()=>held.release());
    ownMemory(memoryDirectory,{...ample,availableKiB:0});
    const script=join(root,'preparation.mjs'),emit=new URL('./oracle-emit.ts',import.meta.url).href;
    writeFileSync(script,`
import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const root=${JSON.stringify(root)},mode=process.argv[2];let commands=0;
const real=await import(${JSON.stringify(emit)});
class OracleWorker{
  identity={fixture:true};
  async prepareBatch([request],run){
    commands++;mkdirSync(request.directory,{recursive:true});
    const result=await run(process.execPath,['-e','console.log("admitted compiler")'],root);
    assert.equal(result.status,0,result.stderr);
    return [{manifest:join(request.directory,'manifest.json')}];
  }
  close(){}
}
mock.module(${JSON.stringify(emit)},{namedExports:{...real,OracleWorker}});
const {prepareOracles,ORACLE_COMPILE_MEMORY_BYTES}=await import(${JSON.stringify(new URL('./oracle-batch.ts',import.meta.url).href)});
const {closeMemoryRun}=await import(${JSON.stringify(new URL('../census/worker-memory.ts',import.meta.url).href)});
try{
  const members=await prepareOracles(['one','two'].map(key=>({key,options:{entry:join(root,key+'.ts'),directory:join(root,mode,key)}})),{
    directory:join(root,mode,'preparation'),toolchain:root,workers:1,env:${testEnvironmentHandoff(["NTS_MEMORY_RESERVATION","NTS_GATE_STEP","NTS_GATE_STEP_ATTEMPT","NTS_GATE_STEP_RESULT","NTS_GATE_STEP_MEMORY_BYTES"])}});
  assert.ok(members.one.prepared);assert.ok(members.two.prepared);assert.equal(commands,2);
  for(const ordinal of [0,1]){
    const path=join(root,mode,'preparation','request-'+ordinal,'project-0');
    const command=JSON.parse(readFileSync(join(path,'command.json'),'utf8'));
    assert.equal(command.residentLimitBytes,ORACLE_COMPILE_MEMORY_BYTES);
    assert.ok(command.args.some(arg=>arg.startsWith('--slice=')),'preparation keeps its owned resident scope');
    assert.match(readFileSync(join(path,'stdout'),'utf8'),/admitted compiler/);
  }
}finally{closeMemoryRun();}
`);
    const env:NodeJS.ProcessEnv={...step,NTS_GATE_STEP:'tests',NTS_GATE_STEP_MEMORY_BYTES:String(8*2**30)};
    // Inside the step's reservation: nothing is asked, though nothing is available.
    const inside=spawnTest(process.execPath,['--experimental-test-module-mocks',script,'inside'],{cwd:tree,env:{...env,...held.env},encoding:'utf8'},'oracle preparation inside a reservation');
    assert.equal(inside.status,0,inside.stdout+inside.stderr);
    assert.doesNotMatch(inside.stderr,/memory: /);
    assert.deepEqual(readLedger(memory.NTS_MEMORY_LEDGER).admitted.map(entry=>entry.id),[held.id],'the preparation ran in the step\'s reservation and made none');
    // Alone: it reserves by its key's history, never more than its workers'
    // allowance, waiting for room before any compiler starts.
    const alone=spawn(process.execPath,['--experimental-test-module-mocks',script,'alone'],{cwd:tree,env,stdio:['ignore','pipe','pipe']});
    let output='';alone.stdout.on('data',bytes=>{output+=bytes;});alone.stderr.on('data',bytes=>{output+=bytes;});
    const closed=new Promise<number|null>((resolve,reject)=>{alone.once('error',reject);alone.once('close',resolve);});
    try{
      await waitFor('the preparation to wait in the ledger',()=>readLedger(memory.NTS_MEMORY_LEDGER).waiting.some(entry=>entry.what==='oracle preparation of 2 program(s)'));
      const waiting=readLedger(memory.NTS_MEMORY_LEDGER).waiting.find(entry=>entry.what==='oracle preparation of 2 program(s)')!;
      assert.ok(waiting.bytes<=3*2**30,`never more than one worker's ${3*2**30} byte allowance: ${waiting.bytes}`);
      assert.deepEqual(waiting.unmeasured,['oracle-preparation'],'never measured in this history, it says so');
      assert.equal(existsSync(join(root,'alone','preparation','request-0')),false,'no compiler starts before the reservation');
      ownMemory(memoryDirectory,ample);
      assert.equal(await closed,0,output);
    }finally{if(alone.exitCode===null)alone.kill();}
    assert.match(output,/memory: oracle preparation of 2 program\(s\) waits for \d+\.\d [MG]iB \(agent\)/);
    assert.deepEqual(readLedger(memory.NTS_MEMORY_LEDGER).admitted.map(entry=>entry.id),[held.id],'its own reservation ended with it');
  }finally{removable(root);}
});
