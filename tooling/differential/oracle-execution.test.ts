import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {after,test} from 'node:test';
import {closeMemoryRun} from '../census/worker-memory.ts';
import {COMMAND_IDLE_GUARD_MS,COMPILE_CPU_BOUND_SECONDS,CommandNotMeasuredError} from '../gate/active-command.ts';
import {ToolingInstrumentError} from '../gate/step-result.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {ORACLE_PLANNER_LIMITS,oracleExecutionLimits,runOracleCommand,runOraclePlanner} from './oracle-execution.ts';

after(closeMemoryRun);
test('the recorder and native launcher share the stated population policy',()=>{
  assert.deepEqual(oracleExecutionLimits('benchmarks/cases/subject/case.ts'),{cpuSeconds:60,residentBytes:2*2**30});
  assert.deepEqual(oracleExecutionLimits('tests/programs/subject/main.ts'),{cpuSeconds:15,residentBytes:2*2**30});
});
test('virtual reservation alone does not exhaust the oracle resident scope',async()=>{
  const source=`const m=new WebAssembly.Memory({initial:1,maximum:65536}); const fs=await import('node:fs'); console.log(fs.readFileSync('/proc/self/status','utf8').match(/^VmSize:\\s+(\\d+)/m)[1]); console.log(m.buffer.byteLength);`;
  const result=await runOracleCommand(process.execPath,['--input-type=module','-e',source],{source:'benchmarks/cases/private/case.ts',env:process.env});
  assert.equal(result.run.status,0,result.run.stderr);assert.equal(result.budget,undefined);
  assert.ok(Number(result.run.stdout.split('\n')[0])*1024>2*2**30,'more than 2 GiB is reserved virtually');
  assert.ok(result.residentPeakBytes<2*2**30);
});
test('only an observed CPU or own resident bound is a case budget',async()=>{
  const timed=await runOracleCommand(process.execPath,['-e','for(;;){}'],{source:'private',env:process.env,limits:{cpuSeconds:0.1,residentBytes:2*2**30}});
  assert.equal(timed.budget?.outcome,'timeout');assert.equal(timed.budget?.bound,0.1);
  const capped=await runOracleCommand(process.execPath,['-e','const held=[];for(;;)held.push(Buffer.alloc(16*1024*1024,1));'],{source:'private',env:process.env,limits:{cpuSeconds:15,residentBytes:128*2**20}});
  assert.equal(capped.budget?.outcome,'memory-cap');assert.equal(capped.budget?.bound,128*2**20);
  const stopped=await runOracleCommand(process.execPath,['-e',"process.kill(process.pid,'SIGABRT')"],{source:'private',env:process.env});
  assert.equal(stopped.budget,undefined,'an unproven signal is never a resident hit');
});

test('the shared execution transports stdout and stderr byte for byte',async()=>{
  const value=await runOracleCommand(process.execPath,['-e','process.stdout.write(Buffer.from([0,255,128]));process.stderr.write(Buffer.from([254,0]));'],{source:'tests/programs/private/main.ts',env:process.env});
  assert.equal(value.run.status,0);assert.equal(value.stdoutHex,'00ff80');assert.equal(value.stderrHex,'fe00');
});

// A planner fixture receives the planner's arguments. Its step frame is the
// test's own, so a hold it publishes is read here and reaches no gate step.
function planner(t:{after(fn:()=>void):void},interpreter:string,body:string){
  const root=testScratch(t,'oracle-planner'),file=join(root,'oracle-plan'),result=join(root,'result.json');
  writeFileSync(file,`#!${interpreter}\n${body}\n`,{mode:0o755});
  return {file,env:{...process.env,NTS_GATE_STEP_RESULT:result,NTS_GATE_STEP:'oracle-planner-control',NTS_GATE_STEP_ATTEMPT:'control'},
    published:()=>existsSync(result)?(JSON.parse(readFileSync(result,'utf8')) as {kind:string}).kind:null};
}
test('the planner is held as a case compile is: its CPU bound, and the shared activity guard',()=>{
  assert.deepEqual(ORACLE_PLANNER_LIMITS,{cpuSeconds:COMPILE_CPU_BOUND_SECONDS,idleMs:COMMAND_IDLE_GUARD_MS});
});
test('a planner past its CPU bound planned no population: a plan budget, which is no hold',async t=>{
  const f=planner(t,process.execPath,'for(;;){}');
  const planned=await runOraclePlanner(f.file,['project.json'],{env:f.env,limits:{cpuSeconds:0.3,idleMs:2000}});
  assert.ok('budget' in planned,JSON.stringify(planned));
  const {reason,...budget}=planned.budget;
  assert.deepEqual(budget,{phase:'plan',outcome:'timeout',bound:0.3,signal:'SIGKILL'});
  assert.match(reason,/^oracle planner timed out: .* used its 0\.3 s CPU bound: process \d+ own CPU reached/);
  assert.equal(f.published(),null,'a budget is the case outcome, never the step hold');
});
test('an active planner that prints nothing until it is done is not stopped by the activity bound',async t=>{
  // Three CPU seconds with no output: three times the inactivity guard.
  const f=planner(t,process.execPath,'while(process.cpuUsage().user<3e6){}\nprocess.stdout.write(JSON.stringify({planned:process.argv[2]})+"\\n");');
  const planned=await runOraclePlanner(f.file,['project.json'],{env:f.env,limits:{cpuSeconds:60,idleMs:1000}});
  assert.deepEqual(planned,{plan:'{"planned":"project.json"}\n'});
  assert.equal(f.published(),null);
});
test('a planner with no output, CPU or busy thread measured nothing: hung, held, never a budget',async t=>{
  const f=planner(t,'/bin/sh','exec tail -f /dev/null');
  await assert.rejects(runOraclePlanner(f.file,['project.json'],{env:f.env,limits:{cpuSeconds:60,idleMs:1000}}),
    error=>error instanceof CommandNotMeasuredError&&error.kind==='hung');
  assert.equal(f.published(),'hung');
});
test('a planner that fails is held with its diagnostic, never a budget',async t=>{
  const f=planner(t,'/bin/sh','echo "the program does not typecheck" >&2; exit 3');
  await assert.rejects(runOraclePlanner(f.file,['project.json'],{env:f.env,limits:{cpuSeconds:60,idleMs:60_000}}),
    error=>error instanceof ToolingInstrumentError&&/^oracle planner held: exit 3\n.*does not typecheck/s.test(error.message));
});
