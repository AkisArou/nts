import{test}from"node:test";import assert from"node:assert/strict";
import{spawnSync,execFileSync}from"node:child_process";
import{mkdirSync,mkdtempSync,rmSync,writeFileSync}from"node:fs";
import{tmpdir}from"node:os";import{join}from"node:path";
import{attribute,type Batch,type Outcome,type Request,type Hold}from"./attribution.ts";
function fixture(t:{after(fn:()=>void):void},baselineRed=false){
 const root=mkdtempSync(join(tmpdir(),"attribution-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const env={...process.env,GIT_OPTIONAL_LOCKS:"0",GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@t",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@t"};
 const git=(...args:string[])=>execFileSync("git",args,{cwd:root,env,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
 git("init","-qb","main");writeFileSync(join(root,"base"),"base");if(baselineRed)writeFileSync(join(root,"RED"),"baseline defect");git("add",".");git("commit","-qm","base");const base=git("rev-parse","HEAD");
 const landings:Batch["landings"]=[];let previous=base;
 for(const [id,path]of[["innocent-before","one"],["culprit","RED"],["innocent-after","three"]]){
  writeFileSync(join(root,path),id);git("add",path);git("commit","-qm",id);const tip=git("rev-parse","HEAD");landings.push({id,base:previous,tip});previous=tip;
 }
 const batch:Batch={id:"scratch-batch",base,tip:previous,landings,steps:["tests","memory"],red:{kind:"verdict",revision:previous,steps:["tests","memory"],failed:["memory"],host:"frozen-host",canonical:true,run:"initial-run"}};
 const gate=(request:Request):Outcome=>{
  const red=spawnSync("git",["cat-file","-e",`${request.revision}:RED`],{cwd:root,env,encoding:"utf8"}).status===0;
  const evidence={revision:request.revision,steps:[...request.steps],host:request.host,canonical:true,run:`run-${request.invocation}`,invocation:request.invocation,fresh:true};
  return red?{...evidence,kind:"verdict",failed:["memory"]}:{...evidence,kind:"green"};
 };
 return{batch,gate,git};
}
test("a scratch-repository boundary requires two fresh reds and a green immediate parent",async t=>{
 const f=fixture(t),tip=f.git("rev-parse","main"),result=await attribute(f.batch,f.gate);
 assert.equal(result.kind,"culprit",JSON.stringify(result));if(result.kind!=="culprit")return;
 assert.equal(result.landing.id,"culprit");assert.deepEqual(result.steps,["memory"]);
 assert.equal(result.attempts[0].phase,"baseline");assert.equal(result.attempts[1].phase,"tip");
 assert.deepEqual(result.attempts.slice(-3).map(a=>[a.phase,a.request.revision]),[["reproduce-1",f.batch.landings[1].tip],["reproduce-2",f.batch.landings[1].tip],["parent",f.batch.landings[1].base]]);
 assert.ok(result.attempts.every(a=>a.request.cache==="off"));assert.equal(f.git("rev-parse","main"),tip,"attribution never moves main");
});
test("a red verified baseline holds without bisection",async t=>{
 const f=fixture(t,true),result=await attribute(f.batch,f.gate);
 assert.equal(result.kind,"held");assert.match("reason"in result?result.reason:"",/baseline/);assert.equal(result.attempts.length,1);
});
for(const category of["instrument","timeout","oom","setup","unknown"]as Hold["category"][])test(`${category} during narrowing holds and cannot authorize a revert`,async t=>{
 const f=fixture(t),result=await attribute(f.batch,r=>r.invocation.endsWith(":search")?{kind:"hold",category,reason:`${category} control`}:f.gate(r));
 assert.equal(result.kind,"held");if(result.kind==="held")assert.equal(result.category,category);
 assert.ok(!result.attempts.some(a=>a.phase==="reproduce-1"));
});
test("an originally red tip that is now green cannot attribute an older failing prefix",async t=>{
 const f=fixture(t),result=await attribute(f.batch,r=>{const out=f.gate(r);return r.invocation.endsWith(":tip")&&out.kind!=="hold"?{...out,kind:"green"}:out;});
 assert.equal(result.kind,"held");assert.equal(result.attempts.length,2);assert.match("reason"in result?result.reason:"",/no longer reproduces/);
});
test("a non-reproducing second red and a changed parent both hold",async t=>{
 const f=fixture(t);
 for(const phase of["reproduce-2","parent"]){
  const result=await attribute(f.batch,r=>{
   const out=f.gate(r);if(!r.invocation.endsWith(":"+phase)||out.kind==="hold")return out;
   return phase==="parent"?{...out,kind:"verdict",failed:["memory"]}:{...out,kind:"green"};
  });assert.equal(result.kind,"held",phase);
 }
});
for(const invalid of["host","canonical","invocation","fresh","scope","bare exit","same run"])test(`${invalid} evidence fails closed`,async t=>{
 const f=fixture(t),result=await attribute(f.batch,r=>{
  const out=f.gate(r);if(out.kind==="hold"||!r.invocation.endsWith(":reproduce-2"))return out;
  if(invalid==="host")return{...out,host:"other-host"};
  if(invalid==="canonical")return{...out,canonical:false};
  if(invalid==="invocation")return{...out,invocation:"stale-invocation"};
  if(invalid==="fresh")return{...out,fresh:false};
  if(invalid==="scope")return{...out,steps:[]};
  if(invalid==="bare exit")return{exit:1}as unknown as Outcome;
  const first=`${f.batch.id}:${Number(r.invocation.split(":")[1])-1}:reproduce-1`;
  return{...out,run:`run-${first}`};
 });assert.equal(result.kind,"held",invalid);
});
test("an execution exception is an instrument hold",async t=>{
 const f=fixture(t),result=await attribute(f.batch,()=>{throw new Error("manager disconnected");});assert.equal(result.kind,"held");if(result.kind==="held")assert.equal(result.category,"instrument");
});
test("a malformed or cyclic frozen range holds before running a gate",async t=>{
 const f=fixture(t);
 for(const landings of [[f.batch.landings[0],{...f.batch.landings[1],tip:f.batch.base},f.batch.landings[2]],[f.batch.landings[0],{...f.batch.landings[1],id:f.batch.landings[0].id},f.batch.landings[2]]]){
  const result=await attribute({...f.batch,landings},()=>assert.fail("invalid ranges must not run"));assert.equal(result.kind,"held");assert.equal(result.attempts.length,0);
 }
});
