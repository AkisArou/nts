// One producer owns the SDK; consumers read authenticated answers after it
// exits. A bounded warm pool amortizes SDK startup without retaining its heaps.
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {availableParallelism} from 'node:os';
import {REPOSITORY,oracleRecipeIdentity} from './oracle-emit.ts';
import {OracleFilesystem,type HostObservation} from './oracle-filesystem.ts';
import {readRecords,fixtureOf} from './oracle-records.ts';
import {createProgramOracleResults,resultHash,type ProgramAnswer,type ProgramCapture} from './oracle-results.ts';
import {programOracleDirectory} from './oracle-result-scope.ts';
export {programOracleDirectory} from './oracle-result-scope.ts';
import {OUTCOMES,outcomeFixtures,runMode,materialise} from '../conformance/outcomes-project.ts';
import {ownCensusScratch} from '../census/census-scratch.ts';
import {memoryRun,closeMemoryRun} from '../census/worker-memory.ts';
import {runMemoryWorkers} from '../census/worker-pool.ts';
import {ToolingInstrumentError,publishToolingFailure} from '../gate/step-result.ts';

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
  const fs=new OracleFilesystem(),generator=join(REPOSITORY,'tooling/sweep/sweep.mjs');
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
export function programOracleTasks(directory:string):ProgramOracleTask[]{
  const tasks:ProgramOracleTask[]=[],seen=new Set<string>();
  for(const row of readRecords(REPOSITORY).rows){
    const benchmark=row.source.startsWith('benchmarks/cases/');
    if(!benchmark&&(!hasOracleWork(row)||!row.source.startsWith('tests/programs/')))continue;
    const fixture=fixtureOf(row.source);if(seen.has(fixture))throw Error('program oracle has multiple source entries: '+fixture);seen.add(fixture);
    let project=join(REPOSITORY,fixture,'tsconfig.json');
    const fs=new OracleFilesystem();
    if(benchmark&&!fs.fileExists(project)){
      const generated=join(directory,'inputs/benchmarks');mkdirSync(generated,{recursive:true});
      project=join(generated,fixture.split('/').at(-1)!+'.tsconfig.json');
      writeFileSync(project,JSON.stringify({extends:join(REPOSITORY,'tsconfig.fixtures.json'),include:[join(REPOSITORY,fixture,'case.ts')]}));
    }
    tasks.push({subject:fixture,project,entry:join(REPOSITORY,row.source),mode:'calls',
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
    const paths=tasks.map(task=>{const file=join(inputs,resultHash(task.subject)+'.json');writeFileSync(file,JSON.stringify(task));return file;});
    const writer=createProgramOracleResults(results,oracleRecipeIdentity()),errors:string[]=[];
    let done=0,budgets=0;
    const report=(message:string)=>process.stderr.write('  '+message+'\n');
    // Each worker holds an equal share of the job's memory: inside a gate
    // step, the step's reservation (NTS_GATE_STEP_MEMORY_BYTES); alone, the
    // pool's own reservation of the same census budget. A fixed size would
    // decide which programs fit regardless of what the step reserves.
    const memory=memoryRun(),workers=Math.min(jobs,paths.length);
    await runMemoryWorkers({paths,jobs:workers,memory,workerBytes:Math.floor(memory.budgetBytes/Math.max(1,workers)),recycleAfterCases:16,
      what:'program oracle references',token:(path,signal)=>acquireToken({project:path,binary:process.env.NTS_GATE_CASE_BINARY_SHA??''},signal),
      args:index=>[join(dirname(fileURLToPath(import.meta.url)),'program-oracle-worker.ts'),join(scratch,'w'+index),join(directory,'executables')],report,
      onRow:(row:{path:string;bucket:string;why?:string;answer?:ProgramAnswer;capture?:ProgramCapture})=>{
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

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const at=process.argv.indexOf('--jobs');await produceProgramOracles({directory:programOracleDirectory(),jobs:at<0?undefined:Number(process.argv[at+1])});}
  catch(error){const failure=error instanceof ToolingInstrumentError?error:new ToolingInstrumentError('tooling-setup',String(error instanceof Error?error.stack:error));publishToolingFailure(failure);process.stderr.write(failure.message+'\n');process.exitCode=2;}
}
