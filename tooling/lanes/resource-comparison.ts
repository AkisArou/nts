// Typed evidence for record regressions caused only by a case's resource bound.
// Display text is never an attribution input. Every invocation starts pending.
import {createHash,randomUUID} from "node:crypto";
import {existsSync,mkdirSync,readdirSync,readFileSync,renameSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {programHost} from "../gate/canonical-environment.ts";

export type ResourceStop={path:string;kind:"timeout"|"memory-cap";phase:string};
export type ComparisonIdentity={suite:string;under:string;backend:string;record:string;selection:string;policy:string;compiler:string};
type Report={version:1;id:string;step:string;attempt:string;state:"running"|"complete";identity?:ComparisonIdentity;failures?:number;resources?:ResourceStop[]};
export type ComparisonEvidence={reports:Report[];resourceOnly:boolean};
export const RECORD_COMPARISON_STEPS=["test262-cases","test262-builtins-cases","test262-rest-cases","test262-jvm","test262-llvm","typescript-cases"];
export const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const directory=(result:string)=>`${result}.comparisons`;
const hash=(value:unknown)=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const nonempty=(value:unknown)=>typeof value==="string"&&value.length>0;

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

/** Absence uses the legacy path; a present incomplete/invalid report holds. */
export function readComparisons(result:string,step:string,attempt:string):ComparisonEvidence|undefined {
  const dir=directory(result);
  if(!existsSync(dir))return;
  const names=readdirSync(dir);
  if(!names.length||names.some(name=>!name.endsWith(".json")))throw new Error(`${step}: incomplete comparison publication`);
  const reports=names.sort().map(name=>{
    const row=JSON.parse(readFileSync(join(dir,name),"utf8")) as Report;
    const identity=row.identity;
    if(row.version!==1||!nonempty(row.id)||name!==`${row.id}.json`||row.step!==step||row.attempt!==attempt||row.state!=="complete"
        ||!identity||![identity.suite,identity.under,identity.backend].every(nonempty)
        ||![identity.record,identity.selection,identity.policy,identity.compiler].every(hash)
        ||!Number.isSafeInteger(row.failures)||row.failures!<0||!Array.isArray(row.resources)||row.resources.length>row.failures!
        ||row.resources.some(stop=>!nonempty(stop.path)||!["timeout","memory-cap"].includes(stop.kind)||!nonempty(stop.phase))
        ||new Set(row.resources.map(stop=>stop.path)).size!==row.resources.length)throw new Error(`${step}: invalid or unfinished comparison report ${name}`);
    return row;
  });
  const keys=reports.map(report=>scope(report.identity!));
  if(new Set(keys).size!==keys.length)throw new Error(`${step}: duplicate comparison scope`);
  const failures=reports.reduce((sum,row)=>sum+row.failures!,0),resources=reports.reduce((sum,row)=>sum+row.resources!.length,0);
  return {reports,resourceOnly:failures>0&&failures===resources};
}

const scope=(identity:ComparisonIdentity)=>JSON.stringify([identity.suite,identity.under,identity.backend,identity.record,identity.selection,identity.policy]);
export function sameComparisonConditions(a:ComparisonEvidence,b:ComparisonEvidence):boolean {
  const key=(row:Report)=>JSON.stringify([row.identity!.suite,row.identity!.under,row.identity!.backend]);
  const left=new Map(a.reports.map(row=>[key(row),row])),right=new Map(b.reports.map(row=>[key(row),row]));
  for(const name of new Set([...left.keys(),...right.keys()])) {
    const x=left.get(name),y=right.get(name);
    // A C step stops at its first failing directory. A passing suffix on
    // the other arm is harmless; an unpaired failure cannot attribute.
    if(!x||!y){if((x??y)!.failures!==0)return false;continue;}
    if(scope(x.identity!)!==scope(y.identity!))return false;
  }
  return true;
}

export type GateComparisons={host:string;requested:string[];steps:Record<string,{pass:boolean;evidence?:ComparisonEvidence}>};
export function comparisonHost(environment:any,run:string):string {
  const ambient={...environment.ambient};
  if(ambient.TMPDIR===join(run,"tmp"))ambient.TMPDIR="<owned-run>/tmp";
  return JSON.stringify([programHost(environment.host),ambient]);
}
export function gateComparisons(run:string,summary:any):GateComparisons {
  if(summary.environment?.canonical!==true||!Array.isArray(summary.requested)||!Array.isArray(summary.steps))throw new Error("comparison gate lacks a canonical complete summary");
  const steps:GateComparisons["steps"]={};
  for(const name of summary.requested) {
    const rows=summary.steps.filter((row:{name:string})=>row.name===name);
    if(rows.length!==1)throw new Error(`${name}: missing or duplicate gate result`);
    const row=rows[0],source=row.evidence_run??run;
    const evidence=readComparisons(join(source,`${name}.instrument.json`),name,source);
    if(!evidence&&RECORD_COMPARISON_STEPS.includes(name))throw new Error(`${name}: missing comparison report`);
    if(evidence&&evidence.reports.some(report=>report.identity!.compiler!==summary.identities?.nts?.sha256))throw new Error(`${name}: comparison names another compiler`);
    if(row.verdict==="PASS"&&evidence?.reports.some(report=>report.failures!==0))throw new Error(`${name}: passing step contradicts its comparison failures`);
    steps[name]={pass:row.verdict==="PASS",evidence};
  }
  return {host:comparisonHost(summary.environment,run),requested:summary.requested,steps};
}

export function resourceOnly(conditions:GateComparisons,failed:string[]):boolean {
  return failed.length>0&&failed.every(step=>conditions.steps[step]?.evidence?.resourceOnly===true);
}
export function pairedResources(candidate:GateComparisons,main:GateComparisons,steps:string[]):{mainRed:string[];candidateRed:string[];unreproduced:string[]} {
  const exact=(value:GateComparisons)=>value.requested.length===steps.length&&new Set(value.requested).size===steps.length&&steps.every(step=>value.requested.includes(step));
  if(candidate.host!==main.host||!exact(candidate)||!exact(main))throw new Error("resource recheck changed canonical host or requested step scope");
  const mainRed:string[]=[],candidateRed:string[]=[],unreproduced:string[]=[];
  for(const step of steps) {
    const a=candidate.steps[step],b=main.steps[step];
    if(!a?.evidence||!b?.evidence||!sameComparisonConditions(a.evidence,b.evidence))throw new Error(`${step}: resource recheck lacks matching complete record, population and budget evidence`);
    if(!b.pass)mainRed.push(step);
    else if(!a.pass)candidateRed.push(step);
    else unreproduced.push(step);
  }
  return {mainRed,candidateRed,unreproduced};
}
