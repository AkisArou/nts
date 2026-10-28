// Git owns ref storage. Parse its documented NUL-delimited plumbing output.
import {execFileSync} from "node:child_process";
import {dirname} from "node:path";
export type RegisteredWorktree={path:string;head:string;branch:string;locked?:string;prunable?:string};
export function parseWorktreeRegistry(text:string):RegisteredWorktree[]{
  const rows:RegisteredWorktree[]=[];
  for(const record of text.split("\0\0")){
    if(!record)continue;
    const fields=record.split("\0"),path=fields.find(field=>field.startsWith("worktree "))?.slice(9);
    if(!path)throw new Error("Git worktree registry omitted its path");
    const head=fields.find(field=>field.startsWith("HEAD "))?.slice(5)??"";
    const branch=fields.find(field=>field.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//,"")??(fields.includes("bare")?"(bare)":fields.includes("detached")?"(detached)":"(unknown)");
    const row:RegisteredWorktree={path,head,branch};
    for(const name of ["locked","prunable"] as const){const field=fields.find(field=>field===name||field.startsWith(name+" "));if(field!==undefined)row[name]=field===name?"":field.slice(name.length+1);}
    rows.push(row);
  }
  return rows;
}
export function gitWorktreeRegistry(cwd:string):{root:string;trees:RegisteredWorktree[]}{
  // Essential plumbing has no scheduling deadline. Optional per-tree probes
  // are separately bounded and never turn slowness into a command failure.
  const git=(args:string[])=>execFileSync("git",["--no-optional-locks",...args],{cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"],maxBuffer:64<<20});
  const common=git(["rev-parse","--path-format=absolute","--git-common-dir"]).trim();
  return {root:dirname(common),trees:parseWorktreeRegistry(git(["worktree","list","--porcelain","-z"]))};
}
