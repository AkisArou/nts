import {runAsCommand} from "../gate/command-entry.ts";
// One producer owns the SDK; consumers read authenticated answers after it
// exits. A bounded warm pool amortizes SDK startup without retaining its heaps.
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {availableParallelism} from 'node:os';
import {REPOSITORY,oracleRecipeIdentity} from './oracle-emit.ts';
import {OracleFilesystem,type HostObservation} from './oracle-filesystem.ts';
import {readRecords,fixtureOf,type OracleTable} from './oracle-records.ts';
import {createProgramOracleResults,resultHash,type ProgramAnswer,type ProgramCapture} from './oracle-results.ts';
import {programOracleDirectory} from './oracle-result-scope.ts';
export {programOracleDirectory} from './oracle-result-scope.ts';
import {OUTCOMES,outcomeFixtures,runMode,materialise} from '../conformance/outcomes-project.ts';
import {ownCensusScratch} from '../census/census-scratch.ts';
import {memoryRun,closeMemoryRun,workerCapBytes} from '../census/worker-memory.ts';
import {runMemoryWorkers} from '../census/worker-pool.ts';
import {ToolingInstrumentError,publishToolingFailure} from '../gate/step-result.ts';

/**
 * What a program holds, measured as it runs: its worker's scope over the
 * program (the SDK, the planner and the supervisor, on the kernel's basis,
 * page cache included) and its oracle's own resident scope. Each program's
 * token is sized by the shared case lease: its measured history, or live use
 * and margin before the first measurement.
 */
export type ProgramMemory={scopePeakBytes:number;oraclePeakBytes:number|null};
/** A program that leaves its worker holding more than this is followed by a fresh worker. */
export const PROGRAM_WORKER_RECYCLE_BYTES=512*2**20;

export const PROGRAM_EMIT_PROJECTS=Object.freeze([
  'a-declared-value-is-not-an-arrival-proof','a-typed-literal-assertion-keeps-its-value',
  'an-enum-across-a-module','an-enum-member-read-by-its-name','enums','string-enum',
]);
export type ProgramOracleTask={subject:string;project:string;entry:string;mode:'calls'|'observation';program:boolean;observations:HostObservation[]};
export const OUTCOME_CONTROLS=Object.freeze([
  {name:'control',text:'observe("sum", String(1 + 2));\ndone();\n'},
  {name:'refusal',text:'function classify(text: string): boolean { return /^[a-z]+$/.test(text); }\nobserve("r", String(classify("abc")));\ndone();\n'},
  {name:'unchecked',text:'const xs = [1, 2];\nobserve("past the end", String(xs["ab".length]));\ndone();\n',options:{noUncheckedIndexedAccess:true}},
  {name:'typed',text:'const xs = [1, 2];\nobserve("past the end", String(xs["ab".length]));\ndone();\n'},
]);
/** The JVM arm checks this generated program before its fixture corpus. Keep
 * generation in the producer, so the consumer has no uncaptured extra project. */
export function sweepOracleTask(directory:string):ProgramOracleTask{
  const fs=new OracleFilesystem(),generator=fileURLToPath(new URL('../sweep/sweep.mjs',import.meta.url));
  if(!fs.readBytes(generator))throw new ToolingInstrumentError('tooling-setup','JVM sweep generator is missing');
  const generated=spawnSync(process.execPath,[generator],{encoding:'utf8',maxBuffer:16*1024**2});
  if(generated.error||generated.status!==0)throw new ToolingInstrumentError('tooling-setup','JVM sweep generation failed: '+String(generated.error??generated.stderr));
  const project=join(directory,'inputs/jvm-sweep'),entry=join(project,'src/main.ts');
  mkdirSync(dirname(entry),{recursive:true});writeFileSync(entry,generated.stdout);
  const pkg=fs.readBytes(join(REPOSITORY,'package.json'));
  if(!pkg)throw new ToolingInstrumentError('tooling-setup','JVM sweep module format is missing');
  writeFileSync(join(project,'package.json'),pkg);
  writeFileSync(join(project,'tsconfig.json'),JSON.stringify({extends:join(REPOSITORY,'tsconfig.fixtures.json'),include:['src']}));
  return {subject:'gate/jvm-sweep',project:join(project,'tsconfig.json'),entry,mode:'calls',program:false,observations:fs.captured()};
}

/** A recorded budget is work to retry, never an empty population. */
export function hasOracleWork(row:{kind:string;count?:number}):boolean{
  return row.kind==='budget'||row.kind==='measured'&&!!row.count;
}
/**
 * The entry each fixture's program oracle plans: its row's, or its plan
 * budget's, which is a budget too and so work to retry. A fixture has one.
 */
export function programOracleSources(table:Pick<OracleTable,'rows'|'unplanned'>):string[]{
  const sources=new Map<string,string>();
  for(const row of table.rows){
    const benchmark=row.source.startsWith('benchmarks/cases/');
    if(!benchmark&&(!hasOracleWork(row)||!row.source.startsWith('tests/programs/')))continue;
    const fixture=fixtureOf(row.source);if(sources.has(fixture))throw Error('program oracle has multiple source entries: '+fixture);
    sources.set(fixture,row.source);
  }
  for(const {source} of table.unplanned??[]){
    const fixture=fixtureOf(source),known=sources.get(fixture);
    if(known!==undefined&&known!==source)throw Error('program oracle has multiple source entries: '+fixture);
    sources.set(fixture,source);
  }
  return [...sources.values()];
}
export function programOracleTasks(directory:string):ProgramOracleTask[]{
  const tasks:ProgramOracleTask[]=[];
  for(const source of programOracleSources(readRecords(REPOSITORY))){
    const benchmark=source.startsWith('benchmarks/cases/'),fixture=fixtureOf(source);
    let project=join(REPOSITORY,fixture,'tsconfig.json');
    const fs=new OracleFilesystem();
    if(benchmark&&!fs.fileExists(project)){
      const generated=join(directory,'inputs/benchmarks');mkdirSync(generated,{recursive:true});
      project=join(generated,fixture.split('/').at(-1)!+'.tsconfig.json');
      writeFileSync(project,JSON.stringify({extends:join(REPOSITORY,'tsconfig.fixtures.json'),include:[join(REPOSITORY,fixture,'case.ts')]}));
    }
    tasks.push({subject:fixture,project,entry:join(REPOSITORY,source),mode:'calls',
      program:PROGRAM_EMIT_PROJECTS.includes(fixture.split('/').at(-1)!),observations:fs.captured()});
  }
  const inputs=join(directory,'inputs');mkdirSync(inputs,{recursive:true});
  for(const name of outcomeFixtures()){
    const record=join(OUTCOMES,name,'outcome.json'),fs=new OracleFilesystem();
    if(!fs.fileExists(record))continue;
    const mode=runMode(name),project=materialise(inputs,name,join(OUTCOMES,name,'src'),mode,fs);
    tasks.push({subject:'tests/outcomes/'+name,project:join(project,'tsconfig.json'),entry:join(project,'src/main.ts'),mode:mode==='check'?'calls':'observation',program:false,observations:fs.captured()});
  }
  for(const control of OUTCOME_CONTROLS){
    const source=join(inputs,'control-sources',control.name);mkdirSync(join(source,'src'),{recursive:true});
    writeFileSync(join(source,'src/main.ts'),control.text);
    writeFileSync(join(source,'tsconfig.json'),JSON.stringify({compilerOptions:'options' in control?control.options:{}}));
    const fs=new OracleFilesystem(),project=materialise(inputs,'control-'+control.name,join(source,'src'),'build',fs);
    tasks.push({subject:'outcome-control/'+control.name,project:join(project,'tsconfig.json'),entry:join(project,'src/main.ts'),mode:'observation',program:false,observations:fs.captured()});
  }
  tasks.push(sweepOracleTask(directory));
  return tasks;
}

export async function produceProgramOracles({directory,jobs=Math.min(2,availableParallelism()),tasks:provided}: {directory:string;jobs?:number;tasks?:ProgramOracleTask[]}):Promise<void>{
  if(typeof directory!=='string'||!isAbsolute(directory))throw Error('program oracle publication requires an explicit absolute root');
  const inputs=join(directory,'tasks'),results=join(directory,'results');
  mkdirSync(inputs,{recursive:true});mkdirSync(results,{recursive:true});
  const tasks=provided??programOracleTasks(directory);
  const {path:scratch,cleanup}=ownCensusScratch(closeMemoryRun);
  try{
    const {acquireToken}=await import('../gate/tokens.mjs');
    if(!Number.isSafeInteger(jobs)||jobs<1)throw Error('invalid program oracle worker count');
    const subjects=new Map<string,string>();
    const paths=tasks.map(task=>{const file=join(inputs,resultHash(task.subject)+'.json');writeFileSync(file,JSON.stringify(task));subjects.set(file,task.subject);return file;});
    const writer=createProgramOracleResults(results,oracleRecipeIdentity()),errors:string[]=[];
    let done=0,budgets=0;
    const report=(message:string)=>process.stderr.write('  '+message+'\n');
    // Every worker keeps the case's hard budget; its lease separately sizes
    // admission from measured peaks or live use, at every pool width.
    const memory=memoryRun(),workers=Math.min(jobs,paths.length);
    await runMemoryWorkers({paths,jobs:workers,memory,workerBytes:workerCapBytes(),recycleAfterCases:16,recycleAboveBytes:PROGRAM_WORKER_RECYCLE_BYTES,
      key:'program-oracles',what:'program oracle references',
      token:(path,signal)=>acquireToken({project:subjects.get(path)!,backend:'node'},signal),
      args:index=>[fileURLToPath(new URL('./program-oracle-worker.ts',import.meta.url)),join(scratch,'w'+index),join(directory,'executables')],report,
      onRow:(row:{path:string;bucket:string;why?:string;answer?:ProgramAnswer;capture?:ProgramCapture;memory?:ProgramMemory})=>{
        if(row.bucket!=='oracle-reference'||!row.answer||!row.capture)errors.push(row.path+': '+(row.why??row.bucket));
        else {writer.add(row.answer,row.capture);if(row.answer.kind==='budget')budgets++;}
        if(++done%100===0)report(`${done}/${paths.length} program answers finalized`);
      }});
    if(errors.length)throw new ToolingInstrumentError('tooling-setup','program oracle references were not measured:\n'+errors.join('\n'));
    if(done!==paths.length)throw Error(`program oracle references incomplete: ${done}/${paths.length}`);
    cleanup();const root=writer.publish();
    process.stdout.write(`  Program oracle references: ${root.count-budgets} measured once, ${budgets} loud budget outcomes; SDK workers drained before native execution\n`);
  }finally{cleanup();}
}

runAsCommand(import.meta.url,async()=>{
  try{const at=process.argv.indexOf('--jobs');await produceProgramOracles({directory:programOracleDirectory(),jobs:at<0?undefined:Number(process.argv[at+1])});}
  catch(error){const failure=error instanceof ToolingInstrumentError?error:new ToolingInstrumentError('tooling-setup',String(error instanceof Error?error.stack:error));publishToolingFailure(failure);process.stderr.write(failure.message+'\n');process.exitCode=2;}
});
