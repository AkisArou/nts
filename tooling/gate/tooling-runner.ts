// Test events decide results. Silence can only fail to measure a file.
import {run} from "node:test";
import {spec} from "node:test/reporters";
import {finished} from "node:stream/promises";
import {resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {spawn} from "node:child_process";
import {mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,writeFileSync} from "node:fs";
import {availableParallelism,homedir} from "node:os";
import {join,relative} from "node:path";
import {randomUUID} from "node:crypto";
import {publishHung,publishPressure,publishToolingFailure,PressureError,ToolingInstrumentError} from "./step-result.ts";
import {checkedUnitName,newToolingSlice,stopToolingSlice,toolingSlice} from "./tooling-slice.ts";
import {gateCommand} from "./affinity.ts";
import {memoryEvents,supervisorWorkerBoundary} from "../census/worker-memory.ts";

/** Shell entry and reporter fixtures share this exact collector command. */
export const TOOLING_COLLECTOR_COMMAND=Object.freeze(["tooling/gate/tooling-runner.ts","--collect"] as const);

export const TOOLING_IDLE_GUARD_MS=5*60_000;
/** Cancellation/abortion is unfinished work; only completed test or hook errors
 * supply definite failures, including reports delivered after a guard fires. */
export function completedTestFailure(data:{details:{passed?:boolean;error?:unknown};todo?:unknown;skip?:unknown}):boolean {
  const error=data.details.error;
  const failureType=typeof error==="object"&&error!==null&&"failureType" in error&&typeof error.failureType==="string"?error.failureType:"";
  return data.details.passed===false&&!data.todo&&!data.skip&&!["testAborted","cancelledByParent","subtestsFailed","testTimeoutFailure"].includes(failureType);
}
/** One test file of a run: when it started after the run began and how long it ran, null where it never did, and whether it passed. */
export type ToolingFileTime={file:string;startedMs:number|null;wallMs:number|null;passed:boolean|null};
/** A run's own times: its wall, how many files it runs at once, and each file's. */
export type ToolingTimes={version:1;wallMs:number;concurrency:number;files:ToolingFileTime[]};
export type ToolingResult={status:0|1|2;completedFailures:number;times?:ToolingTimes};
function readToolingTimes(value:unknown):ToolingTimes {
  const times=value as ToolingTimes,span=(n:unknown)=>n===null||typeof n==="number"&&Number.isFinite(n)&&n>=0;
  if(typeof value!=="object"||value===null||times.version!==1||typeof times.wallMs!=="number"||!span(times.wallMs)
      ||!Number.isSafeInteger(times.concurrency)||times.concurrency<1||!Array.isArray(times.files)
      ||times.files.some(row=>typeof row!=="object"||row===null||typeof row.file!=="string"||!span(row.startedMs)||!span(row.wallMs)||!(row.passed===null||typeof row.passed==="boolean")))
    throw new ToolingInstrumentError("tooling-setup","invalid tooling worker file times");
  return times;
}
/** A worker report is private to one invocation. Missing or malformed evidence
 * never becomes a successful run or an inferred failure count. */
export function readToolingCompletion(value:unknown,nonce:string,status:number):ToolingResult {
  if(typeof value!=="object"||value===null)throw new ToolingInstrumentError("tooling-setup","invalid tooling worker completion");
  const report=value as Record<string,unknown>;
  if(report.version!==2||report.nonce!==nonce||![0,1,2].includes(report.status as number)||report.status!==status
      ||typeof report.completedFailures!=="number"||!Number.isSafeInteger(report.completedFailures)||report.completedFailures<0
      ||(report.completedFailures>0&&status!==1))throw new ToolingInstrumentError("tooling-setup","tooling worker completion disagrees with its process status or completed-failure evidence");
  return {status:report.status as ToolingResult["status"],completedFailures:report.completedFailures,...(report.times===undefined?{}:{times:readToolingTimes(report.times)})};
}

/**
 * What a run's file times say: its wall beside its files' walls; its critical
 * path, the file that ended last; when its slots were last all busy, after
 * which the files still running set the wall alone; and every file by wall.
 */
export function toolingTimesReport(times:ToolingTimes,root?:string):string[] {
  const seconds=(ms:number)=>(ms/1000).toFixed(1)+" s",name=(file:string)=>root?relative(root,file):file;
  const done=times.files.filter((row):row is ToolingFileTime&{startedMs:number;wallMs:number}=>row.startedMs!==null&&row.wallMs!==null);
  const total=done.reduce((sum,row)=>sum+row.wallMs,0),end=(row:{startedMs:number;wallMs:number})=>row.startedMs+row.wallMs;
  const lines=[`tooling files: ${times.files.length} in ${seconds(times.wallMs)}; their walls sum to ${seconds(total)}, ${(total/Math.max(times.wallMs,1)).toFixed(1)} running at once on average, of ${times.concurrency} at most`];
  const last=done.reduce<typeof done[number]|undefined>((late,row)=>!late||end(row)>end(late)?row:late,undefined);
  if(last)lines.push(`tooling critical path: ${name(last.file)}, from ${seconds(last.startedMs)} for ${seconds(last.wallMs)}`);
  let running=0,full:number|null=null;
  for(const [at,step] of done.flatMap(row=>[[row.startedMs,1],[end(row),-1]] as const).sort((a,b)=>a[0]-b[0]||a[1]-b[1])){running+=step;if(running>=times.concurrency)full=at;}
  lines.push(full===null?`tooling slots: never all ${times.concurrency} busy`
    :`tooling slots: all ${times.concurrency} last busy at ${seconds(full)}; ${done.filter(row=>end(row)>full!).length} file(s) ran on after it`);
  for(const row of [...done].sort((a,b)=>b.wallMs-a.wallMs))lines.push(`tooling file ${seconds(row.wallMs).padStart(9)} from ${seconds(row.startedMs).padStart(8)}  ${name(row.file)}${row.passed?"":" (failed)"}`);
  for(const row of times.files.filter(row=>row.startedMs===null||row.wallMs===null))lines.push(`tooling file  unfinished  ${name(row.file)}`);
  return lines;
}
type ToolingRequest={files:string[];idleMs?:number;execArgv?:string[];complete:string;nonce:string};
export function readToolingRequest(value:unknown):ToolingRequest {
  if(typeof value!=="object"||value===null)throw new ToolingInstrumentError("tooling-setup","invalid tooling worker request");
  const row=value as Record<string,unknown>;
  const strings=(list:unknown):list is string[]=>Array.isArray(list)&&list.every(item=>typeof item==="string"&&item.length>0);
  if(!strings(row.files)||!row.files.length||typeof row.complete!=="string"||!row.complete||typeof row.nonce!=="string"||!row.nonce
      ||(row.execArgv!==undefined&&!strings(row.execArgv))
      ||(row.idleMs!==undefined&&(typeof row.idleMs!=="number"||!Number.isSafeInteger(row.idleMs)||row.idleMs<=0)))
    throw new ToolingInstrumentError("tooling-setup","invalid tooling worker request fields");
  return {files:row.files,complete:row.complete,nonce:row.nonce,...(row.idleMs===undefined?{}:{idleMs:row.idleMs as number}),...(row.execArgv===undefined?{}:{execArgv:row.execArgv as string[]})};
}

type TestActivity={entryFile?:string;file?:string;name?:string;testId?:number;parentId?:number};
/** Node test IDs are local to an entry's worker. entryFile namespaces them;
 * source file locations alone never assign an imported helper's ownership. */
export class ToolingTestOwners {
  private readonly roots:Set<string>;
  private readonly tests=new Map<string,Set<number>>();
  constructor(files:Iterable<string>){this.roots=new Set([...files].map(file=>resolve(file)));}
  file(data:TestActivity):string|undefined {
    if(data.entryFile!==undefined){
      const entry=resolve(data.entryFile);
      if(!this.roots.has(entry))throw new ToolingInstrumentError("tooling-setup",`test event names an unowned entry: ${entry}`);
      if(data.testId!==undefined){
        if(!Number.isSafeInteger(data.testId)||data.testId<=0||!Number.isSafeInteger(data.parentId)||typeof data.parentId!=="number"||data.parentId<0)
          throw new ToolingInstrumentError("tooling-setup","invalid test ownership identity");
        const known=this.tests.get(entry)??new Set<number>();
        if(data.parentId!==0&&!known.has(data.parentId))throw new ToolingInstrumentError("tooling-setup",`test parent is missing in ${entry}`);
        known.add(data.testId);this.tests.set(entry,known);
      }
      return entry;
    }
    // The outer file wrapper and file-level stdout/stderr precede worker IDs.
    if(data.file&&this.roots.has(resolve(data.file)))return resolve(data.file);
    if(data.name&&this.roots.has(resolve(data.name)))return resolve(data.name);
    return undefined;
  }
}

type ToolingInstrument={
  scheduleIdle:(callback:()=>void,milliseconds:number,file:string)=>()=>void;
  event?:(name:string,data:TestActivity)=>void;
  now:()=>number;
};
export async function runTooling(files:string[],options:{idleMs?:number;execArgv?:string[];output?:NodeJS.WritableStream;resultEnv?:NodeJS.ProcessEnv;instrument?:ToolingInstrument}={}):Promise<ToolingResult> {
  const names=new Set(files.map(file=>resolve(file))),controller=new AbortController();
  const active=new Map<string,()=>void>(),owners=new ToolingTestOwners(names);
  const instrument:ToolingInstrument=options.instrument===undefined?{
    now:()=>performance.now(),scheduleIdle:(callback,milliseconds)=>{const timer=setTimeout(callback,milliseconds);return()=>clearTimeout(timer);},
  }:options.instrument;
  if(!instrument||typeof instrument.now!=='function'||typeof instrument.scheduleIdle!=='function')throw new ToolingInstrumentError('tooling-setup','tooling observation capability is incomplete');
  const schedule=instrument.scheduleIdle;
  let hung:string|undefined,hungFile:string|undefined,success=true,priorFailures=0;
  // Each file's tests that have started and not completed: what a hang names,
  // since a hung test prints nothing of its own.
  const open=new Map<string,Map<number|string,string>>();
  const hangReason=()=>{
    const tests=[...(hungFile?open.get(hungFile)?.values()??[]:[])];
    return `tooling file NOT RUN (hung): ${hungFile}; no test activity for ${options.idleMs??TOOLING_IDLE_GUARD_MS} ms${tests.length?` in ${tests.map(name=>JSON.stringify(name)).join(", ")}`:""}; ${priorFailures} prior assertion failure(s) retained in the transcript`;
  };
  const touch=(file:string)=>{
    active.get(file)?.();
    active.set(file,schedule(()=>{
      if(hung)return;
      hungFile=file;hung=hangReason();
      publishHung(hung,options.resultEnv,priorFailures);process.stderr.write(hung+"\n");controller.abort(new Error(hung));
    },options.idleMs??TOOLING_IDLE_GUARD_MS,file));
  };
  const fileOf=(data:TestActivity)=>owners.file(data);
  // Each file's own wrapper test marks its process's start and end.
  const clock=instrument.now,begun=clock();
  const times=new Map<string,ToolingFileTime>([...names].map(file=>[file,{file,startedMs:null,wallMs:null,passed:null}]));
  const stream=run({files:[...names],execArgv:options.execArgv,concurrency:true,signal:controller.signal,setup:events=>{
    events.on("test:enqueue",data=>{fileOf(data);});
    events.on("test:dequeue",data=>{
      const file=fileOf(data);if(!file)return;
      touch(file);
      if(data.name&&resolve(data.name)===file)times.get(file)!.startedMs=clock()-begun;
      else if(data.name)open.set(file,(open.get(file)??new Map()).set(data.testId??data.name,data.name));
    });
    for(const event of ["test:stdout","test:stderr","test:start","test:pass","test:fail","test:diagnostic"] as const){
      events.on(event,(data:any)=>{const file=fileOf(data);if(file&&active.has(file))touch(file);});
    }
    events.on("test:complete",data=>{
      // A helper-defined subtest reports its definition's source location, not
      // its owning entry file. All events here belong to this owned stream.
      if(completedTestFailure(data))priorFailures++;
      const file=fileOf(data);if(!file)return;
      open.get(file)?.delete(data.testId??data.name!);
      if(resolve(data.name)===file){
        active.get(file)?.();active.delete(file);
        const row=times.get(file)!;if(row.startedMs!==null){row.wallMs=clock()-begun-row.startedMs;row.passed=data.details.passed!==false;}
      }
      else if(active.has(file))touch(file);
    });
    events.on("test:summary",data=>{if(!data.success)success=false;});
    if(instrument.event)for(const event of ["test:enqueue","test:dequeue","test:start","test:complete","test:pass","test:fail"] as const)
      events.on(event,data=>instrument.event!(event,data));
  }});
  const report=stream.compose(spec);
  report.pipe(options.output??process.stdout,{end:false});
  try{await finished(report);}catch(error){if(!hung)throw error;}
  finally{for(const cancel of active.values())cancel();}
  // node:test runs this many files at once when concurrency is true.
  const measured:ToolingTimes={version:1,wallMs:clock()-begun,concurrency:Math.max(availableParallelism()-1,1),files:[...times.values()]};
  if(hung){
    // Draining can deliver a completed failure after the guard's observation.
    // Publish the final evidence only after those events have been consumed.
    publishHung(hangReason(),options.resultEnv,priorFailures);
    return {status:priorFailures>0?1:2,completedFailures:priorFailures,times:measured};
  }
  return {status:success?0:1,completedFailures:priorFailures,times:measured};
}

/** The outside supervisor remains alive to stop the whole slice after a file abort. */
export async function runScopedTooling(files:string[],options:{idleMs?:number;execArgv?:string[];fixture?:boolean;output?:NodeJS.WritableStream;onScope?:(slice:string,unit:string,stopped:()=>string|undefined)=>void|Promise<void>}={}):Promise<ToolingResult&{slice:string}> {
  const boundary=supervisorWorkerBoundary();
  const before=boundary?memoryEvents(boundary.group,true).oom:0;
  const parent=boundary?{...process.env,NTS_TOOLING_SLICE:boundary.slice}:process.env;
  const slice=newToolingSlice(options.fixture,parent),unit=checkedUnitName(`${slice.slice(0,-6)}-f.scope`).slice(0,-6);
  const temporary=process.env.TMPDIR??join(homedir(),".cache/nts-tooling");mkdirSync(temporary,{recursive:true});
  const directory=mkdtempSync(join(temporary,"tooling-report-")),complete=join(directory,"complete.json"),nonce=randomUUID();
  const request=readToolingRequest({files,idleMs:options.idleMs,execArgv:options.execArgv,complete,nonce});
  const command=gateCommand(process.execPath,[fileURLToPath(import.meta.url),"--worker",JSON.stringify(request)]);
  const env:NodeJS.ProcessEnv={...process.env,NTS_TOOLING_SLICE:slice};
  for(const key of ["NODE_TEST_CONTEXT","NODE_CHANNEL_FD","NODE_CHANNEL_SERIALIZATION_MODE"])delete env[key];
  const child=spawn("systemd-run",["--user","--scope","--collect","--quiet",`--unit=${unit}`,`--slice=${slice}`,"--property=OOMPolicy=kill",command.command,...command.args],{
    env,stdio:["ignore","pipe","pipe"],
  });
  const output=options.output??process.stdout;
  child.stdout.pipe(output,{end:false});child.stderr.pipe(output,{end:false});
  process.stderr.write(`tooling scope: ${unit}.scope in ${slice}\n`);
  const stop=()=>stopToolingSlice(slice);
  const terminate=()=>{try{stop();}finally{process.exitCode=2;}};
  process.once("SIGTERM",terminate);process.once("SIGINT",terminate);
  let ended:string|undefined;
  try {
    const closed=new Promise<number>((resolve,reject)=>{
      child.once("error",error=>{ended=String(error);reject(error);});
      child.once("close",code=>{ended=`tooling file scope closed with status ${code}`;resolve(code??2);});
    });
    const [status]=await Promise.all([closed,options.onScope?.(slice,`${unit}.scope`,()=>ended)]);
    let report;
    try { report=JSON.parse(readFileSync(complete,"utf8")); }
    catch(error) {
      if(boundary&&memoryEvents(boundary.group,true).oom>before)
        throw new PressureError(`tooling workers exceeded their step's memory bound (${boundary.slice}); their supervisor survived outside it`);
      throw new ToolingInstrumentError("tooling-setup",`tooling worker ended without a completed report (status ${status}, ${slice})`,{cause:error});
    }
    const result=readToolingCompletion(report,nonce,status);
    if(status===0)rmSync(directory,{recursive:true,force:true});
    return {...result,slice};
  } finally {
    process.off("SIGTERM",terminate);process.off("SIGINT",terminate);stop();
  }
}
/** The run's file times, after its tests' own report: a command line's run, never a fixture's. */
function reportTimes(result:ToolingResult,root:string):number {
  if(result.times)for(const line of toolingTimesReport(result.times,root))process.stdout.write(line+"\n");
  return result.status;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try {
    const args=process.argv.slice(2);
    if(args[0]==="--worker") {
      if(args[1]===undefined)throw new ToolingInstrumentError("tooling-setup","missing tooling worker request");
      const request=readToolingRequest(JSON.parse(args[1])),slice=toolingSlice();
      if(!slice||!readFileSync("/proc/self/cgroup","utf8").includes(`/${slice}/${slice.slice(0,-6)}-f.scope`))throw new ToolingInstrumentError("tooling-setup","tooling worker is outside its owned slice/scope");
      // Only the supervising worker owns the public step-result capability.
      // Expected negative controls in test children must never overwrite it.
      const resultEnv={NTS_GATE_STEP_RESULT:process.env.NTS_GATE_STEP_RESULT,NTS_GATE_STEP:process.env.NTS_GATE_STEP,NTS_GATE_STEP_ATTEMPT:process.env.NTS_GATE_STEP_ATTEMPT};
      delete process.env.NTS_GATE_STEP_RESULT;delete process.env.NTS_GATE_STEP_ATTEMPT;
      const result=await runTooling(request.files,{idleMs:request.idleMs,execArgv:request.execArgv,resultEnv});
      const pending=`${request.complete}.${process.pid}`;writeFileSync(pending,JSON.stringify({version:2,nonce:request.nonce,...result})+"\n");renameSync(pending,request.complete);
      process.exitCode=result.status;
    } else if(args[0]===TOOLING_COLLECTOR_COMMAND[1]) {
      if(args.length!==1)throw new ToolingInstrumentError("tooling-setup","the tooling collector takes no file arguments");
      const {discoverToolingTests}=await import("./tooling-discovery.ts");
      const root=resolve(fileURLToPath(new URL("../..",import.meta.url))),selection=discoverToolingTests(root);
      process.stdout.write(`tooling tests: ${selection.files.length} collected, ${selection.exclusions.length} explicitly assigned to another step, ${selection.inventoryCount} inventoried\n`);
      for(const row of selection.exclusions)process.stdout.write(`  ${row.path}: ${row.step} (${row.reason})\n`);
      process.exitCode=reportTimes(await runScopedTooling(selection.files.map(file=>resolve(root,file))),root);
    } else {
      if(!args.length)throw new ToolingInstrumentError("tooling-setup","tooling runner needs explicit test files");
      process.exitCode=reportTimes(await runScopedTooling(args),process.cwd());
    }
  } catch(error) {
    if(error instanceof PressureError){publishPressure(error);process.stderr.write(error.message+"\n");}
    else {
      const instrument=error instanceof ToolingInstrumentError?error:new ToolingInstrumentError("tooling-setup",String(error),{cause:error});
      publishToolingFailure(instrument);process.stderr.write((instrument.stack??String(instrument))+"\n");
    }
    process.exitCode=2;
  }
}
