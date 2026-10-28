import {test} from "node:test";import assert from "node:assert/strict";
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {homedir} from "node:os";import {join} from "node:path";
import {spawnTest} from "../gate/test-wait.ts";
test("status uses registered heads and survives a slow or disappearing worktree",t=>{
 const base=join(homedir(),".cache/nts-scratch/lane-status");mkdirSync(base,{recursive:true});const dir=mkdtempSync(join(base,"case-"));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const repo=join(dir,"repo"),slow=join(dir,"slow"),gone=join(dir,"gone"),bin=join(dir,"bin"),home=join(dir,"home");for(const p of [repo,bin,home])mkdirSync(p);
 const env={...process.env,HOME:home,GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@t",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@t"};
 const git=(...args:string[])=>{const r=spawnTest("/usr/bin/git",args,{cwd:repo,env,encoding:"utf8"});assert.equal(r.status,0,r.stderr);};
 git("init","-q","-b","main");writeFileSync(join(repo,"one"),"one");git("add","one");git("commit","-qm","base");git("worktree","add","--detach",slow);git("worktree","add","--detach",gone);git("pack-refs","--all");
 const fifo=join(dir,"hang");const mk=spawnTest("mkfifo",[fifo],{encoding:"utf8"});assert.equal(mk.status,0,mk.stderr);
 const script=join(bin,"git");
 writeFileSync(script,`#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process');const args=process.argv.slice(2);\n
if(args.includes('rev-parse')&&args.includes('--git-common-dir'))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1200);
if(args.includes('rev-parse')&&args.includes('HEAD'))throw new Error('status must use registered HEADs, not probe each tree');\nif(args.includes('status')&&process.cwd()===${JSON.stringify(slow)})fs.readFileSync(${JSON.stringify(fifo)});\nif(args.includes('status')&&process.cwd()===${JSON.stringify(gone)}){fs.rmSync(${JSON.stringify(gone)},{recursive:true,force:true});process.exit(2);}\nconst r=cp.spawnSync('/usr/bin/git',args,{stdio:'inherit'});process.exit(r.status??1);\n`);chmodSync(script,0o755);
 const state=join(home,".cache/nts-land");mkdirSync(join(state,"pending"),{recursive:true});mkdirSync(join(state,"results"));writeFileSync(join(state,"status.json"),JSON.stringify({state:"gating",holder_unit:"nts-land-train-control",train:["a","b"]}));writeFileSync(join(state,"pending/done.json"),JSON.stringify({id:"done",sha:"done",at:0}));writeFileSync(join(state,"results/done.json"),JSON.stringify({state:"landed"}));
 const result=spawnTest(process.execPath,[new URL('./lane.ts',import.meta.url).pathname,"status","--json"],{cwd:repo,env:{...env,PATH:bin+":"+process.env.PATH},encoding:"utf8"});
 assert.equal(result.status,0,result.stderr);const status=JSON.parse(result.stdout);assert.equal(status.queue.length,0);assert.equal(status.landing.holder_unit,"nts-land-train-control");
 assert.equal(status.trees.find((row:any)=>row.path===slow).state,"slow");assert.equal(status.trees.find((row:any)=>row.path===gone).state,existsSync(gone)?"slow":"missing");
 assert.equal(existsSync(fifo),true,"the hung probe was bounded without a release event");
 writeFileSync(join(state,"status.json"),"{");
 const partial=spawnTest(process.execPath,[new URL('./lane.ts',import.meta.url).pathname,"status","--json"],{cwd:repo,env:{...env,PATH:bin+":"+process.env.PATH},encoding:"utf8"});
 assert.equal(partial.status,0,partial.stderr);assert.equal(JSON.parse(partial.stdout).landing.state,"unknown");
});
