import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {cleanupSubmission,collectSubmissions,type SubmissionManifest} from "./submission-cleanup.ts";

function fixture(t:{after(fn:()=>void):void}) {
 const home=mkdtempSync(join(tmpdir(),"submission-cleanup-"));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const repo=join(home,"repo"),state=join(home,".cache/nts-land"),parent=join(state,"submissions");
 mkdirSync(repo);mkdirSync(parent,{recursive:true});
 const env={...process.env,GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@t",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@t"};
 const git=(...args:string[])=>execFileSync("git",["-C",repo,...args],{env,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
 git("init","-qb","main");writeFileSync(join(repo,"base"),"base");git("add","base");git("commit","-qm","base");
 const sha=git("rev-parse","HEAD");
 const add=(label:string)=>{
  const name=`${label}-${sha.slice(0,12)}-abcdef`,directory=join(parent,name),tree=join(directory,"tree"),unit=`nts-land-${label}-abcdef`;
  mkdirSync(directory);git("worktree","add","-q","--detach",tree,sha);writeFileSync(join(directory,"land.log"),"retained log\n");
  const manifest:SubmissionManifest={version:1,repo,tree,sha,unit,preparingPid:null};
  writeFileSync(join(directory,"submission.json"),JSON.stringify(manifest));
  return {name,directory,tree,unit,manifest};
 };
 return {home,repo,state,parent,git,sha,add};
}
for(const outcome of ["landed","refused","withdrawn"])test(`a finished ${outcome} submission archives its head and keeps its log`,t=>{
 const f=fixture(t),s=f.add(outcome);
 const result=cleanupSubmission(f.repo,s.directory,{home:f.home,unitState:()=>"inactive"});
 assert.equal(result.state,"removed",JSON.stringify(result));
 assert.equal(f.git("rev-parse",`refs/archive/land-submissions/${s.name}`),f.sha);
 assert.equal(existsSync(s.tree),false);assert.equal(readFileSync(join(s.directory,"land.log"),"utf8"),"retained log\n");
 assert.equal(cleanupSubmission(f.repo,s.directory,{home:f.home,unitState:()=>"inactive"}).state,"gone");
});
test("an active unit and a preparing submission keep their worktrees",t=>{
 const f=fixture(t),s=f.add("active");
 assert.match(cleanupSubmission(f.repo,s.directory,{home:f.home,unitState:()=>"active"}).reason!,/is active/);
 writeFileSync(join(s.directory,"submission.json"),JSON.stringify({...s.manifest,preparingPid:process.pid}));
 assert.match(cleanupSubmission(f.repo,s.directory,{home:f.home,unitState:()=>"inactive"}).reason!,/preflight/);
 assert.ok(existsSync(s.tree));
});
test("a stopped waiter remains while queued or frozen in a leader's train",t=>{
 const f=fixture(t),s=f.add("waiter"),queue=join(f.state,"queue");mkdirSync(queue);
 const file=join(queue,"one.json");writeFileSync(file,JSON.stringify({id:"one",tree:s.tree,sha:f.sha}));
 const options={home:f.home,unitState:()=>"inactive"};
 assert.match(cleanupSubmission(f.repo,s.directory,options).reason!,/still queued/);
 rmSync(file);writeFileSync(join(f.state,"status.json"),JSON.stringify({state:"gating",train:[f.sha.slice(0,12)]}));
 assert.match(cleanupSubmission(f.repo,s.directory,options).reason!,/frozen train/);
 assert.ok(existsSync(s.tree));
 writeFileSync(join(f.state,"status.json"),JSON.stringify({state:"landed",train:[f.sha.slice(0,12)]}));
 assert.equal(cleanupSubmission(f.repo,s.directory,options).state,"removed");
 assert.equal(f.git("cat-file","-t",f.sha),"commit","the finished train's commit remains reachable through its archive");
});
test("the same collector handles old manifests and legacy submission directories",t=>{
 const f=fixture(t),a=f.add("manifest"),b=f.add("legacy");rmSync(join(b.directory,"submission.json"));
 const results=collectSubmissions(f.repo,{home:f.home,unitState:()=>"inactive"});
 assert.equal(results.length,2);assert.ok(results.every(r=>r.state==="removed"),JSON.stringify(results));
 for(const s of [a,b])assert.equal(f.git("rev-parse",`refs/archive/land-submissions/${s.name}`),f.sha);
});
test("changed heads, uncommitted work, and conflicting archives are retained",t=>{
 const f=fixture(t),a=f.add("dirty"),b=f.add("archive");
 writeFileSync(join(a.tree,"work"),"uncommitted");
 assert.match(cleanupSubmission(f.repo,a.directory,{home:f.home,unitState:()=>"inactive"}).reason!,/uncommitted/);
 writeFileSync(join(f.repo,"other"),"another commit");f.git("add","other");f.git("commit","-qm","other");
 f.git("update-ref",`refs/archive/land-submissions/${b.name}`,"HEAD");
 assert.match(cleanupSubmission(f.repo,b.directory,{home:f.home,unitState:()=>"inactive"}).reason!,/different head/);
});
test("outside paths, symlinks, and an unreadable unit state never authorize deletion",t=>{
 const f=fixture(t),s=f.add("guarded");
 assert.equal(cleanupSubmission(f.repo,f.repo,{home:f.home,unitState:()=>"inactive"}).state,"kept");
 const link=join(f.parent,`link-${f.sha.slice(0,12)}-abcdef`);symlinkSync(s.directory,link);
 assert.equal(cleanupSubmission(f.repo,link,{home:f.home,unitState:()=>"inactive"}).state,"kept");
 assert.match(cleanupSubmission(f.repo,s.directory,{home:f.home,unitState:()=>{throw new Error("manager unavailable");}}).reason!,/manager unavailable/);
 assert.ok(existsSync(s.tree));
});
test("ExecStopPost may clean its own deactivating unit after every process exits",t=>{
 const f=fixture(t),s=f.add("stopped");
 assert.equal(cleanupSubmission(f.repo,s.directory,{home:f.home,unitState:()=>"deactivating"}).state,"kept");
 assert.equal(cleanupSubmission(f.repo,s.directory,{home:f.home,postStopUnit:s.unit,unitState:()=>"deactivating"}).state,"removed");
});
