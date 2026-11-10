// The recorder and the native differential execute the same population under
// one CPU allowance and the census's resident-memory owner. Virtual address
// reservations are not memory consumption, and a signal alone proves no cap.
//
// Two memory bounds hold an oracle: the resident scope, which the kernel
// enforces, and the JavaScript heap, which V8 enforces at the policy's
// heapBytes. Every oracle child starts with oracle-toolchain.json's execution
// flags, which set that heap. On the command line they follow an inherited
// NODE_OPTIONS, so its own heap flags lose; the one option that would still
// override them is refused by name. A run V8 stops at its heap limit ends with
// SIGABRT and V8's own words on stderr, before the scope is full; that stop is
// the oracle's memory budget, at the policy's heap.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {basename,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {activeCommand,COMMAND_ACTIVITY_POLL_MS,COMMAND_IDLE_GUARD_MS,COMPILE_CPU_BOUND_SECONDS,type ActiveResult} from '../gate/active-command.ts';
import {CaseBudgetError,PressureError,ToolingInstrumentError,publishPressure} from '../gate/step-result.ts';
import {memoryRun,memoryCause,memoryDisposition,closeMemoryRun,compileActive} from '../census/worker-memory.ts';

import {ORACLE_EXECUTION_POLICY as policy} from './oracle-execution-policy.ts';
import {V8_HEAP_FLAG,type OracleBudget} from './oracle-runtime.ts';
export type {OracleBudget} from './oracle-runtime.ts';
assert.equal(policy.version,2,'unknown oracle execution policy');
for(const key of ['cpuSeconds','benchmarkCpuSeconds','residentBytes','heapBytes'] as const)assert.ok(Number.isSafeInteger(policy[key])&&policy[key]>0,'invalid oracle execution policy: '+key);
assert.ok(policy.heapBytes<policy.residentBytes,'the oracle heap must fit its resident scope');
/** The heap flags every oracle child starts with: those in oracle-toolchain.json's execution arguments, the policy's heap. */
export const ORACLE_HEAP_FLAGS:readonly string[]=Object.freeze((JSON.parse(readFileSync(new URL('./oracle-toolchain.json',import.meta.url),'utf8')).execution.args as string[]).filter(flag=>V8_HEAP_FLAG.test(flag)));
assert.deepEqual(ORACLE_HEAP_FLAGS.map(flag=>flag.split('=')[0]),['--max-old-space-size','--max-semi-space-size'],'oracle execution arguments do not set the heap');
export type OracleLimits={cpuSeconds:number;residentBytes:number};
export function oracleExecutionLimits(source:string):OracleLimits{
  const benchmark=source.replaceAll('\\','/').startsWith('benchmarks/cases/');
  return {cpuSeconds:benchmark?policy.benchmarkCpuSeconds:policy.cpuSeconds,residentBytes:policy.residentBytes};
}
export class OracleBudgetError extends CaseBudgetError{
  readonly budget:OracleBudget;
  constructor(budget:OracleBudget){super(budget.reason);this.name='OracleBudgetError';this.budget=budget;}
}
export type OracleCommandResult={stdoutHex:string;stderrHex:string;run:Omit<ActiveResult,'error'|'stdoutRaw'|'stderrRaw'>&{error?:string};limits:OracleLimits;residentPeakBytes:number;budget?:OracleBudget};
let ordinal=0;

/**
 * V8's own line when it stopped a run at the JavaScript heap's limit, or null.
 * V8 says "JavaScript heap out of memory" for a table or an array past its own
 * size limit too (`invalid table size`), which is no heap limit: only a line
 * that names the heap limit is that stop.
 */
export function v8HeapStop(stderr:string):string|null{
  return /^FATAL ERROR: .*\bheap limit\b.* - JavaScript heap out of memory$/m.exec(stderr)?.[0]??null;
}

/** Where an oracle command's node is: past the wrappers that start it, `taskset -c <cpus>` and `prlimit --<limit>`; -1 when it is no node. */
function nodeAt(line:readonly string[]):number{
  let at=0;
  for(;;){
    const word=basename(line[at]??'');
    if(word==='taskset'){at+=line[at+1]?.startsWith('-')?3:2;continue;}
    if(word==='prlimit'){at++;while(line[at]?.startsWith('--'))at++;continue;}
    break;
  }
  const program=line[at];
  return program&&/^node\d*$/.test(basename(program))?at:-1;
}
/** The node an oracle command runs, or null when it is no node. */
export function oracleNode(command:string,args:readonly string[]):string|null{
  const line=[command,...args],at=nodeAt(line);
  return at<0?null:line[at]!;
}

/**
 * Why a command cannot be an oracle child, or null. An oracle child runs node
 * with the policy's heap flags and no other heap flag, so V8's limit is the
 * policy's heapBytes, and no NODE_OPTIONS option it inherits overrides them.
 */
export function oracleChildProblem(command:string,args:readonly string[],env:NodeJS.ProcessEnv):string|null{
  const line=[command,...args],at=nodeAt(line);
  if(at<0)return `an oracle child runs node, not ${line.join(' ')}`;
  const flags=line.slice(at+1).filter(flag=>V8_HEAP_FLAG.test(flag));
  if(JSON.stringify(flags)!==JSON.stringify(ORACLE_HEAP_FLAGS))
    return `an oracle child starts with the oracle execution policy's heap flags (${ORACLE_HEAP_FLAGS.join(' ')}) and no other, not ${flags.join(' ')||'none'}`;
  // node lets this one option override an explicit old space, wherever it is set.
  const option=(env.NODE_OPTIONS??'').split(/\s+/).find(word=>/^--max[-_]old[-_]space[-_]size[-_]percentage(?:=|$)/.test(word));
  return option?`NODE_OPTIONS sets ${option}, which overrides the oracle execution policy's heap; unset it`:null;
}
export async function runOracleCommand(command:string,args:string[],options:{source:string;cwd?:string;env:NodeJS.ProcessEnv;limits?:OracleLimits;idleMs?:number}):Promise<OracleCommandResult>{
  const problem=oracleChildProblem(command,args,options.env);
  if(problem)throw new ToolingInstrumentError('tooling-setup','oracle execution refused: '+problem);
  const limits=options.limits??oracleExecutionLimits(options.source);
  const memory=memoryRun(),resident=memory.worker('execution'+ordinal++,limits.residentBytes);
  const scope=resident.scope('prlimit',['--core=0',command,...args],options.env);
  const before=resident.counters(),aggregateBefore=memory.aggregateOoms();
  try{
    const {stdoutRaw,stderrRaw,...result}=await activeCommand('systemd-run',scope.argv,{cwd:options.cwd??process.cwd(),env:scope.env,
      captureBytes:true,eachProcessCpuSeconds:limits.cpuSeconds,idleMs:options.idleMs??300_000,maxBuffer:64*2**20});
    assert.ok(stdoutRaw&&stderrRaw,'oracle execution raw output was not captured');
    if(!resident.ready(scope))throw new ToolingInstrumentError('tooling-setup','oracle execution scope failed before bounded entry: '+result.stderr);
    resident.stop(scope);
    const cause=memoryCause(before,resident.counters(),aggregateBefore,memory.aggregateOoms());
    const disposition=memoryDisposition(cause,'exclusive');
    if(disposition==='pressure'||disposition==='budget'&&resident.bytes<limits.residentBytes)throw new PressureError('oracle execution not measured: resident '+cause);
    // systemd-run can return an encoded child exit. Do not invent a signal
    // from that number: only the supervisor's observed signal is provenance.
    const signal=result.signal;
    let budget:OracleBudget|undefined=disposition==='budget'
      ?{phase:'execute',outcome:'memory-cap',bound:limits.residentBytes,signal,reason:`oracle memory-cap: ${options.source} exceeded its ${limits.residentBytes} byte resident budget`}
      :result.timeout?{phase:'execute',outcome:'timeout',bound:limits.cpuSeconds,signal,reason:'oracle timed out: '+result.timeout}:undefined;
    // V8's stop at its heap limit, the policy's, which is the bound the row names: the scope was not full.
    const stop=!budget&&signal==='SIGABRT'?v8HeapStop(stderrRaw.toString('utf8')):null;
    if(stop)budget={phase:'execute',outcome:'memory-cap',bound:policy.heapBytes,signal,
      reason:`oracle memory-cap: ${options.source} stopped at V8's ${policy.heapBytes} byte JavaScript heap limit, the oracle execution policy's: ${stop}`};
    return {stdoutHex:stdoutRaw.toString('hex'),stderrHex:stderrRaw.toString('hex'),run:{...result,error:result.error?.message},limits,residentPeakBytes:Number(readFileSync('/sys/fs/cgroup'+resident.group+'/memory.peak','utf8')),...(budget?{budget}:{})};
  }finally{resident.stop(scope);resident.close();}
}

/** The planner computes a calls-mode oracle's population by capturing and
 * checking the case's program, so it is held as the case's compile is: every
 * process of its session to the compile's CPU bound, and the shared inactivity
 * guard for one that sleeps with no output and no CPU. Past its CPU bound it
 * planned no population, which is the case's budget in the plan phase. One that
 * went silent or ran away measured nothing; the supervisor publishes that as
 * the step's hold. In a census worker the planner shares the worker's resident
 * scope, and a kill at its limit is the pool's memory-cap bucket. */
export type OraclePlannerLimits={cpuSeconds:number;idleMs:number};
export const ORACLE_PLANNER_LIMITS:Readonly<OraclePlannerLimits>={cpuSeconds:COMPILE_CPU_BOUND_SECONDS,idleMs:COMMAND_IDLE_GUARD_MS};
export type OraclePlanned={plan:string}|{budget:OracleBudget&{phase:'plan'}};
export async function runOraclePlanner(planner:string,args:readonly string[],options:{env:NodeJS.ProcessEnv;cwd?:string;limits?:OraclePlannerLimits}):Promise<OraclePlanned>{
  const limits=options.limits??ORACLE_PLANNER_LIMITS;
  const result=await compileActive({},planner,args,{cwd:options.cwd??process.cwd(),env:options.env,maxBuffer:64*2**20,
    eachProcessCpuSeconds:limits.cpuSeconds,idleMs:limits.idleMs,pollMs:Math.min(COMMAND_ACTIVITY_POLL_MS,limits.idleMs/4)});
  if(result.timeout&&!result.memoryKilled)return {budget:{phase:'plan',outcome:'timeout',bound:limits.cpuSeconds,signal:result.signal,reason:'oracle planner timed out: '+result.timeout}};
  if(result.status!==0||result.signal||result.error||result.memoryKilled)
    throw new ToolingInstrumentError('tooling-setup','oracle planner held: '+(result.error?.message??result.signal??'exit '+result.status)+'\n'+result.out);
  return {plan:result.stdout};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{
    const mode=process.argv[2],request=JSON.parse(process.argv[3]!);
    if(mode==='--prepare'){
      const toolchain=process.env.NTS_ORACLE_TYPESCRIPT;
      if(!toolchain)throw new ToolingInstrumentError('tooling-setup','oracle TypeScript capability NTS_ORACLE_TYPESCRIPT is missing');
      const {prepareOracles,preparedOracle}=await import('./oracle-batch.ts');
      const members=await prepareOracles([{key:request.entry,options:request}],{directory:resolve(request.directory,'preparation'),toolchain,workers:1,env:process.env,resolutionOwnerPid:process.ppid});
      process.stdout.write(JSON.stringify({prepared:preparedOracle(members[request.entry],'native oracle preparation '+request.entry)})+'\n');
    }else{
      assert.equal(mode,'--run','oracle execution needs --run or --prepare');
      const env={...process.env};for(const [name,value]of request.env as [string,string|null][])if(value===null)delete env[name];else env[name]=value;
      const result=await runOracleCommand(request.command,request.args,{source:request.source,cwd:request.cwd,env});
      process.stdout.write(JSON.stringify(result)+'\n');
    }
  }catch(error){if(error instanceof CaseBudgetError&&'budget' in error)process.stdout.write(JSON.stringify({budget:error.budget})+'\n');else {if(error instanceof PressureError)publishPressure(error);process.stdout.write(JSON.stringify({instrument:{kind:error instanceof PressureError?'memory-pressure':'tooling-setup',reason:String(error)}})+'\n');}}
  finally{closeMemoryRun();}
}
