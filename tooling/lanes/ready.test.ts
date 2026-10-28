import{test}from"node:test";import assert from"node:assert/strict";
import{mkdtempSync,writeFileSync,rmSync}from"node:fs";import{tmpdir}from"node:os";import{join}from"node:path";
import{publishReady,removeReady,snapshotReady,type ReadyEntry}from"./ready.ts";
test("a ready snapshot is complete, ordered and unaffected by later publication",t=>{
 const dir=mkdtempSync(join(tmpdir(),"ready-test-"));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const entry=(n:number):ReadyEntry=>({version:1,id:`ready-${n}`,sha:"a".repeat(40),tree:"private",pid:process.pid,at:n,proof:{base:"b".repeat(40),tip:"c".repeat(40),checked:"checked",run:"run",author:{lane:"coordinator",address:null}}});
 publishReady(dir,entry(2));publishReady(dir,entry(1));writeFileSync(join(dir,"ready-partial.json.tmp"),"{");
 const snapshot=snapshotReady(dir);publishReady(dir,entry(3));
 assert.deepEqual(snapshot.map(e=>e.id),["ready-1","ready-2"]);
 assert.deepEqual(snapshotReady(dir).map(e=>e.id),["ready-1","ready-2","ready-3"]);
 removeReady(dir,"ready-2");assert.equal(snapshotReady(dir).length,2);
 writeFileSync(join(dir,"ready-bad.json"),"{}");assert.throws(()=>snapshotReady(dir),/invalid ready entry/);
});
