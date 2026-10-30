import {spawnCounted} from "../gate/cputime.mjs";
import {COMPILE_WORK_PROFILE} from "../gate/compile-counter.ts";
import {activeCommand,CommandNotMeasuredError} from "../gate/active-command.ts";
import {ToolingInstrumentError} from "../gate/step-result.ts";
import {checkFailurePolicy,reportCheckFailure} from "../differential/check-report.ts";
import type {ChildProcessWithoutNullStreams} from "node:child_process";

export type ListingResult={stdout:string;stderr:string;status?:number|null;signal?:string|null;
  error?:unknown;hung?:string;runaway?:string;counter_error?:string|null;[key:string]:unknown};
type ListingOptions=Parameters<typeof activeCommand>[2]&{counterFile?:string};

/** Counter ownership stays with spawnCounted; ordinary listings share the
 * renewable activity/CPU supervisor. Only the final integrity owner publishes. */
export async function runIntegrityListing(command:string,args:readonly string[],options:ListingOptions):Promise<ListingResult>{
  const {counterFile,...supervision}=options;
  const env={...options.env};delete env.NTS_GATE_STEP_RESULT;
  if(!counterFile)return activeCommand(command,args,{...supervision,env});
  const counted=spawnCounted(command,args,{cwd:options.cwd,env,counterFile,cpu:undefined});
  const child=counted.child as ChildProcessWithoutNullStreams;
  return new Promise(resolve=>{
    let stdout="",stderr="";
    child.stdout.on("data",(chunk:Buffer|string)=>{stdout+=chunk;});
    child.stderr.on("data",(chunk:Buffer|string)=>{stderr+=chunk;});
    child.on("error",error=>{resolve({error,stdout,stderr});});
    child.on("close",(status,signal)=>{
      counted.measurement.then(counters=>resolve({...counters,work_profile:COMPILE_WORK_PROFILE,status,signal,stdout,stderr}));
    });
  });
}

/** Completion precedes parsing, even when a stopped process printed a listing. */
export function integrityListingFailure(result:ListingResult,label:string,expectedTypecheckFailure=false):unknown{
  if(result.hung||result.runaway)return new CommandNotMeasuredError(result as ConstructorParameters<typeof CommandNotMeasuredError>[0]);
  if(result.error)return result.error;
  if(result.signal||result.counter_error||result.status===null||result.status===undefined||(!expectedTypecheckFailure&&result.status!==0)){
    return new ToolingInstrumentError("tooling-setup",`${label}: ${result.counter_error??result.signal??`exit ${result.status??"unknown"}`}`);
  }
  return undefined;
}

/** A valid completed violation outranks liveness, using the shared authority. */
export function finishIntegrity(incomplete:readonly unknown[],completedFailures:number,env=process.env):number{
  if(!incomplete.length)return completedFailures?1:0;
  const chosen=incomplete.find(error=>!(error instanceof CommandNotMeasuredError)&&checkFailurePolicy(error,completedFailures).disposition==="operator-hold")
    ??incomplete.find(error=>checkFailurePolicy(error,completedFailures).disposition!=="verdict")??incomplete[0];
  return reportCheckFailure(chosen,env,completedFailures);
}
