// Test events decide results. Silence can only fail to measure a file.
import {run} from "node:test";
import {spec} from "node:test/reporters";
import {finished} from "node:stream/promises";
import {resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {spawn} from "node:child_process";
import {mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {publishHung,publishToolingFailure,ToolingInstrumentError} from "./step-result.ts";
import {newToolingSlice,stopToolingSlice,toolingSlice} from "./tooling-slice.ts";
import {gateCommand} from "./affinity.ts";

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
export type ToolingResult={status:0|1|2;completedFailures:number};
/** A worker report is private to one invocation. Missing or malformed evidence
 * never becomes a successful run or an inferred failure count. */
export function readToolingCompletion(value:unknown,nonce:string,status:number):ToolingResult {
  if(typeof value!=="object"||value===null)throw new ToolingInstrumentError("tooling-setup","invalid tooling worker completion");
  const report=value as Record<string,unknown>;
  if(report.version!==2||report.nonce!==nonce||![0,1,2].includes(report.status as number)||report.status!==status
      ||typeof report.completedFailures!=="number"||!Number.isSafeInteger(report.completedFailures)||report.completedFailures<0
      ||(report.completedFailures>0&&status!==1))throw new ToolingInstrumentError("tooling-setup","tooling worker completion disagrees with its process status or completed-failure evidence");
  return {status:report.status as ToolingResult["status"],completedFailures:report.completedFailures};
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
  scheduleIdle?:(callback:()=>void,milliseconds:number,file:string)=>()=>void;
  event?:(name:string,data:TestActivity)=>void;
};
export async function runTooling(files:string[],options:{idleMs?:number;execArgv?:string[];output?:NodeJS.WritableStream;resultEnv?:NodeJS.ProcessEnv;instrument?:ToolingInstrument}={}):Promise<ToolingResult> {
  const names=new Set(files.map(file=>resolve(file))),controller=new AbortController();
  const active=new Map<string,()=>void>(),owners=new ToolingTestOwners(names);
  const schedule=options.instrument?.scheduleIdle??((callback:()=>void,milliseconds:number)=>{const timer=setTimeout(callback,milliseconds);return()=>clearTimeout(timer);});
  let hung:string|undefined,hungFile:string|undefined,success=true,priorFailures=0;
  const hangReason=()=>`tooling file NOT RUN (hung): ${hungFile}; no test activity for ${options.idleMs??TOOLING_IDLE_GUARD_MS} ms; ${priorFailures} prior assertion failure(s) retained in the transcript`;
  const touch=(file:string)=>{
    active.get(file)?.();
    active.set(file,schedule(()=>{
      if(hung)return;
      hungFile=file;hung=hangReason();
      publishHung(hung,options.resultEnv,priorFailures);process.stderr.write(hung+"\n");controller.abort(new Error(hung));
    },options.idleMs??TOOLING_IDLE_GUARD_MS,file));
  };
  const fileOf=(data:TestActivity)=>owners.file(data);
  const stream=run({files:[...names],execArgv:options.execArgv,concurrency:true,signal:controller.signal,setup:events=>{
    events.on("test:enqueue",data=>{fileOf(data);});
    events.on("test:dequeue",data=>{const file=fileOf(data);if(file)touch(file);});
    for(const event of ["test:stdout","test:stderr","test:start","test:pass","test:fail","test:diagnostic"] as const){
      events.on(event,(data:any)=>{const file=fileOf(data);if(file&&active.has(file))touch(file);});
    }
    events.on("test:complete",data=>{
      // A helper-defined subtest reports its definition's source location, not
      // its owning entry file. All events here belong to this owned stream.
      if(completedTestFailure(data))priorFailures++;
      const file=fileOf(data);if(!file)return;
      if(resolve(data.name)===file){active.get(file)?.();active.delete(file);}
      else if(active.has(file))touch(file);
    });
    events.on("test:summary",data=>{if(!data.success)success=false;});
    if(options.instrument?.event)for(const event of ["test:enqueue","test:dequeue","test:start","test:complete","test:pass","test:fail"] as const)
      events.on(event,data=>options.instrument!.event!(event,data));
  }});
  const report=stream.compose(spec);
  report.pipe(options.output??process.stdout,{end:false});
  try{await finished(report);}catch(error){if(!hung)throw error;}
  finally{for(const cancel of active.values())cancel();}
  if(hung){
    // Draining can deliver a completed failure after the guard's observation.
    // Publish the final evidence only after those events have been consumed.
    publishHung(hangReason(),options.resultEnv,priorFailures);
    return {status:priorFailures>0?1:2,completedFailures:priorFailures};
  }
  return {status:success?0:1,completedFailures:priorFailures};
}

/** The outside supervisor remains alive to stop the whole slice after a file abort. */
export async function runScopedTooling(files:string[],options:{idleMs?:number;execArgv?:string[];fixture?:boolean;output?:NodeJS.WritableStream;onScope?:(slice:string,unit:string,stopped:()=>string|undefined)=>void|Promise<void>}={}):Promise<ToolingResult&{slice:string}> {
  const slice=newToolingSlice(options.fixture),unit=`${slice.slice(0,-6)}-files`;
  const temporary=process.env.TMPDIR??join(homedir(),".cache/nts-tooling");mkdirSync(temporary,{recursive:true});
  const directory=mkdtempSync(join(temporary,"tooling-report-")),complete=join(directory,"complete.json"),nonce=randomUUID();
  const request=readToolingRequest({files,idleMs:options.idleMs,execArgv:options.execArgv,complete,nonce});
  const command=gateCommand(process.execPath,[fileURLToPath(import.meta.url),"--worker",JSON.stringify(request)]);
  const env:NodeJS.ProcessEnv={...process.env,NTS_TOOLING_SLICE:slice};
  for(const key of ["NODE_TEST_CONTEXT","NODE_CHANNEL_FD","NODE_CHANNEL_SERIALIZATION_MODE"])delete env[key];
  const child=spawn("systemd-run",["--user","--scope","--collect","--quiet",`--unit=${unit}`,`--slice=${slice}`,command.command,...command.args],{
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
    catch(error) { throw new ToolingInstrumentError("tooling-setup",`tooling worker ended without a completed report (status ${status}, ${slice})`,{cause:error}); }
    const result=readToolingCompletion(report,nonce,status);
    if(status===0)rmSync(directory,{recursive:true,force:true});
    return {...result,slice};
  } finally {
    process.off("SIGTERM",terminate);process.off("SIGINT",terminate);stop();
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try {
    const args=process.argv.slice(2);
    if(args[0]==="--worker") {
      if(args[1]===undefined)throw new ToolingInstrumentError("tooling-setup","missing tooling worker request");
      const request=readToolingRequest(JSON.parse(args[1])),slice=toolingSlice();
      if(!slice||!readFileSync("/proc/self/cgroup","utf8").includes(`/${slice}/${slice.slice(0,-6)}-files.scope`))throw new ToolingInstrumentError("tooling-setup","tooling worker is outside its owned slice/scope");
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
      process.exitCode=(await runScopedTooling(selection.files.map(file=>resolve(root,file)))).status;
    } else {
      if(!args.length)throw new ToolingInstrumentError("tooling-setup","tooling runner needs explicit test files");
      process.exitCode=(await runScopedTooling(args)).status;
    }
  } catch(error) {
    const instrument=error instanceof ToolingInstrumentError?error:new ToolingInstrumentError("tooling-setup",String(error),{cause:error});
    publishToolingFailure(instrument);process.stderr.write((instrument.stack??String(instrument))+"\n");process.exitCode=2;
  }
}
