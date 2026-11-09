import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {after,test} from 'node:test';
import {closeMemoryRun} from '../census/worker-memory.ts';
import {COMMAND_IDLE_GUARD_MS,COMPILE_CPU_BOUND_SECONDS,CommandNotMeasuredError} from '../gate/active-command.ts';
import {ToolingInstrumentError} from '../gate/step-result.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {ORACLE_PLANNER_LIMITS,oracleExecutionLimits,oracleNode,runOracleCommand,runOraclePlanner,v8HeapStop} from './oracle-execution.ts';

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

test("V8's own line names a stop at the heap limit, and a size limit is no heap limit",()=>{
  const reached='FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory';
  const ineffective='FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory';
  assert.equal(v8HeapStop(`\n<--- Last few GCs --->\n\n[1:0x1]  6025 ms: Scavenge 1017.6 (1020.7) -> 1017.6 (1023.0) MB\n${ineffective}\n----- Native stack trace -----\n`),ineffective);
  assert.equal(v8HeapStop(reached+'\n'),reached);
  assert.equal(v8HeapStop('FATAL ERROR: invalid table size Allocation failed - JavaScript heap out of memory\n'),null);
  assert.equal(v8HeapStop('console.error said: '+reached+'\n'),null,'a line that only quotes V8 is no stop');
  assert.equal(v8HeapStop(''),null);
});
test('the node an oracle command runs is found past the wrappers that start it',()=>{
  assert.equal(oracleNode('taskset',['-c','4','/opt/node/bin/node','--import','data:x','driver.mjs']),'/opt/node/bin/node');
  assert.equal(oracleNode('taskset',['0x10','node','driver.mjs']),'node');
  assert.equal(oracleNode('prlimit',['--core=0','--cpu=2:3','node','--input-type=module','-e','x']),'node');
  assert.equal(oracleNode(process.execPath,['driver.mjs']),process.execPath);
  assert.equal(oracleNode('sh',['-c','node driver.mjs']),null);
  assert.equal(oracleNode('taskset',['-c','4','./program']),null);
});

// node sizes its JavaScript heap from the resident scope it starts in unless a
// flag sets it, so a shell's own NODE_OPTIONS must not decide which bound a run meets.
const SIZED=(()=>{const env={...process.env};delete env.NODE_OPTIONS;return env;})();
const HEAP_LIMIT="process.stdout.write(String(require('node:v8').getHeapStatistics().heap_size_limit))";
const FILL_HEAP='const held=[];for(;;)held.push({a:1,b:[1,2,3,4,5,6,7,8]});';
test('a run V8 stops at its heap limit is held to that limit, never to the resident scope it did not fill',async()=>{
  const limits={cpuSeconds:15,residentBytes:512*2**20};
  const probe=await runOracleCommand(process.execPath,['-e',HEAP_LIMIT],{source:'private',env:SIZED,limits});
  const heap=Number(probe.run.stdout);
  assert.ok(Number.isSafeInteger(heap)&&heap>0&&heap<limits.residentBytes,'node set its heap limit below the scope: '+probe.run.stdout);
  // Started as the native differential starts it, past a wrapper.
  const stopped=await runOracleCommand('prlimit',['--core=0',process.execPath,'-e',FILL_HEAP],{source:'private',env:SIZED,limits});
  assert.equal(stopped.run.signal,'SIGABRT');
  assert.ok(stopped.residentPeakBytes<limits.residentBytes,'the resident scope was never full');
  assert.ok(stopped.budget,'no budget: '+stopped.run.stderr);
  const {reason,...budget}=stopped.budget;
  assert.deepEqual(budget,{phase:'execute',outcome:'memory-cap',bound:heap,signal:'SIGABRT'});
  assert.match(reason,new RegExp(`^oracle memory-cap: private stopped at V8's ${heap} byte JavaScript heap limit, which node set from its ${limits.residentBytes} byte resident scope: FATAL ERROR: .*heap limit.* - JavaScript heap out of memory$`));
  // The control differs in one thing: a flag sets the heap past the scope, so the kernel stops the run at the resident bound first.
  const capped=await runOracleCommand(process.execPath,['--max-old-space-size=4096','-e',FILL_HEAP],{source:'private',env:SIZED,limits});
  assert.equal(capped.budget?.outcome,'memory-cap');assert.equal(capped.budget?.bound,limits.residentBytes);
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
