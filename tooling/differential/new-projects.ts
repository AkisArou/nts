import { execFileSync, spawnSync } from "node:child_process";
import { isRecordedBinary, provenanceOf } from "../conformance/pin.ts";

const projectOf=(source:string)=>/^tests\/programs\/([^/]+)\//.exec(source)?.[1];

/** Git-added project directories, relative to an explicit, verified clean before pin. */
export function candidateAddedProjects(root:string,before:string,base:string):Set<string> {
  const commit=execFileSync("git",["rev-parse","--verify",`${base}^{commit}`],{cwd:root,encoding:"utf8"}).trim();
  const record=provenanceOf(before);
  if(!record || record.sha!==commit || record.clean!==true || record.applied!==null || !isRecordedBinary(before,commit)) {
    throw new Error("new-project comparison needs verified clean before-pin provenance matching --base");
  }
  if(spawnSync("git",["merge-base","--is-ancestor",commit,"HEAD"],{cwd:root}).status!==0) {
    throw new Error("new-project comparison base is not an ancestor of the candidate");
  }
  const gitPaths=(args:string[])=>execFileSync("git",args,{cwd:root,encoding:"utf8"}).split("\0").filter(Boolean);
  const prior=new Set(gitPaths(["ls-tree","-r","-z","--name-only",commit,"--","tests/programs/"])
    .map(projectOf).filter(Boolean));
  const added=new Set<string>();
  for(const path of gitPaths(["diff","--no-renames","--diff-filter=A","--name-only","-z",commit,"HEAD","--","tests/programs/"])) {
    const match=/^tests\/programs\/([^/]+)\/tsconfig\.json$/.exec(path);
    // An added file or oracle row inside an existing project cannot waive its baseline.
    const project=match?.[1];
    if(project && !prior.has(project)) added.add(project);
  }
  return added;
}

type Result = { outcome:string; status:number|null; checked:number; expected:number; declined:number; timeouts:number;
  refused:number; oracleStopped:number };

export function fullyMeasuredAgreement(after:Result):boolean {
  return after.status===0 && after.outcome==="agrees" && after.expected>0 && after.checked===after.expected
    && after.declined===0 && after.refused===0 && after.timeouts===0 && after.oracleStopped===0;
}
