import assert from "node:assert/strict";
import {test} from "node:test";
import {existsSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,renameSync,rmSync,symlinkSync,writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {captureRunTemporary,finishRunTemporary,pruneRunTemporaries} from "./run-temporary.ts";
const scratch=join(homedir(),".cache/nts-scratch/run-temporary-tests");mkdirSync(scratch,{recursive:true});
function fixture(t:{after(fn:()=>void):void}) {
 const home=mkdtempSync(join(scratch,"home-"));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const run=(name:string)=>join(home,".cache/runs",name);
 return {home,run};
}
test("green removes only its own tmp and keeps logs and symlink destinations",t=>{
 const f=fixture(t),run=f.run("green"),owned=captureRunTemporary(run),peer=join(f.home,"peer");
 mkdirSync(peer);writeFileSync(join(peer,"source"),"keep");writeFileSync(join(run,"raw.log"),"evidence");
 symlinkSync(peer,join(owned.path,"link"));writeFileSync(join(owned.path,"generated"),"scratch");
 assert.equal(finishRunTemporary(owned,f.home,true).state,"removed after green");
 assert.equal(existsSync(owned.path),false);assert.equal(readFileSync(join(peer,"source"),"utf8"),"keep");assert.equal(readFileSync(join(run,"raw.log"),"utf8"),"evidence");
});
test("a red keeps its temporary evidence and reports it",t=>{
 const f=fixture(t),owned=captureRunTemporary(f.run("red"));writeFileSync(join(owned.path,"generated.c"),"first failure");
 const result=finishRunTemporary(owned,f.home,false);
 assert.equal(result.state,"retained after red");assert.equal(result.path,owned.path);assert.equal(readFileSync(join(owned.path,"generated.c"),"utf8"),"first failure");
});
test("retained failures evict oldest first and can make room below the size bound",t=>{
 const f=fixture(t),a=captureRunTemporary(f.run("old")),b=captureRunTemporary(f.run("new"));
 for (const owned of [a,b]) {writeFileSync(join(owned.path,"generated"),"bytes");finishRunTemporary(owned,f.home,false);}
 const directory=join(f.home,".cache/nts-gate/closed-temporaries");
 for (const name of readdirSync(directory)) {const file=join(directory,name),entry=JSON.parse(readFileSync(file,"utf8"));entry.closed=entry.owned.path===a.path?1:2;writeFileSync(file,JSON.stringify(entry));}
 const log:string[]=[];
 const capped=pruneRunTemporaries(f.home,{maxBytes:0,minimumFreeBytes:0,write:line=>log.push(line)});
 assert.deepEqual(capped.removed,[a.path,b.path]);assert.equal(capped.retained_bytes,0);assert.match(log.join("\n"),/logs retained/);
 const c=captureRunTemporary(f.run("disk-pressure"));finishRunTemporary(c,f.home,false);
 const pressure=pruneRunTemporaries(f.home,{maxBytes:Number.MAX_SAFE_INTEGER,minimumFreeBytes:10,freeBytes:()=>existsSync(c.path)?0:10,write:()=>{}});
 assert.deepEqual(pressure.removed,[c.path]);
});
test("replaced directories and root symlinks are kept even under pressure",t=>{
 const f=fixture(t);
 for (const symlink of [false,true]) {
  const owned=captureRunTemporary(f.run(String(symlink)));finishRunTemporary(owned,f.home,false);
  renameSync(owned.path,owned.path+"-original");
  const peer=join(f.home,"peer-"+symlink);mkdirSync(peer);writeFileSync(join(peer,"keep"),"peer");
  if (symlink) symlinkSync(peer,owned.path);else {mkdirSync(owned.path);writeFileSync(join(owned.path,"keep"),"replacement");}
  assert.throws(()=>captureRunTemporary(f.run(String(symlink)),owned),/replaced|not an owned real directory/);
  assert.match(finishRunTemporary(owned,f.home,true).state,/kept/);
  const result=pruneRunTemporaries(f.home,{maxBytes:0,minimumFreeBytes:0,write:()=>{}});
  assert.equal(result.removed.length,0);assert.ok(result.protected.length>0);assert.ok(existsSync(owned.path));assert.ok(existsSync(owned.path+"-original"));assert.equal(readFileSync(join(peer,"keep"),"utf8"),"peer");
 }
});
