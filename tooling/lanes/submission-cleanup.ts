// Remove immutable submission copies only after their processes and train finish.
// This file has only Node dependencies so ExecStopPost can run a retained copy
// beside land.log, even after the submission worktree has been removed.
import {spawnSync} from "node:child_process";
import {appendFileSync,existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,realpathSync,rmSync,writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {basename,dirname,join,resolve} from "node:path";
import {pathToFileURL} from "node:url";

export type SubmissionManifest={version:1;repo:string;tree:string;sha:string;unit:string;preparingPid:number|null};
export type CleanupResult={name:string;state:"removed"|"kept"|"gone";reason?:string;head?:string;archive?:string};
type Options={home?:string;postStopUnit?:string;unitState?:(unit:string)=>string;now?:()=>number};
function git(repo:string,args:string[]):string {
  const env={...process.env,GIT_OPTIONAL_LOCKS:"0",GIT_TERMINAL_PROMPT:"0"};
  for(const key of ["GIT_DIR","GIT_WORK_TREE","GIT_COMMON_DIR","GIT_INDEX_FILE"])delete env[key];
  const r=spawnSync("git",["-C",repo,...args],{env,encoding:"utf8",timeout:30_000,maxBuffer:32<<20});
  if(r.error||r.status!==0)throw new Error(`git ${args[0]}: ${r.error?.message??r.stderr.trim()}`);
  return r.stdout.trim();
}
function unitState(unit:string):string {
  const r=spawnSync("systemctl",["--user","show",unit,"--property=ActiveState","--property=LoadState"],{encoding:"utf8",timeout:10_000});
  if(r.error)throw r.error;
  const active=/^ActiveState=(.+)$/m.exec(r.stdout)?.[1];
  if(active)return active;
  if(/^LoadState=not-found$/m.test(r.stdout))return "inactive";
  throw new Error(`cannot establish unit state for ${unit}: ${r.stderr.trim()}`);
}
function alive(pid:number):boolean {try{process.kill(pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code!=="ESRCH";}}
function references(state:string,tree:string,head:string):string|null {
  const queue=join(state,"queue");
  for(const file of existsSync(queue)?readdirSync(queue):[]) {
    if(!file.endsWith(".json"))continue;
    const entry=JSON.parse(readFileSync(join(queue,file),"utf8"));
    if(resolve(entry.tree??"/")===tree || entry.sha===head)return `still queued as ${entry.id??file}`;
  }
  const path=join(state,"status.json");
  if(existsSync(path)) {
    const status=JSON.parse(readFileSync(path,"utf8"));
    if(["gating","held"].includes(status.state)&&Array.isArray(status.train)&&status.train.some((s:unknown)=>typeof s==="string"&&head.startsWith(s)))return "still a frozen train member";
  }
  return null;
}
export function cleanupSubmission(repo:string,directory:string,options:Options={}):CleanupResult {
  const home=options.home??homedir(),parent=join(home,".cache/nts-land/submissions"),name=basename(directory);
  const kept=(reason:string):CleanupResult=>({name,state:"kept",reason});
  try {
    if(dirname(resolve(directory))!==resolve(parent)||realpathSync(parent)!==resolve(parent)||lstatSync(directory).isSymbolicLink()||realpathSync(directory)!==resolve(directory))return kept("not an owned submission directory");
    const tree=join(directory,"tree"),manifestPath=join(directory,"submission.json");
    const match=/^(.+)-([a-f0-9]{12})-([A-Za-z0-9]+)$/.exec(name);
    if(!match)return kept("unrecognized submission name");
    const manifest:SubmissionManifest|null=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath,"utf8")):null;
    const unit=manifest?.unit??`nts-land-${match[1]}-${match[3]}`;
    if(manifest&&(manifest.version!==1||resolve(manifest.tree)!==resolve(tree)||resolve(manifest.repo)!==resolve(repo)))return kept("manifest does not name this repository and tree");
    if(!/^nts-land-[A-Za-z0-9_-]+$/.test(unit))return kept("unrecognized submission unit");
    if(manifest?.preparingPid&&alive(manifest.preparingPid))return kept("submission preflight is still running");
    const active=(options.unitState??unitState)(unit);
    if(!["inactive","failed"].includes(active)&&!(active==="deactivating"&&options.postStopUnit===unit))return kept(`unit ${unit} is ${active}`);
    const all=git(repo,["worktree","list","--porcelain","-z"]).split("\0\0");
    const record=all.map(row=>row.split("\0")).find(row=>row.includes(`worktree ${tree}`));
    if(!record) return existsSync(tree)?kept("tree exists without a matching registration"):{name,state:"gone"};
    if(!record.includes("detached")||record.some(s=>s.startsWith("locked")))return kept("submission is not an unlocked detached worktree");
    const head=record.find(s=>s.startsWith("HEAD "))?.slice(5);
    if(!head||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(head))return kept("missing registered head");
    if(manifest&&manifest.sha!==head)return kept("submission head changed since registration");
    const referenced=references(join(home,".cache/nts-land"),tree,head);if(referenced)return kept(referenced);
    if(realpathSync(tree)!==resolve(tree))return kept("worktree resolves elsewhere");
    if(git(tree,["status","--porcelain","--untracked-files=normal","--ignore-submodules=all"]))return kept("submission contains uncommitted work");
    const archive=`refs/archive/land-submissions/${name}`;
    const probe=spawnSync("git",["-C",repo,"rev-parse","--verify",archive],{encoding:"utf8"});
    if(probe.status===0&&probe.stdout.trim()!==head)return kept("archive already names a different head");
    if(probe.status!==0)git(repo,["update-ref",archive,head,"0".repeat(head.length)]);
    if(git(repo,["rev-parse","--verify",archive])!==head)throw new Error("archive head verification failed");
    // Recheck both forms of live use immediately before the only deletion.
    const last=(options.unitState??unitState)(unit);
    if(!["inactive","failed"].includes(last)&&!(last==="deactivating"&&options.postStopUnit===unit))return kept(`unit ${unit} became ${last}`);
    const now=references(join(home,".cache/nts-land"),tree,head);if(now)return kept(now);
    git(repo,["worktree","remove","--force",tree]);
    const result:CleanupResult={name,state:"removed",head,archive};
    writeFileSync(join(directory,"cleanup.json"),JSON.stringify(result,null,2)+"\n");
    return result;
  }catch(error){return kept(String(error));}
}
export function collectSubmissions(repo:string,options:Options={}):CleanupResult[] {
  const parent=join(options.home??homedir(),".cache/nts-land/submissions");
  if(!existsSync(parent))return [];
  return readdirSync(parent).filter(name=>lstatSync(join(parent,name)).isDirectory()).sort().map(name=>cleanupSubmission(repo,join(parent,name),options));
}
export function collectRangeTrees(repo:string,options:Options={}):CleanupResult[] {
 const parent=join(options.home??homedir(),".cache/nts-owed-range");
 if(!existsSync(parent))return [];
 return readdirSync(parent).filter(name=>name.startsWith("range-")).map(name=>{
  const directory=join(parent,name),kept=(reason:string):CleanupResult=>({name,state:"kept",reason});
  try {
   if(realpathSync(parent)!==resolve(parent)||lstatSync(directory).isSymbolicLink()||realpathSync(directory)!==resolve(directory))return kept("not an owned range directory");
   const path=join(directory,"owner.json");if(!existsSync(path))return kept("range owner is unknown");
   const owner=JSON.parse(readFileSync(path,"utf8"));
   if(owner.version!==1||!Number.isInteger(owner.pid)||owner.pid<=0||!Number.isFinite(owner.created)||resolve(owner.repo)!==resolve(repo))return kept("invalid range owner record");
   if((options.now??Date.now)()-owner.created<3600_000)return kept("range is younger than one hour");
   if(alive(owner.pid))return kept("range owner is still alive");
   if(readdirSync(directory).some(file=>!["owner.json","0","1"].includes(file)))return kept("unexpected files in range directory");
   const registrations=git(repo,["worktree","list","--porcelain","-z"]).split("\0\0").map(r=>r.split("\0"));
   const remove:string[]=[];
   for(const slot of ["0","1"]) {
    const tree=join(directory,slot);if(!existsSync(tree))continue;
    if(lstatSync(tree).isSymbolicLink()||realpathSync(tree)!==resolve(tree))return kept("range tree resolves elsewhere");
    const record=registrations.find(r=>r.includes(`worktree ${tree}`));
    if(!record)continue; // A failed worktree add can leave a partial directory.
    if(!record.includes("detached")||record.some(s=>s.startsWith("locked")))return kept("range tree is not an unlocked detached worktree");
    const head=record.find(s=>s.startsWith("HEAD "))?.slice(5);if(!head||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(head))return kept("missing range head");
    if(git(tree,["status","--porcelain","--untracked-files=no","--ignore-submodules=all"]))return kept("range contains uncommitted work");
    const archive=`refs/archive/owed-ranges/${name}-${slot}`;
    const old=spawnSync("git",["-C",repo,"rev-parse","--verify",archive],{encoding:"utf8"});
    if(old.status===0&&old.stdout.trim()!==head)return kept("range archive names a different head");
    if(old.status!==0)git(repo,["update-ref",archive,head,"0".repeat(head.length)]);
    if(git(repo,["rev-parse",archive])!==head)return kept("range archive verification failed");
    remove.push(tree);
   }
   if(alive(owner.pid))return kept("range owner became live");
   for(const tree of remove)git(repo,["worktree","remove","--force",tree]);
   rmSync(directory,{recursive:true,force:true});
   return {name,state:"removed"};
  }catch(error){return kept(String(error));}
 });
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    const args=process.argv.slice(2),repo=args[args.indexOf("--repo")+1],postStopUnit=args.includes("--post-stop")?args[args.indexOf("--post-stop")+1].replace(/\.service$/,""):undefined;
    if(!args.includes("--repo")||!repo)throw new Error("usage: submission-cleanup.ts --repo <shared checkout> [--post-stop <unit>]");
    const state=join(homedir(),".cache/nts-land");mkdirSync(state,{recursive:true});process.chdir(state);
    if(!args.includes("--locked")) {
      const r=spawnSync("flock",["-n","-E","75",join(state,"submission-cleanup.lock"),process.execPath,process.argv[1],...args,"--locked"],{stdio:"inherit"});
      process.exitCode=r.status===75?0:r.status??1;
    }else for(const result of [...collectSubmissions(repo,{postStopUnit}),...collectRangeTrees(repo)]) {
      appendFileSync(join(state,"submission-cleanup.jsonl"),JSON.stringify({at:new Date().toISOString(),...result})+"\n");
      if(result.state!=="gone")console.log(`submission cleanup ${result.state} ${result.name}${result.reason?`: ${result.reason}`:""}`);
    }
  }catch(error){console.error(`submission cleanup: ${String(error)}`);process.exitCode=1;}
}
