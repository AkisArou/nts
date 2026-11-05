// land.ts tests: ledger. The shared fixture is land-test-fixture.ts;
// see its header for how the stand-in gate and scratch repositories work.

import { heldLandings } from "./held-landings.ts";
import { queuedLandings } from "./landing-state.ts";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after } from "node:test";
import assert from "node:assert/strict";
import { readLedger } from "./verification-ledger.ts";
import { GateResource } from "./gate-resource.ts";
import { STANDING_GATE_POLICY } from "../gate/verdict-policy.ts";
import { LAND, gates, land, lane, onMain, run, scratch, spawnTest, states, test, until, type Landed } from "./land-test-fixture.ts";

test("a strict landing journals its own range and author without an optimistic path", async () => {
  const s = scratch(), tree = lane(s, "tsrs/ledger-proof", {"one.txt":"one\n"});
  s.env.NTS_LAND_AUTHOR_BRANCH="compiler/stale-inherited-context";
  const tip = run(s,tree,["rev-parse","HEAD"]);
  const result = await land(s,tree).done;
  assert.equal(result.status,0,result.out);
  assert.equal(gates(s),1);
  const saved=readLedger(join(s.home,".cache/nts-land/verification"))!;
  assert.equal(saved.mode,"strict");
  assert.equal(saved.verified.tip,tip);
  assert.equal(saved.transactions[0].kind,"strict");
  assert.equal(saved.transactions[0].state,"committed");
  assert.deepEqual(saved.transactions[0].entries[0].commits,[tip]);
  assert.equal(saved.transactions[0].entries[0].author.lane,"tsrs");
  const runs=join(s.home,".cache/nts-land/runs");
  const actual=readFileSync(join(runs,readdirSync(runs)[0],"test-accepted-skips"),"utf8");
  assert.equal(actual,STANDING_GATE_POLICY.NTS_GATE_ACCEPT_SKIP);
  assert.equal(actual,"on-device");
});

test("a failed post-FF ledger write reports the real landing and recovers on restart", async () => {
  const s = scratch(), tree = lane(s,"ledger-restart",{"one.txt":"one\n"});
  const tip=run(s,tree,["rev-parse","HEAD"]), directory=join(s.home,".cache/nts-land/verification");
  const hook=join(s.root,".git/hooks/post-merge");
  writeFileSync(hook,`#!${process.execPath}\nrequire("node:fs").chmodSync(${JSON.stringify(directory)},0o500);\n`);chmodSync(hook,0o755);
  const first=await land(s,tree).done;
  chmodSync(directory,0o700);rmSync(hook);
  assert.equal(first.status,0,first.out);
  assert.match(first.out,/LANDED, but verification bookkeeping needs restart recovery/);
  assert.equal(run(s,s.root,["rev-parse","main"]),tip);
  assert.equal(readLedger(directory)!.transactions[0].state,"prepared");
  const next=lane(s,"after-ledger-restart",{"two.txt":"two\n"});
  const second=await land(s,next).done;
  assert.equal(second.status,0,second.out);
  const saved=readLedger(directory)!;
  assert.equal(saved.transactions.length,2);
  assert.ok(saved.transactions.every(tx=>tx.state==="committed"));
  assert.equal(saved.verified.tip,run(s,s.root,["rev-parse","main"]));
});

test("two concurrent submissions of one commit publish one pending entry and one disposition",async()=>{
  const s=scratch(),tree=lane(s,"duplicate-admission",{a:"green\n"}),state=join(s.home,".cache/nts-land");
  const lock=GateResource.tryAcquire(join(s.home,".cache/nts-land.lock"));assert.ok(lock);
  let first:ReturnType<typeof land>,second:ReturnType<typeof land>;
  const completed:Landed[]=[];
  try {
    first=land(s,tree);second=land(s,tree);
    void first.done.then(r=>completed.push(r));void second.done.then(r=>completed.push(r));
    await until("one final pending record and the duplicate refusal",()=>completed.length===1&&(!!first.record()||!!second.record()));
    assert.equal(completed[0].status,1,completed[0].out);
    const entry=first.record()??second.record()!;assert.match(completed[0].out,new RegExp(`already pending as ${entry.id}`));
    assert.equal(queuedLandings(state).length,1);
  }finally{lock.close();}
  const results=await Promise.all([first!.done,second!.done]);assert.equal(results.filter(r=>r.status===0).length,1,JSON.stringify(results));
  assert.equal(states(s).length,1);assert.equal(gates(s),1);assert.ok(onMain(s,"a"));
});

test("a legacy duplicate that adds no commits is excluded before the verification ledger exists",async()=>{
  const s=scratch(),tree=lane(s,"legacy-duplicate",{a:"green\n"}),state=join(s.home,".cache/nts-land");
  const lock=GateResource.tryAcquire(join(s.home,".cache/nts-land.lock"));assert.ok(lock);
  let client:ReturnType<typeof land>;
  try {
    client=land(s,tree);await until("the original completed queue record",()=>!!client.record());
    const entry=JSON.parse(readFileSync(join(state,"pending",client.record()!.id+".json"),"utf8"));
    mkdirSync(join(state,"queue"),{recursive:true});writeFileSync(join(state,"queue/9999999999999-1.json"),JSON.stringify({...entry,id:"9999999999999-1",at:entry.at+1}));
  }finally{lock.close();}
  const result=await client!.done;assert.equal(result.status,0,result.out);
  await until("the empty replay's disposition",()=>states(s).length===2);
  assert.ok(states(s).some(r=>r.state==="conflict"&&/adds no commits.*already contained/.test(r.message)),JSON.stringify(states(s)));
  assert.equal(gates(s),1);assert.equal(readLedger(join(state,"verification"))!.transactions[0].entries.length,1);
});

for(const mode of ["throw","crash"] as const)test(`a post-green ledger ${mode} holds the members across restart with exactly one gate directory`,async()=>{
  const s=scratch(),state=join(s.home,".cache/nts-land"),trigger=join(s.home,"fail-ledger"),preload=join(s.home,"ledger-fault.ts");
  writeFileSync(trigger,"armed");
  writeFileSync(preload,`import fs from 'node:fs';import {syncBuiltinESMExports}from'node:module';const write=fs.writeFileSync;fs.writeFileSync=function(...args){const text=typeof args[1]==='string'?args[1]:'';if(process.env.NTS_LAND_TRAIN_UNIT&&fs.existsSync(${JSON.stringify(trigger)})&&text.includes('"kind": "strict"')&&text.includes('"state": "prepared"')){fs.unlinkSync(${JSON.stringify(trigger)});${mode==='crash'?'process.exit(73);':'throw Error("injected post-green ledger failure");'}}return write.apply(this,args);};syncBuiltinESMExports();`);
  s.env.NODE_OPTIONS=`--import=${preload}`;
  const tree=lane(s,"post-green-failure",{a:"green\n"}),client=land(s,tree),base=run(s,s.root,["rev-parse","main"]);
  await until("the post-green hold",()=>heldLandings(state).length===1,{stopped:()=>client.child.exitCode===null?undefined:`client exited ${client.child.exitCode} instead of holding its green train; gate runs ${gates(s)}`});
  const held=heldLandings(state)[0];assert.match(held.batch.reason,/post-green/);assert.equal(run(s,s.root,["rev-parse","main"]),base);assert.equal(states(s).length,0);
  const owner=JSON.parse(readFileSync(join(state,"train-owner.json"),"utf8"));
  assert.equal(spawnTest("systemctl",["--user","stop",owner.unit],{encoding:"utf8"}).status,0);
  const next=land(s,lane(s,"after-post-green",{b:"green\n"})),result=await next.done;assert.equal(result.status,0,result.out);
  assert.equal(gates(s),2,"one frozen gate and one unrelated landing, no baseline, half or replay");
  const runs=readdirSync(join(state,"runs")).filter(name=>name.startsWith(held.batch.tip.slice(0,12)+"-"));assert.equal(runs.length,1,JSON.stringify(runs));
  assert.equal(heldLandings(state).length,1);assert.ok(!onMain(s,"a")&&onMain(s,"b"));
  const resolution=spawnTest(process.execPath,[LAND,"--refuse-held",held.entry.id,"--because=control completed"],{cwd:s.root,env:s.env,encoding:"utf8"});assert.equal(resolution.status,0,resolution.stderr);
  assert.equal((await client.done).status,1);
});

test("a post-FF process crash finishes the recorded green landing without another gate",async()=>{
  const s=scratch(),state=join(s.home,".cache/nts-land"),trigger=join(s.home,"crash-commit"),preload=join(s.home,"commit-crash.ts");
  writeFileSync(trigger,"armed");
  writeFileSync(preload,`import fs from 'node:fs';import {syncBuiltinESMExports}from'node:module';const write=fs.writeFileSync;fs.writeFileSync=function(...args){const text=typeof args[1]==='string'?args[1]:'';if(process.env.NTS_LAND_TRAIN_UNIT&&fs.existsSync(${JSON.stringify(trigger)})&&text.includes('"kind": "strict"')&&text.includes('"transition": "committed"')){fs.unlinkSync(${JSON.stringify(trigger)});process.exit(73);}return write.apply(this,args);};syncBuiltinESMExports();`);
  s.env.NODE_OPTIONS=`--import=${preload}`;
  const tree=lane(s,"post-FF-crash",{a:"green\n"}),tip=run(s,tree,["rev-parse","HEAD"]),result=await land(s,tree).done;
  assert.equal(result.status,0,result.out);assert.equal(existsSync(trigger),false,"the post-FF crash was exercised");assert.equal(gates(s),1);assert.equal(run(s,s.root,["rev-parse","main"]),tip);
  assert.equal(readdirSync(join(state,"runs")).filter(name=>name.startsWith(tip.slice(0,12)+"-")).length,1);
  assert.equal(readLedger(join(state,"verification"))!.transactions[0].state,"committed");assert.equal(heldLandings(state).length,0);
});

test("an unwritable verification journal holds the submission until recovery", async () => {
  const s=scratch(), tree=lane(s,"ledger-unavailable",{"change":"one\n"});
  const base=run(s,s.root,["rev-parse","main"]);
  const directory=join(s.home,".cache/nts-land");mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,"verification"),"this is not a directory");
  const pending=land(s,tree),state=join(directory,"status.json");
  try {
    await until("the verification journal hold",()=>existsSync(state)&&JSON.parse(readFileSync(state,"utf8")).resource==="verification-ledger");
    assert.equal(run(s,s.root,["rev-parse","main"]),base);
    assert.equal(readdirSync(join(directory,"pending")).length,1);
    assert.equal(gates(s),0);
  }finally{rmSync(join(directory,"verification"),{force:true});}
  const result=await pending.done;
  assert.equal(result.status,0,result.out);assert.equal(gates(s),1);
});

test("recovering an answered legacy entry preserves its result bytes and original train",async()=>{
  const s=scratch(),base=run(s,s.root,["rev-parse","HEAD"]),store=join(s.home,".cache/nts-land"),id="1-1";
  mkdirSync(join(store,"queue"),{recursive:true});mkdirSync(join(store,"results"));
  writeFileSync(join(store,"queue",id+".json"),JSON.stringify({id,sha:base,pid:process.pid,tree:s.root,at:1}));
  const path=join(store,"results",id+".json"),original=JSON.stringify({state:"landed",message:"legacy proof",landing:base,main:base,trainUnit:"original-unit",trace:"original-trace"},null,4)+"\n";writeFileSync(path,original);
  const result=await land(s,lane(s,"after-legacy-answer",{a:"green\n"})).done;assert.equal(result.status,0,result.out);
  assert.equal(readFileSync(path,"utf8"),original);assert.equal(existsSync(join(store,"queue",id+".json")),false);
});
