// Join only a fresh measurement of held steps to this exact frozen gate.
import type {Attempt} from "./instrument-retry.ts";
import type {StepResult} from "./instrument-retry.ts";
import {comparisonHost} from "./resource-comparison.ts";
export type GateRetry={base:string;tip:string;run:string;steps:string[]};
const same=(a:readonly string[],b:readonly string[])=>a.length===b.length&&new Set(a).size===a.length&&a.every(value=>b.includes(value));
export function mergeGateRetry(previous:Attempt,next:Attempt,steps:string[]):Attempt {
  const a=previous.summary,b=next.summary;
  const hash=a.identities?.nts?.sha256;
  if(!hash||b.identities?.nts?.sha256!==hash||a.identities?.commit!==b.identities?.commit
      ||a.environment?.canonical!==true||b.environment?.canonical!==true
      ||comparisonHost(a.environment,previous.run)!==comparisonHost(b.environment,next.run)
      ||!same(b.requested,steps)||!same(b.steps.map(row=>row.name),steps)
      ||!same(a.requested,a.steps.map(row=>row.name))||steps.some(name=>!a.requested.includes(name))
      ||a.steps.some(row=>!steps.includes(row.name)&&row.verdict!=="PASS"&&!(row.verdict==="SKIPPED"&&row.accepted===true)))throw new Error("held-step retry lacks the frozen compiler, commit, canonical host or complete step scope");
  const updated=new Map(b.steps.map(row=>[row.name,{...row,evidence_run:next.run}]));
  const rows:StepResult[]=a.steps.map(row=>updated.get(row.name)??{...row,evidence_run:row.evidence_run??previous.run});
  return {...next,summary:{...b,requested:a.requested,steps:rows,
    verdict:rows.every(row=>row.verdict==="PASS"||(row.verdict==="SKIPPED"&&row.accepted===true))?"green":"red",
    wall_s:Number(a.wall_s??0)+Number(b.wall_s??0),
    attempts:[...(a.attempts??[{run:previous.run,steps:a.requested}]),{run:next.run,steps}]}};
}
