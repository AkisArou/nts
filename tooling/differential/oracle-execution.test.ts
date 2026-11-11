import {scriptedCommand,commandSample} from '../gate/command-observations-fixture.ts';
import {publishHung} from '../gate/step-result.ts';
import type {compileActive} from '../census/worker-memory.ts';
import {testEnvironment,fixtureEnvironment} from "../gate/test-environment.ts";
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {after,test} from 'node:test';
import {closeMemoryRun} from '../census/worker-memory.ts';
import {COMMAND_IDLE_GUARD_MS,COMPILE_CPU_BOUND_SECONDS,CommandNotMeasuredError} from '../gate/active-command.ts';
import {ToolingInstrumentError} from '../gate/step-result.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {spawnTest} from '../gate/test-wait.ts';
import {ORACLE_HEAP_FLAGS,ORACLE_PLANNER_LIMITS,oracleChildProblem,oracleExecutionLimits,oracleNode,runOracleCommand,runOraclePlanner,v8HeapStop} from './oracle-execution.ts';
import {ORACLE_EXECUTION_POLICY as policy} from './oracle-execution-policy.ts';

after(closeMemoryRun);
test('the recorder and native launcher share the stated population policy',()=>{
  assert.deepEqual(oracleExecutionLimits('benchmarks/cases/subject/case.ts'),{cpuSeconds:60,residentBytes:2*2**30});
  assert.deepEqual(oracleExecutionLimits('tests/programs/subject/main.ts'),{cpuSeconds:15,residentBytes:2*2**30});
});
test('virtual reservation alone does not exhaust the oracle resident scope',async()=>{
  const source=`const m=new WebAssembly.Memory({initial:1,maximum:65536}); const fs=await import('node:fs'); console.log(fs.readFileSync('/proc/self/status','utf8').match(/^VmSize:\\s+(\\d+)/m)[1]); console.log(m.buffer.byteLength);`;
  const result=await runOracleCommand(process.execPath,[...ORACLE_HEAP_FLAGS,'--input-type=module','-e',source],{source:'benchmarks/cases/private/case.ts',env:testEnvironment()});
  assert.equal(result.run.status,0,result.run.stderr);assert.equal(result.budget,undefined);
  assert.ok(Number(result.run.stdout.split('\n')[0])*1024>2*2**30,'more than 2 GiB is reserved virtually');
  assert.ok(result.residentPeakBytes<2*2**30);
});
test('only an observed CPU or own resident bound is a case budget',async t=>{
  const root=testScratch(t,'oracle-timeout'),script=join(root,'control.ts');
  writeFileSync(script,`
import {mock} from 'node:test';
import {writeFileSync} from 'node:fs';
import {scriptedCommand,commandSample} from ${JSON.stringify(new URL('../gate/command-observations-fixture.ts',import.meta.url).href)};
const activeURL=${JSON.stringify(new URL('../gate/active-command.ts',import.meta.url).href)},real=await import(activeURL);
mock.module(activeURL,{namedExports:{...real,activeCommand:async(command,args,options)=>{
  const entry=args.indexOf('nts-resident-worker');if(entry<0)throw Error('no supplied scope entry');
  writeFileSync(args[entry+1],'supplied bounded entry');
  return scriptedCommand(command,options,[commandSample(300,{cpu:10,processOwn:{pid:71,cpu:10}})],{stdoutRaw:Buffer.alloc(0),stderrRaw:Buffer.alloc(0)});
}}});
const {runOracleCommand,ORACLE_HEAP_FLAGS}=await import(${JSON.stringify(new URL('./oracle-execution.ts',import.meta.url).href)});
const {closeMemoryRun}=await import(${JSON.stringify(new URL('../census/worker-memory.ts',import.meta.url).href)});
try{console.log(JSON.stringify(await runOracleCommand(process.execPath,[...ORACLE_HEAP_FLAGS,'-e','process.exit(127)'],{source:'private',env:process.env,limits:{cpuSeconds:0.1,residentBytes:2*2**30}})));}
finally{closeMemoryRun();}
`);
  const control=spawnTest(process.execPath,['--experimental-test-module-mocks',script],{encoding:'utf8',env:fixtureEnvironment(t)},'supplied oracle CPU boundary');
  assert.equal(control.status,0,control.stdout+control.stderr);
  const timed=JSON.parse(control.stdout);
  assert.equal(timed.budget?.outcome,'timeout');assert.equal(timed.budget?.bound,0.1);
  const capped=await runOracleCommand(process.execPath,[...ORACLE_HEAP_FLAGS,'-e','const held=[];for(;;)held.push(Buffer.alloc(16*1024*1024,1));'],{source:'private',env:testEnvironment(),limits:{cpuSeconds:15,residentBytes:128*2**20}});
  assert.equal(capped.budget?.outcome,'memory-cap');assert.equal(capped.budget?.bound,128*2**20);
  const stopped=await runOracleCommand(process.execPath,[...ORACLE_HEAP_FLAGS,'-e',"process.kill(process.pid,'SIGABRT')"],{source:'private',env:testEnvironment()});
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

const HEAP_LIMIT="process.stdout.write(String(require('node:v8').getHeapStatistics().heap_size_limit))";
// Large arrays reach the heap limit in a second, where small objects take several.
const FILL_HEAP='const held=[];for(;;)held.push(new Array(1<<17).fill(1.5));';
const UNSET=(()=>{const env={...testEnvironment()};delete env.NODE_OPTIONS;return env;})();
test("an oracle child's heap limit is the policy's in its scope, whatever NODE_OPTIONS it inherits",async()=>{
  for(const options of [undefined,'--max-old-space-size=8192 --max-semi-space-size=64','--max_old_space_size=8192']){
    const env=options===undefined?UNSET:{...UNSET,NODE_OPTIONS:options};
    const probe=await runOracleCommand(process.execPath,[...ORACLE_HEAP_FLAGS,'-e',HEAP_LIMIT],{source:'tests/programs/private/main.ts',env});
    assert.equal(probe.run.status,0,probe.run.stderr);
    assert.equal(Number(probe.run.stdout),policy.heapBytes,'NODE_OPTIONS '+(options??'unset'));
  }
  // The control differs in one thing: no heap flags, so node sizes the heap itself, from the scope or from NODE_OPTIONS.
  const sized=spawnSync(process.execPath,['-e',HEAP_LIMIT],{encoding:'utf8',env:{...UNSET,NODE_OPTIONS:'--max-old-space-size=8192'}});
  assert.notEqual(Number(sized.stdout),policy.heapBytes);
});
test('an oracle child is refused without the policy\'s heap flags, with another heap flag, or under the option that overrides them',async()=>{
  assert.equal(oracleChildProblem('prlimit',['--core=0','node',...ORACLE_HEAP_FLAGS,'driver.mjs'],UNSET),null);
  assert.equal(oracleChildProblem('taskset',['-c','4',process.execPath,...ORACLE_HEAP_FLAGS,'--import','data:x','driver.mjs'],{...UNSET,NODE_OPTIONS:'--max-old-space-size=8192'}),null);
  assert.match(oracleChildProblem('sh',['-c','node driver.mjs'],UNSET)!,/^an oracle child runs node, not sh -c node driver\.mjs$/);
  assert.match(oracleChildProblem(process.execPath,['driver.mjs'],UNSET)!,/heap flags \(--max-old-space-size=\d+ --max-semi-space-size=\d+\) and no other, not none$/);
  assert.match(oracleChildProblem(process.execPath,[...ORACLE_HEAP_FLAGS,'--max_old_space_size=4096','driver.mjs'],UNSET)!,/and no other, not .* --max_old_space_size=4096$/);
  assert.match(oracleChildProblem(process.execPath,[...ORACLE_HEAP_FLAGS,'--max-heap-size=4096','driver.mjs'],UNSET)!,/not .* --max-heap-size=4096$/);
  for(const options of ['--max-old-space-size-percentage=90','--no-warnings --max_old_space_size_percentage 50%'])
    assert.match(oracleChildProblem(process.execPath,[...ORACLE_HEAP_FLAGS,'driver.mjs'],{...UNSET,NODE_OPTIONS:options})!,/^NODE_OPTIONS sets --max[-_]old[-_]space[-_]size[-_]percentage(=90)?, which overrides the oracle execution policy's heap; unset it$/);
  // Refused before a scope is made: the child never runs.
  await assert.rejects(runOracleCommand(process.execPath,['-e',HEAP_LIMIT],{source:'private',env:UNSET}),
    error=>error instanceof ToolingInstrumentError&&/^oracle execution refused: an oracle child starts with/.test(error.message));
  await assert.rejects(runOracleCommand(process.execPath,[...ORACLE_HEAP_FLAGS,'-e',HEAP_LIMIT],{source:'private',env:{...UNSET,NODE_OPTIONS:'--max-old-space-size-percentage=90'}}),
    error=>error instanceof ToolingInstrumentError&&/^oracle execution refused: NODE_OPTIONS sets --max-old-space-size-percentage=90/.test(error.message));
});
test("a run V8 stops at its heap limit is held to the policy's heap, never to the resident scope it did not fill",async()=>{
  // Started as the native differential starts it, past a wrapper, in the policy's own scope.
  const stopped=await runOracleCommand('prlimit',['--core=0',process.execPath,...ORACLE_HEAP_FLAGS,'-e',FILL_HEAP],{source:'private',env:testEnvironment()});
  assert.equal(stopped.run.signal,'SIGABRT');
  assert.ok(stopped.residentPeakBytes<policy.residentBytes,'the resident scope was never full');
  assert.ok(stopped.budget,'no budget: '+stopped.run.stderr);
  const {reason,...budget}=stopped.budget;
  assert.deepEqual(budget,{phase:'execute',outcome:'memory-cap',bound:policy.heapBytes,signal:'SIGABRT'});
  assert.match(reason,new RegExp(`^oracle memory-cap: private stopped at V8's ${policy.heapBytes} byte JavaScript heap limit, the oracle execution policy's: FATAL ERROR: .*heap limit.* - JavaScript heap out of memory$`));
  // The control differs in one thing: a scope smaller than the heap, so the kernel stops the run at the resident bound first.
  const capped=await runOracleCommand(process.execPath,[...ORACLE_HEAP_FLAGS,'-e',FILL_HEAP],{source:'private',env:testEnvironment(),limits:{cpuSeconds:15,residentBytes:512*2**20}});
  assert.equal(capped.budget?.outcome,'memory-cap');assert.equal(capped.budget?.bound,512*2**20);
});

test('the shared execution transports stdout and stderr byte for byte',async()=>{
  const value=await runOracleCommand(process.execPath,[...ORACLE_HEAP_FLAGS,'-e','process.stdout.write(Buffer.from([0,255,128]));process.stderr.write(Buffer.from([254,0]));'],{source:'tests/programs/private/main.ts',env:testEnvironment()});
  assert.equal(value.run.status,0);assert.equal(value.stdoutHex,'00ff80');assert.equal(value.stderrHex,'fe00');
});

// A planner fixture receives the planner's arguments. Its step frame is the
// test's own, so a hold it publishes is read here and reaches no gate step.
function planner(t:{after(fn:()=>void):void},interpreter:string,body:string){
  const root=testScratch(t,'oracle-planner'),file=join(root,'oracle-plan'),result=join(root,'result.json');
  writeFileSync(file,`#!${interpreter}\n${body}\n`,{mode:0o755});
  return {file,env:{...fixtureEnvironment(t),NTS_GATE_STEP_RESULT:result,NTS_GATE_STEP:'oracle-planner-control',NTS_GATE_STEP_ATTEMPT:'control'},
    published:()=>existsSync(result)?(JSON.parse(readFileSync(result,'utf8')) as {kind:string}).kind:null};
}
test('the planner is held as a case compile is: its CPU bound, and the shared activity guard',()=>{
  assert.deepEqual(ORACLE_PLANNER_LIMITS,{cpuSeconds:COMPILE_CPU_BOUND_SECONDS,idleMs:COMMAND_IDLE_GUARD_MS});
});
// What oracle-plan prints first, once its capture finds its entry.
const ENTRY={entry:'/fixtures/benchmarks/cases/slow/case.ts',source:'benchmarks/cases/slow/case.ts'};
const suppliedPlanner=(samples:Parameters<typeof scriptedCommand>[2],stdout=''):typeof compileActive=>async(_tools,command,_args,options={})=>{
  const result=scriptedCommand(command,options,samples,{stdout});
  if(result.hung){publishHung(result.hung,options.env);throw new CommandNotMeasuredError(result);}
  return {...result,memoryKilled:false,residentLimitBytes:2*2**30,residentRunBytes:2*2**30};
};
test('a planner past its CPU bound planned no population: a plan budget, which is no hold',async t=>{
  const f=planner(t,process.execPath,'process.exit(127)');
  const planned=await runOraclePlanner(f.file,['project.json'],{env:f.env,limits:{cpuSeconds:0.3,idleMs:2000},compile:suppliedPlanner([commandSample(300,{cpu:30,processOwn:{pid:71,cpu:30}})])});
  assert.ok('budget' in planned,JSON.stringify(planned));
  const {reason,...budget}=planned.budget;
  assert.deepEqual(budget,{phase:'plan',outcome:'timeout',bound:0.3,signal:'SIGKILL'});
  assert.match(reason,/^oracle planner timed out: .* used its 0\.3 s CPU bound: process \d+ own CPU reached/);
  assert.equal(planned.entry,undefined,'it named no entry before its bound');
  assert.equal(f.published(),null,'a budget is the case outcome, never the step hold');
});
test('a plan budget is for the entry its planner named before its bound',async t=>{
  const f=planner(t,process.execPath,'process.exit(127)');
  const planned=await runOraclePlanner(f.file,['project.json'],{env:f.env,limits:{cpuSeconds:0.3,idleMs:2000},compile:suppliedPlanner([commandSample(300,{cpu:30,processOwn:{pid:71,cpu:30}})],JSON.stringify(ENTRY)+'\n')});
  assert.ok('budget' in planned,JSON.stringify(planned));
  assert.deepEqual(planned.entry,ENTRY);
  assert.equal(f.published(),null);
});
test('an active planner that prints nothing until it is done is not stopped by the activity bound',async t=>{
  // Busy activity remains live even after an arbitrary virtual scheduling delay.
  const f=planner(t,process.execPath,'process.exit(127)');
  const planned=await runOraclePlanner(f.file,['project.json'],{env:f.env,limits:{cpuSeconds:60,idleMs:1000},compile:suppliedPlanner([commandSample(9_000_000,{busy:true})],JSON.stringify(ENTRY)+'\n'+JSON.stringify({planned:'project.json'})+'\n')});
  assert.deepEqual(planned,{plan:'{"planned":"project.json"}\n',entry:ENTRY},'the plan is the rest, byte for byte');
  assert.equal(f.published(),null);
});
test('a planner that names no entry first is held, never read as a plan',async t=>{
  for(const body of ['process.stdout.write(JSON.stringify({planned:true})+"\\n");','process.stdout.write(\'{"entry":"relative.ts","source":null}\\n{}\\n\');','process.stdout.write("{}");']){
    const f=planner(t,process.execPath,body);
    await assert.rejects(runOraclePlanner(f.file,['project.json'],{env:f.env,limits:{cpuSeconds:60,idleMs:60_000}}),
      error=>error instanceof ToolingInstrumentError&&/^oracle planner held: (its first line names no entry|it named no entry)/.test(error.message),body);
  }
});
test('a planner with no output, CPU or busy thread measured nothing: hung, held, never a budget',async t=>{
  const f=planner(t,process.execPath,'process.exit(127)');
  await assert.rejects(runOraclePlanner(f.file,['project.json'],{env:f.env,limits:{cpuSeconds:60,idleMs:1000},compile:suppliedPlanner([commandSample(1000)])}),
    error=>error instanceof CommandNotMeasuredError&&error.kind==='hung');
  assert.equal(f.published(),'hung');
});
test('a planner that fails is held with its diagnostic, never a budget',async t=>{
  const f=planner(t,'/bin/sh','echo "the program does not typecheck" >&2; exit 3');
  await assert.rejects(runOraclePlanner(f.file,['project.json'],{env:f.env,limits:{cpuSeconds:60,idleMs:60_000}}),
    error=>error instanceof ToolingInstrumentError&&/^oracle planner held: exit 3\n.*does not typecheck/s.test(error.message));
});
