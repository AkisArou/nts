import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {spawnTest} from '../gate/test-wait.ts';
import {testScratch} from '../gate/test-scratch.ts';

for(const mode of ['virtual','timeout','memory-cap','runaway'] as const){
  test(`finite oracle preparation records ${mode} at the compiler boundary`,t=>{
    const root=testScratch(t,'oracle-compile-bound'),script=join(root,'control.mjs');
    const active=new URL('../gate/active-command.ts',import.meta.url).href;
    const emit=new URL('./oracle-emit.ts',import.meta.url).href;
    const batch=new URL('./oracle-batch.ts',import.meta.url).href;
    const memory=join(root,'meminfo');writeFileSync(memory,'MemAvailable: 64000000 kB\n');
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
      :mode==='memory-cap'
      ?'x=bytearray(512*1024**2); print(len(x))'
      :'while True: pass';
    const source='import subprocess,sys; r=subprocess.run([sys.executable,"-c",'+JSON.stringify(python)+']); sys.exit(r.returncode)';
    const result=await run('python3',['-c',source],root);
    if(result.status!==0)throw Error('fixture compiler failed: '+result.stderr);
    return [{manifest:join(request.directory,'manifest.json')}];
  }
  close(){}
}
mock.module(${JSON.stringify(emit)},{namedExports:{OracleWorker,TypeScriptDiagnosticError:class extends Error{}}});
const {prepareOracles,preparedOracle}=await import(${JSON.stringify(batch)});
const {CaseBudgetError,publishPressure}=await import(${JSON.stringify(new URL('../gate/step-result.ts',import.meta.url).href)});
const budget=mode==='timeout'||mode==='memory-cap';
const requests=[{key:'case',options:{entry:join(root,'input.ts'),directory:join(root,'emit')}}];
if(budget)requests.push({key:'next',options:{entry:join(root,'next.ts'),directory:join(root,'following')}});
const result=await prepareOracles(requests,{
  directory:join(root,'preparation'),toolchain:root,workers:1,env:process.env,memoryBytes:mode==='memory-cap'?128*2**20:2*2**30});
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
`);
    const run=spawnTest(process.execPath,['--experimental-test-module-mocks',script],{
      encoding:'utf8',env:{...process.env,NTS_MEMINFO:memory,NTS_GATE_STEP:'oracle-control',NTS_GATE_STEP_ATTEMPT:'control',NTS_GATE_STEP_RESULT:join(root,'result.json')},cwd:root,
    },`oracle ${mode} compiler control`);
    assert.equal(run.status,0,run.stdout+run.stderr);
    if(mode==='virtual')assert.match(readFileSync(join(root,'preparation/request-0/project-0/stdout'),'utf8'),/reserved 8589934592/);
  });
}
