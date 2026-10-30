import { execFileSync, spawnSync } from "node:child_process";
import { isRecordedBinary, provenanceOf } from "../conformance/pin.ts";

import { readRecords, readRecordsAt } from "./oracle-records.ts";
const projectOf=(source:string)=>/^tests\/programs\/([^/]+)\//.exec(source)?.[1];

/** Only an explicit, verified clean before pin can establish candidate history. */
export function newlyRecordedProjects(root:string,before:string,base:string,backend:string):Set<string> {
  const commit=execFileSync("git",["rev-parse","--verify",`${base}^{commit}`],{cwd:root,encoding:"utf8"}).trim();
  const record=provenanceOf(before);
  if(!record || record.sha!==commit || record.clean!==true || record.applied!==null || !isRecordedBinary(before,commit)) {
    throw new Error("new-project comparison needs verified clean before-pin provenance matching --base");
  }
  if(spawnSync("git",["merge-base","--is-ancestor",commit,"HEAD"],{cwd:root}).status!==0) {
    throw new Error("new-project comparison base is not an ancestor of the candidate");
  }
  const old=readRecordsAt(root,commit).rows;
  const current=readRecords(root).rows;
  const prior=new Set(old.map(row=>projectOf(row.source)).filter(Boolean));
  const added=new Set<string>();
  for(const row of current) {
    const project=projectOf(row.source);
    if(!project || prior.has(project) || row.kind!=="measured" || row.complete!==true || !Number.isSafeInteger(row.count) || !(row.count!>0) || !row.keys?.[backend]) continue;
    // A new signature/record for an existing fixture cannot waive its baseline.
    if(spawnSync("git",["cat-file","-e",`${commit}:tests/programs/${project}/tsconfig.json`],{cwd:root,stdio:"ignore"}).status===0) continue;
    added.add(project);
  }
  return added;
}

type Result = { outcome:string; status:number|null; checked:number; expected:number; declined:number; timeouts:number;
  refused:number; oracleStopped:number; missingPopulation?:string|null };

/** No crashes, capture/setup errors, timeouts or arbitrary NOT MEASURED rows. */
export function newBeforeProject(project:string,added:ReadonlySet<string>,before:Result):boolean {
  if(!added.has(project) || before.status===null || ![0,1].includes(before.status) || before.timeouts || before.oracleStopped) return false;
  if(before.outcome==="not measured") {
    return before.status===1 && projectOf(before.missingPopulation??"")===project;
  }
  return ["agrees on what it compared","nothing to check","declined every case","backend declined"].includes(before.outcome)
    && (before.refused>0 || before.declined>0 || before.outcome==="backend declined");
}

export function fullyMeasuredAgreement(after:Result):boolean {
  return after.status===0 && after.outcome==="agrees" && after.expected>0 && after.checked===after.expected
    && after.declined===0 && after.refused===0 && after.timeouts===0 && after.oracleStopped===0;
}
