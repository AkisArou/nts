import{test}from"node:test";import assert from"node:assert/strict";
import{spawnSync,execFileSync}from"node:child_process";
import{mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,utimesSync,writeFileSync}from"node:fs";
import{tmpdir}from"node:os";import{join}from"node:path";
import{rootTrial}from"./root-trial.ts";
function fixture(t:{after(fn:()=>void):void}){
 const directory=mkdtempSync(join(tmpdir(),"root-trial-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const root=join(directory,"repo"),trials=join(directory,"trials");mkdirSync(root);
 const env={...process.env,GIT_OPTIONAL_LOCKS:"0",GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@t",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@t"};
 const git=(...args:string[])=>execFileSync("git",args,{cwd:root,env,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
 git("init","-qb","main");writeFileSync(join(root,"doc"),"base\n");writeFileSync(join(root,"other"),"other\n");git("add",".");git("commit","-qm","base");const base=git("rev-parse","HEAD");
 writeFileSync(join(root,"doc"),"next\n");git("add","doc");git("commit","-qm","next");const tip=git("rev-parse","HEAD");git("switch","-q","--detach",base);
 const index=()=>readFileSync(git("rev-parse","--path-format=absolute","--git-path","index"));
 return {root,trials,env,git,base,tip,index};
}
test("a copied-index refresh unblocks stale metadata without writing the real index",t=>{
 const f=fixture(t),doc=join(f.root,"doc");
 writeFileSync(doc,"temporary conflicting bytes\n");writeFileSync(doc,"base\n");utimesSync(doc,1,1);
 const index=f.index();
 const before=spawnSync("git",["read-tree","--dry-run","-m","-u",f.base,f.tip],{cwd:f.root,env:f.env,encoding:"utf8"});
 assert.notEqual(before.status,0,before.stderr);assert.match(before.stderr,/not uptodate/);
 assert.equal(rootTrial(f.root,f.base,f.tip,f.trials),null);
 assert.deepEqual(f.index(),index,"the trial must leave every real-index byte unchanged");
 assert.deepEqual(readdirSync(f.trials),[]);
});
test("identical staged future content passes without modifying its real index",t=>{
 const f=fixture(t);writeFileSync(join(f.root,"doc"),"next\n");f.git("add","doc");const index=f.index();
 assert.equal(rootTrial(f.root,f.base,f.tip,f.trials),null);assert.deepEqual(f.index(),index);
});
test("a conflicting local file is kept while an unrelated dirty file is allowed",t=>{
 const f=fixture(t);writeFileSync(join(f.root,"doc"),"local conflict\n");const index=f.index();
 assert.match(rootTrial(f.root,f.base,f.tip,f.trials)??"",/root checkout conflict/);assert.deepEqual(f.index(),index);
 writeFileSync(join(f.root,"doc"),"base\n");writeFileSync(join(f.root,"other"),"unrelated local edit\n");
 assert.equal(rootTrial(f.root,f.base,f.tip,f.trials),null);assert.deepEqual(f.index(),index);
});
