import assert from "node:assert/strict";
import {test} from "node:test";
import {existsSync, mkdirSync, readdirSync, readFileSync, renameSync, symlinkSync, writeFileSync, chmodSync, lstatSync, rmSync} from "node:fs";

import {join} from "node:path";
import {removable, captureRunTemporary, finishRunTemporary, pruneRunTemporaries} from "./run-temporary.ts";
import {newTestScratch} from "./test-scratch.ts";
// The free-disk reading is injected: what these tests decide must not depend
// on the machine's own free disk.
const roomy={freeBytes:()=>Number.MAX_SAFE_INTEGER};
function fixture(t:{after(fn:()=>void):void}) {
 const home=newTestScratch("run-temporary-home");t.after(()=>{removable(home);rmSync(home,{recursive:true,force:true});});
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
 const result=finishRunTemporary(owned,f.home,false,roomy);
 assert.equal(result.state,"retained after red");assert.equal(result.path,owned.path);assert.equal(readFileSync(join(owned.path,"generated.c"),"utf8"),"first failure");
 assert.equal(result.pruning?.free_bytes,Number.MAX_SAFE_INTEGER,"the result names the reading its decision used");
});
test("below the disk floor a red's temporary folder is evicted, and the result says by what",t=>{
 const f=fixture(t),owned=captureRunTemporary(f.run("floor"));writeFileSync(join(owned.path,"generated.c"),"evidence");
 const log:string[]=[];
 const result=finishRunTemporary(owned,f.home,false,{freeBytes:()=>5,minimumFreeBytes:10,write:line=>log.push(line)});
 assert.equal(result.state,"evicted by failed-temporary bound");assert.equal(existsSync(owned.path),false);
 assert.deepEqual([result.pruning?.free_bytes,result.pruning?.minimum_free_bytes],[5,10]);
 assert.ok(result.pruning!.retained_bytes<=result.pruning!.max_bytes,"the size bound did not decide it");
 assert.match(log.join("\n"),new RegExp(`gate tmp: evicted closed failure ${owned.path} `));
});
test("retained failures evict oldest first and can make room below the size bound",t=>{
 const f=fixture(t),a=captureRunTemporary(f.run("old")),b=captureRunTemporary(f.run("new"));
 for (const owned of [a,b]) {writeFileSync(join(owned.path,"generated"),"bytes");finishRunTemporary(owned,f.home,false,roomy);}
 const directory=join(f.home,".cache/nts-gate/closed-temporaries");
 for (const name of readdirSync(directory)) {const file=join(directory,name),entry=JSON.parse(readFileSync(file,"utf8"));entry.closed=entry.owned.path===a.path?1:2;writeFileSync(file,JSON.stringify(entry));}
 const log:string[]=[];
 const capped=pruneRunTemporaries(f.home,{maxBytes:0,minimumFreeBytes:0,write:line=>log.push(line)});
 assert.deepEqual(capped.removed,[a.path,b.path]);assert.equal(capped.retained_bytes,0);assert.match(log.join("\n"),/logs retained/);
 const c=captureRunTemporary(f.run("disk-pressure"));finishRunTemporary(c,f.home,false,roomy);
 const pressure=pruneRunTemporaries(f.home,{maxBytes:Number.MAX_SAFE_INTEGER,minimumFreeBytes:10,freeBytes:()=>existsSync(c.path)?0:10,write:()=>{}});
 assert.deepEqual(pressure.removed,[c.path]);
});
test("replaced directories and root symlinks are kept even under pressure",t=>{
 const f=fixture(t);
 for (const symlink of [false,true]) {
  const owned=captureRunTemporary(f.run(String(symlink)));finishRunTemporary(owned,f.home,false,roomy);
  renameSync(owned.path,owned.path+"-original");
  const peer=join(f.home,"peer-"+symlink);mkdirSync(peer);writeFileSync(join(peer,"keep"),"peer");
  if (symlink) symlinkSync(peer,owned.path);else {mkdirSync(owned.path);writeFileSync(join(owned.path,"keep"),"replacement");}
  assert.throws(()=>captureRunTemporary(f.run(String(symlink)),owned),/replaced|not an owned real directory/);
  assert.match(finishRunTemporary(owned,f.home,true).state,/kept/);
  const result=pruneRunTemporaries(f.home,{maxBytes:0,minimumFreeBytes:0,write:()=>{}});
  assert.equal(result.removed.length,0);assert.ok(result.protected.length>0);assert.ok(existsSync(owned.path));assert.ok(existsSync(owned.path+"-original"));assert.equal(readFileSync(join(peer,"keep"),"utf8"),"peer");
 }
});


test("read-only owned captures are removed on green and closed-red eviction without following links",t=>{
 const f=fixture(t),peer=join(f.home,'outside');mkdirSync(peer);writeFileSync(join(peer,'keep'),'outside bytes');chmodSync(join(peer,'keep'),0o444);chmodSync(peer,0o555);
 for(const green of [true,false]){
  const owned=captureRunTemporary(f.run('readonly-'+green)),nested=join(owned.path,'capture/nested');mkdirSync(nested,{recursive:true});writeFileSync(join(nested,'bytes'),'captured');chmodSync(join(nested,'bytes'),0o444);
  symlinkSync(peer,join(nested,'outside'));chmodSync(nested,0o555);chmodSync(join(owned.path,'capture'),0o555);
  if(green)assert.equal(finishRunTemporary(owned,f.home,true).state,'removed after green');
  else{finishRunTemporary(owned,f.home,false);assert.deepEqual(pruneRunTemporaries(f.home,{maxBytes:0,minimumFreeBytes:0,write:()=>{}}).removed,[owned.path]);}
  assert.equal(existsSync(owned.path),false);assert.equal(lstatSync(peer).mode&0o777,0o555);assert.equal(lstatSync(join(peer,'keep')).mode&0o777,0o444);assert.equal(readFileSync(join(peer,'keep'),'utf8'),'outside bytes');
 }
 chmodSync(peer,0o755);
});

test("a failed root ownership check changes no read-only directory permissions",t=>{
 const f=fixture(t),owned=captureRunTemporary(f.run('ownership')),nested=join(owned.path,'capture');mkdirSync(nested);chmodSync(nested,0o555);
 const result=finishRunTemporary({...owned,uid:owned.uid+1},f.home,true);assert.match(result.state,/kept/);assert.equal(lstatSync(nested).mode&0o777,0o555);
 chmodSync(nested,0o755);
});
