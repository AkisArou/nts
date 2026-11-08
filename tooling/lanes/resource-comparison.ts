// Typed resource observations published by record checks.
// Every invocation starts pending and completes after reconciliation.
import {createHash,randomUUID} from "node:crypto";
import {mkdirSync,renameSync,writeFileSync} from "node:fs";
import {join} from "node:path";

export type ResourceStop={path:string;kind:"timeout"|"memory-cap";phase:string};
export type ComparisonIdentity={suite:string;under:string;backend:string;record:string;selection:string;policy:string;compiler:string};
type Report={version:1;id:string;step:string;attempt:string;state:"running"|"complete";identity?:ComparisonIdentity;failures?:number;resources?:ResourceStop[]};
export const RECORD_COMPARISON_STEPS=["test262-cases","test262-builtins-cases","test262-rest-cases","test262-jvm","test262-llvm","typescript-c","typescript-llvm","typescript-jvm"];
export const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const directory=(result:string)=>`${result}.comparisons`;

export function resourceStop(path:string,row:{bucket?:string;why?:string}|undefined):ResourceStop|undefined {
  if(row?.bucket!=="timeout"&&row?.bucket!=="memory-cap")return;
  return {path,kind:row.bucket,phase:row.why??"run"};
}

/** Call before setup can exit, then complete only after all reconciliation. */
export function beginComparison(env:NodeJS.ProcessEnv=process.env):{complete:(identity:ComparisonIdentity,failures:number,resources:ResourceStop[])=>void} {
  const result=env.NTS_GATE_STEP_RESULT,step=env.NTS_GATE_STEP,attempt=env.NTS_GATE_STEP_ATTEMPT;
  if(!result||!step||!attempt)return {complete:()=>{}};
  const id=randomUUID(),dir=directory(result),path=join(dir,`${id}.json`);
  mkdirSync(dir,{recursive:true});
  const publish=(data:Report)=>{const temporary=`${path}.tmp`;writeFileSync(temporary,JSON.stringify(data)+"\n");renameSync(temporary,path);};
  const initial:Report={version:1,id,step,attempt,state:"running"};publish(initial);
  return {complete:(identity,failures,resources)=>publish({...initial,state:"complete",identity,failures,resources})};
}
