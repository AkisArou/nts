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

export const TOOLING_IDLE_GUARD_MS=5*60_000;
/** Cancellation/abortion is unfinished work; only completed test or hook errors
 * supply definite failures, including reports delivered after a guard fires. */
export function completedTestFailure(data:{details:{passed?:boolean;error?:{failureType?:string}};todo?:unknown;skip?:unknown}):boolean {
  return data.details.passed===false&&!data.todo&&!data.skip&&!["testAborted","cancelledByParent","subtestsFailed","testTimeoutFailure"].includes(data.details.error?.failureType??"");
}
export async function runTooling(files:string[],options:{idleMs?:number;output?:NodeJS.WritableStream;resultEnv?:NodeJS.ProcessEnv}={}):Promise<number> {
  const names=new Set(files.map(file=>resolve(file))),controller=new AbortController();
  const active=new Map<string,ReturnType<typeof setTimeout>>();
  let hung:string|undefined,hungFile:string|undefined,success=true,priorFailures=0;
  const hangReason=()=>`tooling file NOT RUN (hung): ${hungFile}; no test activity for ${options.idleMs??TOOLING_IDLE_GUARD_MS} ms; ${priorFailures} prior assertion failure(s) retained in the transcript`;
  const touch=(file:string)=>{
    clearTimeout(active.get(file));
    active.set(file,setTimeout(()=>{
      if(hung)return;
      hungFile=file;hung=hangReason();
      publishHung(hung,options.resultEnv,priorFailures);process.stderr.write(hung+"\n");controller.abort(new Error(hung));
    },options.idleMs??TOOLING_IDLE_GUARD_MS));
  };
  const fileOf=(data:{file?:string;name?:string})=>{
    if(data.file&&names.has(resolve(data.file)))return resolve(data.file);
    if(data.name&&names.has(resolve(data.name)))return resolve(data.name);
  };
  const stream=run({files:[...names],concurrency:true,signal:controller.signal,setup:events=>{
    events.on("test:dequeue",data=>{const file=fileOf(data);if(file)touch(file);});
    for(const event of ["test:stdout","test:stderr","test:start","test:pass","test:fail","test:diagnostic"] as const){
      events.on(event,(data:any)=>{const file=fileOf(data);if(file&&active.has(file))touch(file);});
    }
    events.on("test:complete",data=>{
      const file=fileOf(data);if(!file)return;
      if(completedTestFailure(data))priorFailures++;
      if(resolve(data.name)===file){clearTimeout(active.get(file));active.delete(file);}
      else if(active.has(file))touch(file);
    });
    events.on("test:summary",data=>{if(!data.success)success=false;});
  }});
  const report=stream.compose(spec);
  report.pipe(options.output??process.stdout,{end:false});
  try{await finished(report);}catch(error){if(!hung)throw error;}
  finally{for(const timer of active.values())clearTimeout(timer);}
  if(hung){
    // Draining can deliver a completed failure after the guard's observation.
    // Publish the final evidence only after those events have been consumed.
    publishHung(hangReason(),options.resultEnv,priorFailures);
    return priorFailures>0?1:2;
  }
  return success?0:1;
}

/** The outside supervisor remains alive to stop the whole slice after a file abort. */
export async function runScopedTooling(files:string[],options:{idleMs?:number;fixture?:boolean;output?:NodeJS.WritableStream;onScope?:(slice:string,unit:string,stopped:()=>string|undefined)=>void|Promise<void>}={}):Promise<{status:number;slice:string}> {
  const slice=newToolingSlice(options.fixture),unit=`${slice.slice(0,-6)}-files`;
  const temporary=process.env.TMPDIR??join(homedir(),".cache/nts-tooling");mkdirSync(temporary,{recursive:true});
  const directory=mkdtempSync(join(temporary,"tooling-report-")),complete=join(directory,"complete.json"),nonce=randomUUID();
  const command=gateCommand(process.execPath,[fileURLToPath(import.meta.url),"--worker",JSON.stringify({files,idleMs:options.idleMs,complete,nonce})]);
  const env={...process.env,NTS_TOOLING_SLICE:slice};
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
    if(report.version!==1||report.nonce!==nonce||![0,1,2].includes(report.status)||report.status!==status)throw new ToolingInstrumentError("tooling-setup",`tooling worker completion disagrees with its process status (${slice})`);
    if(status===0)rmSync(directory,{recursive:true,force:true});
    return {status,slice};
  } finally {
    process.off("SIGTERM",terminate);process.off("SIGINT",terminate);stop();
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try {
    const args=process.argv.slice(2);
    if(args[0]==="--worker") {
      const request=JSON.parse(args[1]),slice=toolingSlice();
      if(!slice||!readFileSync("/proc/self/cgroup","utf8").includes(`/${slice}/${slice.slice(0,-6)}-files.scope`))throw new ToolingInstrumentError("tooling-setup","tooling worker is outside its owned slice/scope");
      // Only the supervising worker owns the public step-result capability.
      // Expected negative controls in test children must never overwrite it.
      const resultEnv={NTS_GATE_STEP_RESULT:process.env.NTS_GATE_STEP_RESULT,NTS_GATE_STEP:process.env.NTS_GATE_STEP,NTS_GATE_STEP_ATTEMPT:process.env.NTS_GATE_STEP_ATTEMPT};
      delete process.env.NTS_GATE_STEP_RESULT;delete process.env.NTS_GATE_STEP_ATTEMPT;
      const status=await runTooling(request.files,{idleMs:request.idleMs,resultEnv});
      const pending=`${request.complete}.${process.pid}`;writeFileSync(pending,JSON.stringify({version:1,nonce:request.nonce,status})+"\n");renameSync(pending,request.complete);
      process.exitCode=status;
    } else {
      if(!args.length)throw new ToolingInstrumentError("tooling-setup","tooling runner needs explicit test files");
      process.exitCode=(await runScopedTooling(args)).status;
    }
  } catch(error) {
    const instrument=error instanceof ToolingInstrumentError?error:new ToolingInstrumentError("tooling-setup",String(error),{cause:error});
    publishToolingFailure(instrument);process.stderr.write((instrument.stack??String(instrument))+"\n");process.exitCode=2;
  }
}
