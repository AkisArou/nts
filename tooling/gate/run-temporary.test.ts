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
function duRecorder(t:{after(fn:()=>void):void},home:string) {
 const bin=join(home,"bin"),calls=join(home,"du-calls");mkdirSync(bin);writeFileSync(calls,"");
 const quoted="'"+calls.replaceAll("'","'\\''")+"'";
 writeFileSync(join(bin,"du"),`#!/bin/sh\nprintf '%s\\n' "$4" >> ${quoted}\nexec /usr/bin/du "$@"\n`,{mode:0o755});
 const previous=process.env.PATH;process.env.PATH=bin+":"+previous;
 t.after(()=>{if(previous===undefined)delete process.env.PATH;else process.env.PATH=previous;});
 return {read:()=>readFileSync(calls,"utf8").split("\n").filter(Boolean),clear:()=>writeFileSync(calls,"")};
}
function closedEntries(home:string) {
 const directory=join(home,".cache/nts-gate/closed-temporaries");
 return existsSync(directory)?readdirSync(directory).filter(name=>name.endsWith(".json")).map(name=>{
  const file=join(directory,name),entry=JSON.parse(readFileSync(file,"utf8")) as {owned:ReturnType<typeof captureRunTemporary>;closed:number;bytes?:number};
  return {file,entry};
 }):[];
}
function legacyEntry(home:string,name:string,owned:ReturnType<typeof captureRunTemporary>,closed:number,bytes?:number) {
 const directory=join(home,".cache/nts-gate/closed-temporaries");mkdirSync(directory,{recursive:true});
 const file=join(directory,name+".json");writeFileSync(file,JSON.stringify({owned,closed,...(bytes===undefined?{}:{bytes})}));return file;
}
test("closing a failure measures once and later prunes use its stored size without du",t=>{
 const f=fixture(t),du=duRecorder(t,f.home),owned=captureRunTemporary(f.run("stored"));writeFileSync(join(owned.path,"evidence"),"retained");
 const closed=finishRunTemporary(owned,f.home,false,roomy);
 assert.equal(closed.state,"retained after red");assert.deepEqual(du.read(),[owned.path]);
 const entry=closedEntries(f.home)[0]!.entry;assert.ok(Number.isSafeInteger(entry.bytes)&&entry.bytes!>0);
 assert.equal(closed.pruning?.retained_bytes,entry.bytes);du.clear();
 for(let n=0;n<2;n++)assert.equal(pruneRunTemporaries(f.home,roomy).retained_bytes,entry.bytes);
 assert.deepEqual(du.read(),[]);
});
test("a legacy closed size is measured once and written back",t=>{
 const f=fixture(t),du=duRecorder(t,f.home),owned=captureRunTemporary(f.run("legacy"));writeFileSync(join(owned.path,"evidence"),"legacy");
 const file=legacyEntry(f.home,"legacy",owned,1);
 const first=pruneRunTemporaries(f.home,roomy);assert.deepEqual(du.read(),[owned.path]);
 const entry=JSON.parse(readFileSync(file,"utf8"));assert.ok(Number.isSafeInteger(entry.bytes)&&entry.bytes>0);assert.equal(first.retained_bytes,entry.bytes);
 du.clear();assert.equal(pruneRunTemporaries(f.home,roomy).retained_bytes,entry.bytes);assert.deepEqual(du.read(),[]);
});
test("stored sizes keep the size bound's oldest-first eviction without du",t=>{
 const f=fixture(t),du=duRecorder(t,f.home),a=captureRunTemporary(f.run("old-stored")),b=captureRunTemporary(f.run("new-stored"));
 legacyEntry(f.home,"a",a,1,4096);legacyEntry(f.home,"b",b,2,8192);
 const result=pruneRunTemporaries(f.home,{...roomy,maxBytes:8192,write:()=>{}});
 assert.deepEqual(result.removed,[a.path]);assert.equal(result.retained_bytes,8192);assert.ok(existsSync(b.path));assert.deepEqual(du.read(),[]);
});
test("nested jobs retain evidence under their authenticated outer run without separate registrations",t=>{
 const f=fixture(t),du=duRecorder(t,f.home),outer=captureRunTemporary(f.run("outer"));
 const job=captureRunTemporary(join(outer.path,"job"),outer),nested=captureRunTemporary(join(job.path,"nested"),job);
 writeFileSync(join(nested.path,"evidence"),"nested failure");
 assert.equal(finishRunTemporary(nested,f.home,false,roomy).state,"retained after red");
 assert.equal(finishRunTemporary(job,f.home,false,roomy).state,"retained after red");
 assert.deepEqual(closedEntries(f.home),[]);assert.deepEqual(du.read(),[]);assert.ok(existsSync(nested.path));
 const result=finishRunTemporary(outer,f.home,false,roomy);
 assert.deepEqual(closedEntries(f.home).map(row=>row.entry.owned.path),[outer.path]);assert.deepEqual(du.read(),[outer.path]);
 assert.equal(result.pruning?.retained_bytes,closedEntries(f.home)[0]!.entry.bytes);
 assert.equal(finishRunTemporary(outer,f.home,true).state,"removed after green");assert.equal(existsSync(nested.path),false);
});
test("a job outside its inherited run remains independently registered",t=>{
 const f=fixture(t),outer=captureRunTemporary(f.run("outer")),job=captureRunTemporary(f.run("outside-job"),outer);
 assert.equal(finishRunTemporary(job,f.home,false,roomy).state,"retained after red");
 assert.deepEqual(closedEntries(f.home).map(row=>row.entry.owned.path),[job.path]);
 assert.equal(finishRunTemporary(outer,f.home,true).state,"removed after green");assert.ok(existsSync(job.path));
});
test("a sibling job reached from a nested handoff keeps the same outer lifetime",t=>{
 const f=fixture(t),outer=captureRunTemporary(f.run("outer")),a=captureRunTemporary(join(outer.path,"a"),outer),b=captureRunTemporary(join(outer.path,"b"),a);
 assert.equal(finishRunTemporary(b,f.home,false,roomy).state,"retained after red");assert.deepEqual(closedEntries(f.home),[]);
});
test("legacy nested registrations collapse into their measured outer retention root",t=>{
 const f=fixture(t),du=duRecorder(t,f.home),outer=captureRunTemporary(f.run("outer")),job=captureRunTemporary(join(outer.path,"job"));
 writeFileSync(join(job.path,"evidence"),"legacy nested failure");
 const inner=legacyEntry(f.home,"inner",job,1),parent=legacyEntry(f.home,"outer",outer,2);
 const first=pruneRunTemporaries(f.home,roomy),entry=JSON.parse(readFileSync(parent,"utf8"));
 assert.deepEqual(du.read(),[outer.path]);assert.equal(existsSync(inner),false);assert.ok(existsSync(job.path));assert.equal(first.retained_bytes,entry.bytes);
 du.clear();assert.equal(pruneRunTemporaries(f.home,roomy).retained_bytes,entry.bytes);assert.deepEqual(du.read(),[]);
});
test("a replaced enclosing run cannot authorize a nested close",t=>{
 const f=fixture(t),outer=captureRunTemporary(f.run("outer")),job=captureRunTemporary(join(outer.path,"job"),outer);
 const result=finishRunTemporary({...job,enclosing:{...outer,ino:outer.ino+1}},f.home,false,roomy);
 assert.match(result.state,/kept/);assert.match(result.error!,/replaced/);assert.ok(existsSync(job.path));assert.deepEqual(closedEntries(f.home),[]);
});
test("malformed stored sizes never authorize eviction or a fallback measurement",t=>{
 const f=fixture(t),du=duRecorder(t,f.home);
 for(const [i,bytes] of [-1,null,"4096"].entries()){
  const owned=captureRunTemporary(f.run("bad-size-"+i)),file=legacyEntry(f.home,String(i),owned,1);
  const entry=JSON.parse(readFileSync(file,"utf8"));entry.bytes=bytes;writeFileSync(file,JSON.stringify(entry));
 }
 const result=pruneRunTemporaries(f.home,{maxBytes:0,minimumFreeBytes:0,write:()=>{}});
 assert.deepEqual(result.removed,[]);assert.equal(result.protected.length,3);assert.equal(closedEntries(f.home).length,3);assert.deepEqual(du.read(),[]);
});
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
