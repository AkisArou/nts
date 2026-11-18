import {runAsCommand,registerCommandCloser} from "../differential/command-entry/main.ts";
// Test events decide results. Silence can only fail to measure a file.
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {spawn} from "node:child_process";
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {publishHung,publishPressure,publishToolingFailure,PressureError,ToolingInstrumentError} from "./step-result.ts";
import {ToolingEntrySupervisor} from './tooling-entry-supervisor.ts';
import {checkedUnitName,newToolingSlice,stopToolingSlice} from "./tooling-slice.ts";
import {priorityOf} from "./ranks.ts";
import {requireOwnUnit,startBoundSlice} from './scopes/bound-slice.ts';
import {gateCommand} from "./affinity.ts";
import {memoryEvents,supervisorWorkerBoundary} from "../census/worker-memory.ts";
import {assignOwnedValues} from './environment-values.ts';
import {hostObservations} from './host-observations.ts';

/** Shell entry and reporter fixtures share this exact collector command. */
export const TOOLING_COLLECTOR_COMMAND=Object.freeze(["tooling/gate/tooling-runner.ts","--collect"] as const);

export * from './tooling-test-runner.ts';
import {readToolingRequest,readToolingCompletion,toolingTimesReport,toolingFileResults,TOOLING_IDLE_GUARD_MS,TOOLING_SELF_TEST_FILE,type ToolingResult,type ToolingEntryReply} from './tooling-test-runner.ts';

/** The outside supervisor remains alive to stop the whole slice after a file abort. */
export async function runScopedTooling(files:string[],options:{idleMs?:number;execArgv?:string[];selectorSelfTest?:'only';fixture?:boolean;memoryMax?:number;output?:NodeJS.WritableStream;onScope?:(slice:string,unit:string,stopped:()=>string|undefined)=>void|Promise<void>}={}):Promise<ToolingResult&{slice:string}> {
  if(options.memoryMax!==undefined&&(!Number.isSafeInteger(options.memoryMax)||options.memoryMax<1))
    throw new ToolingInstrumentError('tooling-setup','tooling file memory bound must be a positive byte count');
  const boundary=supervisorWorkerBoundary();
  const before=boundary?memoryEvents(boundary.group,true).oom:0;
  const parent=boundary?{...process.env,NTS_TOOLING_SLICE:boundary.slice}:process.env;
  const slice=newToolingSlice(options.fixture,parent),unit=checkedUnitName(`${slice.slice(0,-6)}-f.scope`).slice(0,-6);
  const owner=requireOwnUnit();
  const temporary=process.env.TMPDIR??join(homedir(),".cache/nts-tooling");mkdirSync(temporary,{recursive:true});
  const directory=mkdtempSync(join(temporary,"tooling-report-")),complete=join(directory,"complete.json"),nonce=randomUUID();
  const singleProcess=files.length===1&&!options.selectorSelfTest;
  const request=readToolingRequest({files:files.map(file=>resolve(file)),idleMs:options.idleMs,execArgv:options.execArgv,selectorSelfTest:options.selectorSelfTest,complete,nonce,
    ...(singleProcess?{singleProcess:true}:{})});
  // A by-hand run is its launcher's rank (NTS_MEMORY_PRIORITY); inside a run it is nested and shares that run's.
  const rank=priorityOf(process.env);
  const command=gateCommand(process.execPath,[...(singleProcess?options.execArgv??[]:[]),fileURLToPath(new URL('./tooling-test-worker.ts',import.meta.url)),JSON.stringify(request)],{rank,env:{NTS_TOOLING_SLICE:slice}});
  const env:NodeJS.ProcessEnv={...process.env};
  assignOwnedValues(env,{NTS_TOOLING_SLICE:slice});
  for(const key of ["NODE_TEST_CONTEXT","NODE_CHANNEL_FD","NODE_CHANNEL_SERIALIZATION_MODE"])delete env[key];
  let acquired=false,closed:Promise<number>|undefined,unregister:(()=>void)|undefined,failed=false,primary:unknown,entry:ToolingEntrySupervisor|undefined;
  const clock=hostObservations().now,started=clock();
  try {
  startBoundSlice(slice,owner,{rank,...(options.memoryMax===undefined?{}:{max:options.memoryMax})});acquired=true;
  const limits=options.memoryMax===undefined?[]:[`--property=MemoryMax=${options.memoryMax}`,'--property=MemorySwapMax=0'];
  const child=spawn("systemd-run",["--user","--scope","--collect","--quiet",`--unit=${unit}`,`--slice=${slice}`,"--property=OOMPolicy=kill",...limits,command.command,...command.args],{
    env,stdio:["ignore","pipe","pipe",singleProcess?'pipe':'ignore'],
  });
  const output=options.output??process.stdout;
  child.stdout!.pipe(output,{end:false});child.stderr!.pipe(output,{end:false});
  process.stderr.write(`tooling scope: ${unit}.scope in ${slice}\n`);
  const stop=()=>stopToolingSlice(slice);
  if(singleProcess){
    entry=new ToolingEntrySupervisor(child,resolve(files[0]!),nonce,options.idleMs??TOOLING_IDLE_GUARD_MS,stop);
    child.stdout!.on('data',entry.touch);child.stderr!.on('data',entry.touch);
  }
  let ended:string|undefined;
  closed=new Promise<number>((resolve,reject)=>{
    child.once("error",error=>{ended=String(error);reject(error);});
    child.once("close",code=>{ended=`tooling file scope closed with status ${code}`;resolve(code??2);});
  });
  // Cancellation stops the owned hierarchy. Its report namespace stays owned
  // until the launcher and all output streams have actually closed.
  unregister=registerCommandCloser(`tooling workers ${slice}`,{cancel:stop,close:stop,closed:async()=>{await closed;}});
    const [status]=await Promise.all([closed,options.onScope?.(slice,`${unit}.scope`,()=>ended)]);
    entry?.finish();
    const partial=(status:1|2):ToolingResult&{slice:string}=>({status,completedFailures:entry!.evidence.completedFailures,slice,
      times:{version:1,wallMs:clock()-started,concurrency:1,files:[{file:resolve(files[0]!),startedMs:0,wallMs:clock()-started,passed:false}]}});
    if(entry?.hung){
      publishHung(entry.hung,process.env,entry.evidence.completedFailures);process.stderr.write(entry.hung+'\n');
      return partial(entry.evidence.completedFailures?1:2);
    }
    if(entry?.error){
      if(!entry.evidence.completedFailures)throw entry.error;
      return {...partial(1),observationFailure:{kind:entry.error.kind,reason:entry.error.message}};
    }
    let report;
    try { report=JSON.parse(readFileSync(complete,"utf8")); }
    catch(error) {
      if(boundary&&memoryEvents(boundary.group,true).oom>before)
        throw new PressureError(`tooling workers exceeded their step's memory bound (${boundary.slice}); their supervisor survived outside it`);
      if(entry?.evidence.ready){
        process.stderr.write(`tooling file FAIL: ${files[0]}; process terminated mid-file (status ${status}); ${entry.evidence.completedTests} completed assertion(s), ${entry.evidence.completedFailures} failure(s) retained\n`);
        return {...partial(1),completedFailures:Math.max(1,entry.evidence.completedFailures)};
      }
      throw new ToolingInstrumentError("tooling-setup",`tooling worker ended without a completed report (status ${status}, ${slice})`,{cause:error});
    }
    const result=readToolingCompletion(report,nonce,status);
    if(entry&&(!entry.evidence.ready||result.completedFailures!==entry.evidence.completedFailures))
      throw new ToolingInstrumentError('tooling-setup','tooling completion disagrees with its authenticated child channel');
    if(status===0)rmSync(directory,{recursive:true,force:true});
    return {...result,slice};
  } catch(error){failed=true;primary=error;throw error;}
  finally {
    const errors:unknown[]=[];
    try{entry?.finish();}catch(error){errors.push(error);}
    try{if(acquired)stopToolingSlice(slice);}catch(error){errors.push(error);}
    try{if(closed)await closed;}catch(error){errors.push(error);}
    try{unregister?.();}catch(error){errors.push(error);}
    if(errors.length)throw new ToolingInstrumentError('tooling-cleanup','tooling slice cleanup failed: '+[...(failed?[primary]:[]),...errors].map(String).join('; '),{cause:new AggregateError([...(failed?[primary]:[]),...errors])});
  }
}
/** The run's file times, after its tests' own report: a command line's run, never a fixture's. */
function reportTimes(result:ToolingResult,root:string):number {
  if(result.times)for(const line of toolingTimesReport(result.times,root))process.stdout.write(line+"\n");
  return result.status;
}

/** A broker-backed command is already the outside supervisor. Keep the
 * common pool directly on the step's dynamic worker boundary; wrapping the
 * whole suite in a file scope would introduce a static aggregate ceiling. */
async function runToolingEntries(files:string[],selectorSelfTest=false):Promise<ToolingResult>{
  if(!process.env.NTS_GATE_TOKENS||process.env.NTS_GATE_TOKEN_HELD){
    if(!selectorSelfTest)return runScopedTooling(files);
    const clock=hostObservations().now,started=clock(),replies:ToolingEntryReply[]=[],names=['@tooling-tests',TOOLING_SELF_TEST_FILE];
    let failure:unknown;
    for(const [index,path] of names.entries())try{
      const result=await runScopedTooling(index===0?files:[path],index===0?{}:{selectorSelfTest:'only'});
      replies.push({path,bucket:'tooling',result});
    }catch(error){replies.push({path,bucket:'infrastructure-error',why:String(error)});failure??=error;}
    return toolingFileResults(names,replies,{version:1,wallMs:clock()-started,concurrency:1,files:replies.flatMap(row=>row.result?.times?.files??[])},{},failure);
  }
  const {runToolingFiles}=await import('./tooling-file-admission.ts');
  const temporary=process.env.TMPDIR??join(homedir(),'.cache/nts-tooling');mkdirSync(temporary,{recursive:true});
  const directory=mkdtempSync(join(temporary,'tooling-files-'));
  const request=readToolingRequest({files,selectorSelfTest:selectorSelfTest?'include':undefined,complete:join(directory,'complete.json'),nonce:randomUUID()});
  const resultEnv={NTS_GATE_STEP_RESULT:process.env.NTS_GATE_STEP_RESULT,NTS_GATE_STEP:process.env.NTS_GATE_STEP,NTS_GATE_STEP_ATTEMPT:process.env.NTS_GATE_STEP_ATTEMPT};
  assignOwnedValues(process.env,{NTS_GATE_STEP_RESULT:undefined,NTS_GATE_STEP_ATTEMPT:undefined});
  try{
    const result=await runToolingFiles(request,{resultEnv});
    if(result.status===0)rmSync(directory,{recursive:true,force:true});
    return result;
  }finally{assignOwnedValues(process.env,resultEnv);}
}
runAsCommand(import.meta.url,async()=>{
  try {
    const args=process.argv.slice(2);
    if(args[0]==="--worker") {
      if(args[1]===undefined)throw new ToolingInstrumentError("tooling-setup","missing tooling worker request");
      const {runToolingWorker}=await import('./tooling-test-worker.ts');
      await runToolingWorker(readToolingRequest(JSON.parse(args[1])));
    } else if(args[0]===TOOLING_COLLECTOR_COMMAND[1]) {
      if(args.length!==1)throw new ToolingInstrumentError("tooling-setup","the tooling collector takes no file arguments");
      const {discoverToolingTests}=await import("./tooling-discovery.ts");
      const root=resolve(fileURLToPath(new URL("../..",import.meta.url))),selection=discoverToolingTests(root);
      process.stdout.write(`tooling tests: ${selection.files.length} collected, ${selection.exclusions.length} explicitly assigned to another step, ${selection.inventoryCount} inventoried\n`);
      for(const row of selection.exclusions)process.stdout.write(`  ${row.path}: ${row.step} (${row.reason})\n`);
      process.exitCode=reportTimes(await runToolingEntries(selection.files.map(file=>resolve(root,file)),true),root);
    } else if(args[0]==='--step') {
      if(args.length!==2||!args[1])throw new ToolingInstrumentError('tooling-setup','the tooling step runner needs exactly one step name');
      const {toolingTestsForStep}=await import('./tooling-discovery.ts');
      const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),files=toolingTestsForStep(root,args[1]);
      process.stdout.write(`tooling tests for ${args[1]}: ${files.length} assigned by the exclusions table\n`);
      process.exitCode=reportTimes(await runToolingEntries(files.map(file=>resolve(root,file))),root);
    } else {
      if(!args.length)throw new ToolingInstrumentError("tooling-setup","tooling runner needs explicit test files");
      process.exitCode=reportTimes(await runToolingEntries(args),process.cwd());
    }
  } catch(error) {
    if(error instanceof PressureError){publishPressure(error);process.stderr.write(error.message+"\n");}
    else {
      const instrument=error instanceof ToolingInstrumentError?error:new ToolingInstrumentError("tooling-setup",String(error),{cause:error});
      publishToolingFailure(instrument);process.stderr.write((instrument.stack??String(instrument))+"\n");
    }
    process.exitCode=2;
  }
});
