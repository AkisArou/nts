// land.ts tests: service. The shared fixture is land-test-fixture.ts;
// see its header for how the stand-in gate and scratch repositories work.

import { heldLandings, prepareHeldResolution } from "./held-landings.ts";
import { queuedLandings } from "./landing-state.ts";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after } from "node:test";
import assert from "node:assert/strict";
import { cpuList, inheritedCpus } from "../gate/affinity.ts";
import { GateResource } from "./gate-resource.ts";
import { LAND, STAND_IN_GATE, cleanupFixtures, controls, frozenBarrier, gates, land, landTogether, lane, onMain, queuedForUnit, reportContext, run, scratch, serviceSubmission, spawnTest, states, test, until } from "./land-test-fixture.ts";

test("selector infrastructure holds the train with all submissions still queued",async()=>{
 const s=scratch(),a=lane(s,"selector-hold-a",{a:"a\n"}),b=lane(s,"selector-hold-b",{b:"b\n"}),c=lane(s,"selector-hold-c",{c:"c\n"});
 const actual=spawnTest("sh",["-c","command -v git"],{encoding:"utf8"}).stdout.trim(),bin=join(s.home,"bin"),go=join(s.home,"selector-ready");mkdirSync(bin);
 const quote=(v:string)=>"'"+v.replaceAll("'","'\\''")+"'";
 writeFileSync(join(bin,"git"),`#!/bin/sh
if [ "\${NTS_LAND_LOCKED:-}" = 1 ] && [ "$1" = worktree ] && [ "$2" = add ]; then
 case "$*" in *nts-owed-range*) if [ ! -f ${quote(go)} ]; then echo 'range checkout resource unavailable' >&2; exit 75; fi;; esac
fi
exec ${quote(actual)} "$@"
`);chmodSync(join(bin,"git"),0o755);s.env.PATH=`${bin}:${s.env.PATH}`;
 const results=landTogether(s,[a,b,c]);
 try {
  const state=join(s.home,".cache/nts-land/status.json");
  await until("the selector infrastructure hold",()=>existsSync(state)&&JSON.parse(readFileSync(state,"utf8")).resource==="selector");
  assert.equal(readdirSync(join(s.home,".cache/nts-land/pending")).filter(n=>n.endsWith(".json")).length,3);
  assert.equal(gates(s),0);
 }finally{writeFileSync(go,"restored\n");}
 for(const result of await results)assert.equal(result.status,0,result.out);
 assert.equal(gates(s),1);
 for(const path of ["a","b","c"])assert.ok(onMain(s,path));
});
test("the service bootstrap gates only its own immutable submission before using main",async()=>{
  const s=scratch(),service=readFileSync(join(s.root,"tooling/lanes/train-service.ts"),"utf8");
  run(s,s.root,["rm","tooling/lanes/train-service.ts"]);run(s,s.root,["commit","-qm","main before the service"]);
  const a=lane(s,"bootstrap",{"tooling/lanes/train-service.ts":service,a:"own\n"}),b=lane(s,"after-bootstrap",{b:"later\n"});
  const own=run(s,a,["rev-parse","HEAD"]);
  for(const result of await landTogether(s,[a,b]))assert.equal(result.status,0,result.out);
  assert.equal(gates(s),2);
  const first=readFileSync(s.gates,"utf8").trim().split("\n")[0].trim();assert.equal(first,own);
  assert.equal(spawnTest("git",["cat-file","-e",`${first}:b`],{cwd:s.root,env:s.env}).status,128);
  assert.ok(onMain(s,"a")&&onMain(s,"b"));
});

test("stopping a submission service cannot kill its frozen train or the other member", async()=>{
  const s=scratch(),barrier=frozenBarrier(s);
  const a=lane(s,"service-a",{a:"green\n"}),b=lane(s,"service-b",{b:"green\n"});
  const lock=GateResource.tryAcquire(join(s.home,".cache/nts-land.lock"));assert.ok(lock);
  let first:string;
  try {
    first=serviceSubmission(s,a);const second=serviceSubmission(s,b);
    await until("both durable final records",()=>[first,second].every(unit=>queuedForUnit(s,unit)!==undefined));
  } finally {lock.close();}
  await until("the frozen train",()=>existsSync(barrier.entered));
  const status=JSON.parse(readFileSync(join(s.home,".cache/nts-land/status.json"),"utf8"));
  assert.match(status.holder_unit,/^nts-test-land-train-/);assert.equal(status.train.length,2);assert.notEqual(status.holder_unit,first!);
  for(const unit of [first!,status.holder_unit]){
    const pid=Number(spawnTest("systemctl",["--user","show",unit,"--property=MainPID","--value"],{encoding:"utf8"}).stdout.trim());
    assert.ok(pid>0,unit);const cpus=cpuList(inheritedCpus(pid));
    assert.ok(cpus.every(cpu=>cpu!==4&&cpu!==5),`${unit}: ${cpus.join(",")}`);
  }
  const stopped=spawnTest("systemctl",["--user","stop",first!],{encoding:"utf8"});assert.equal(stopped.status,0,stopped.stderr);
  const requested=spawnTest(process.execPath,[LAND,"--withdraw",run(s,a,["rev-parse","HEAD"])],{cwd:s.root,env:s.env,encoding:"utf8"});assert.equal(requested.status,0,requested.stderr);
  writeFileSync(barrier.release,"continue");
  await until("both frozen dispositions",()=>states(s).length===2);
  assert.ok(states(s).every(result=>result.state==="landed"),JSON.stringify(states(s)));
  assert.equal(gates(s),1);assert.ok(onMain(s,"a")&&onMain(s,"b"));
  await until("the leader to retire answered entries",()=>readdirSync(join(s.home,".cache/nts-land/pending")).length===0);
  assert.deepEqual(readdirSync(join(s.home,".cache/nts-land/pending")),[],"answers remove entries without waiting for their submitters");
});
test("a restarted service re-gates frozen members before composing a late arrival",async()=>{
  const s=scratch(),barrier=frozenBarrier(s),a=lane(s,"restart-a",{a:"green\n"}),b=lane(s,"restart-b",{b:"green\n"}),c=lane(s,"restart-c",{c:"green\n"});
  const lock=GateResource.tryAcquire(join(s.home,".cache/nts-land.lock"));assert.ok(lock);
  const submitters:string[]=[];
  try {submitters.push(serviceSubmission(s,a),serviceSubmission(s,b));await until("two restart final records",()=>submitters.every(unit=>queuedForUnit(s,unit)!==undefined));} finally {lock.close();}
  await until("first frozen run",()=>existsSync(barrier.entered));
  const owner=JSON.parse(readFileSync(join(s.home,".cache/nts-land/train-owner.json"),"utf8"));
  submitters.push(serviceSubmission(s,c));
  await until("late arrival final record",()=>queuedForUnit(s,submitters.at(-1)!)!==undefined);
  for(const unit of submitters){const stopped=spawnTest("systemctl",["--user","stop",unit],{encoding:"utf8"});assert.equal(stopped.status,0,stopped.stderr);}
  const stop=spawnTest("systemctl",["--user","kill","--kill-whom=all","--signal=SIGKILL",owner.unit],{encoding:"utf8"});assert.equal(stop.status,0,stop.stderr);
  writeFileSync(barrier.release,"continue");
  await until("all recovered dispositions",()=>states(s).length===3);
  assert.ok(states(s).every(result=>result.state==="landed"),JSON.stringify(states(s)));
  const pins=readFileSync(s.gates,"utf8").trim().split("\n").map(line=>line.split(" ")[0]);
  assert.equal(pins.length,3);assert.equal(pins[0],pins[1],"the interrupted train is re-gated at its frozen tip");
  assert.equal(spawnTest("git",["cat-file","-e",`${pins[1]}:c`],{cwd:s.root,encoding:"utf8"}).status,128,"the late member is not smuggled into recovery");
  assert.ok(onMain(s,"a")&&onMain(s,"b")&&onMain(s,"c"));
});

test("a failed fixture stops and reaps its polling clients before removing their roots",async()=>{
  const s=scratch(),tree=lane(s,"aborted-client",{a:"green\n"}),lock=GateResource.tryAcquire(join(s.home,".cache/nts-land.lock"))!;
  const pending=land(s,tree);
  try{
    await until("the client final record before deliberate fixture failure",()=>pending.record()!==undefined);
    try{throw new Error("deliberate fixture assertion failure");}catch(error){assert.match(String(error),/deliberate fixture/);}finally{await cleanupFixtures();}
    const result=await pending.done;assert.doesNotMatch(result.out,/LANDED/);assert.notEqual(pending.child.exitCode,null);
    assert.equal(existsSync(s.root),false);
    const state=spawnTest("systemctl",["--user","show",pending.unit,"--property=ActiveState","--value"],{encoding:"utf8"}).stdout.trim();
    assert.ok(!["active","activating","deactivating"].includes(state),state);
  }finally{lock.close();}
});

test("legacy queue records and durable submissions share one service without changing the legacy format",async()=>{
  const s=scratch(),barrier=frozenBarrier(s),a=lane(s,"migration-a",{a:"green\n"}),b=lane(s,"migration-b",{b:"green\n"});
  serviceSubmission(s,a);await until("the first migration train",()=>existsSync(barrier.entered));
  const store=join(s.home,".cache/nts-land"),queue=join(store,"pending"),held=join(s.home,"publication-held"),fifo=join(s.home,"publish-record");
  assert.equal(spawnTest("mkfifo",[fifo],{encoding:"utf8"}).status,0);
  const preload=join(s.home,"hold-publication.ts");
  writeFileSync(preload,`import fs from 'node:fs';import {syncBuiltinESMExports}from'node:module';const rename=fs.renameSync;fs.renameSync=function(from,to){if(!process.env.NTS_LAND_TRAIN_UNIT&&String(to).includes('/pending/')){fs.writeFileSync(${JSON.stringify(held)},String(from));fs.readFileSync(${JSON.stringify(fifo)});}return rename.call(this,from,to);};syncBuiltinESMExports();`);
  s.env.NODE_OPTIONS=`--import=${preload}`;
  const pending=land(s,b);
  await until("the pending record before its atomic publication",()=>existsSync(held),{stopped:()=>pending.child.exitCode===null?undefined:`client exited ${pending.child.exitCode}`});
  const temporary=readFileSync(held,"utf8");
  try{
    assert.equal(readdirSync(queue).length,2,"the old raw count is satisfied by one unpublished temporary");
    assert.equal(pending.record(),undefined,"a temporary is never a completed submission");
  }finally{writeFileSync(fifo,"publish");}
  await until("the specific completed migration record",()=>pending.record()!==undefined);
  assert.throws(()=>readFileSync(temporary,"utf8"),{code:"ENOENT"},"the old raw-name reader races with rename");
  const entry={...pending.record()!};delete entry.durable;delete entry.unit;const name=entry.id+".json";
  mkdirSync(join(store,"queue"),{recursive:true});writeFileSync(join(store,"queue",name),JSON.stringify(entry));rmSync(join(queue,name));
  writeFileSync(barrier.release,"continue");
  const result=await pending.done;assert.equal(result.status,0,result.out);
  await until("both migrated dispositions",()=>states(s).length===2);
  assert.equal(gates(s),2);assert.equal(readdirSync(join(store,"queue")).length,0);
  assert.ok(onMain(s,"a")&&onMain(s,"b"));
});
test("a lander change refreshes the controller from main before the next train",async()=>{
  const s=scratch(),versions=join(s.home,"controller-versions"),file=join(s.root,"tooling/lanes/land.ts");
  writeFileSync(file,readFileSync(file,"utf8").replace('const argv = process.argv.slice(2);',`const argv = process.argv.slice(2);if(argv.includes('--train-worker'))appendFileSync(${JSON.stringify(versions)},'version-one\\n');`));
  run(s,s.root,["add","tooling/lanes/land.ts"]);run(s,s.root,["commit","-qm","controller version one"]);
  const barrier=frozenBarrier(s),a=lane(s,"upgrade-a",{"tooling/lanes/land.ts":readFileSync(file,"utf8").replace('version-one','version-two')}),b=lane(s,"upgrade-b",{b:"green\n"});
  serviceSubmission(s,a);await until("upgrade train started",()=>existsSync(barrier.entered));const second=serviceSubmission(s,b);
  await until("post-upgrade final record",()=>queuedForUnit(s,second)!==undefined);
  const initialOwner=JSON.parse(readFileSync(join(s.home,".cache/nts-land/train-owner.json"),"utf8")),upgrade=run(s,a,["rev-parse","HEAD"]);
  run(s,s.root,["update-ref",`refs/archive/land-trains/${initialOwner.id}-${upgrade}`,upgrade]);
  writeFileSync(barrier.release,"continue");
  await until("both upgraded dispositions",()=>states(s).length===2);
  const lines=readFileSync(versions,"utf8").trim().split("\n");assert.equal(lines[0],"version-one");assert.ok(lines.includes("version-two"),lines.join(" "));assert.equal(gates(s),2);
  const owner=JSON.parse(readFileSync(join(s.home,".cache/nts-land/train-owner.json"),"utf8"));assert.equal(run(s,s.root,["show",`${owner.sha}:tooling/lanes/land.ts`]).includes("version-two"),true);
});

test("a hung legacy train holds only its members, releases both locks and resolves through real operator actions",async()=>{
  const s=scratch(),state=join(s.home,".cache/nts-land"),allow=join(s.home,"allow-measurement");
  writeFileSync(join(s.root,"tooling/gate/pinned.sh"),controls(s,STAND_IN_GATE+reportContext+`
if [ -e "$NTS_GATE_TREE/HUNG" ] && [ ! -e '${allow}' ]; then
 node - "$NTS_GATE_RUN_DIR/summary.json" <<'HUNG'
const fs=require('node:fs'),file=process.argv[2],summary=JSON.parse(fs.readFileSync(file));
summary.verdict='red';summary.steps[0]={...summary.steps[0],verdict:'NOT RUN',reason:'fixture file NOT RUN (hung)',instrument:{kind:'hung'}};
fs.writeFileSync(file,JSON.stringify(summary));
HUNG
 exit 2
fi
`));
  run(s,s.root,["add","tooling/gate/pinned.sh"]);run(s,s.root,["commit","-qm","hung stand-in"]);
  const a=lane(s,"hung-a",{HUNG:"held\n"}),b=lane(s,"hung-b",{b:"held peer\n"}),c=lane(s,"unrelated",{c:"green\n"});
  const stack=join(s.home,"Projects/nts-lanes/held-stack");
  run(s,s.root,["worktree","add","-qb","held-stack",stack,run(s,a,["rev-parse","HEAD"])]);
  writeFileSync(join(stack,"stack"),"dependent\n");run(s,stack,["add","stack"]);run(s,stack,["commit","-qm","stack"]);
  const lock=GateResource.tryAcquire(join(s.home,".cache/nts-land.lock"));assert.ok(lock);let first:ReturnType<typeof land>,second:ReturnType<typeof land>,legacyId:string;
  try {
    first=land(s,a);second=land(s,b);
    await until("two completed initial queue records",()=>!!first.record()&&!!second.record());
    const entry=first.record()!;legacyId=entry.id;const pending=join(state,"pending",entry.id+".json");
    const legacy={...JSON.parse(readFileSync(pending,"utf8"))};delete legacy.durable;delete legacy.unit;
    mkdirSync(join(state,"queue"),{recursive:true});writeFileSync(join(state,"queue",entry.id+".json"),JSON.stringify(legacy));rmSync(pending);
  }finally{lock.close();}
  await until("the durable held batch",()=>heldLandings(state).length===2);
  const held=heldLandings(state);
  assert.equal(gates(s),1);assert.equal(states(s).length,0,"incomplete measurement never answers a member");
  assert.equal(existsSync(join(state,"queue",legacyId!+".json")),false,"the legacy store cannot re-gate a held member");
  const third=land(s,c),dependent=land(s,stack);
  const thirdResult=await third.done;assert.equal(thirdResult.status,0,thirdResult.out);
  await until("the held prerequisite blocks its descendant",()=>!!dependent.record()&&existsSync(join(state,"held-dependencies",dependent.record()!.id+".json")));
  await until("the service retires with only held work",()=>JSON.parse(readFileSync(join(state,"train-owner.json"),"utf8")).phase==="retiring");
  await until("both locks actually released after idle retirement",()=>{
    const gate=GateResource.tryAcquire(join(s.home,".cache/nts-parallel-20261004/mainctl/gate-tree.lock"));if(!gate)return false;
    try{const landing=GateResource.tryAcquire(join(s.home,".cache/nts-land.lock"));if(!landing)return false;landing.close();return true;}finally{gate.close();}
  });
  const view=queuedLandings(state);assert.equal(view.filter(row=>row.hold?.state==="held").length,3);
  const heldA=held.find(row=>row.entry.sha===run(s,a,["rev-parse","HEAD"]))!,heldB=held.find(row=>row!==heldA)!;
  // Simulate a crash after the durable retry intent but before queue effects.
  prepareHeldResolution(state,heldA.batch.id,heldA.entry.id,"retry","operator retried");
  writeFileSync(join(state,"frozen-train.json"),JSON.stringify({version:1,phase:"running",entries:heldA.batch.entries,composition:{tip:heldA.batch.tip,generation:heldA.batch.generation}}));
  writeFileSync(allow,"recovered\n");
  const retry=spawnTest(process.execPath,[LAND,"--retry-held",`${heldA.batch.id}:${heldA.entry.id}`,"--because=operator retried"],{cwd:s.root,env:s.env,encoding:"utf8"});
  assert.equal(retry.status,0,retry.stderr);
  const refuse=spawnTest(process.execPath,[LAND,"--refuse-held",`${heldB.batch.id}:${heldB.entry.id}`,"--because=operator declined"],{cwd:s.root,env:s.env,encoding:"utf8"});
  assert.equal(refuse.status,0,refuse.stderr);
  const [resultA,resultB,resultD]=await Promise.all([first!.done,second!.done,dependent.done]);
  assert.equal(resultA.status,0,resultA.out);assert.equal(resultD.status,0,resultD.out);
  assert.equal(resultB.status,1,resultB.out);assert.match(resultB.out,/operator declined/);
  assert.ok(onMain(s,"HUNG")&&onMain(s,"stack")&&onMain(s,"c"));assert.equal(onMain(s,"b"),false);
  assert.equal(gates(s),3,"one hung train, unrelated train, and retried stack; no baseline or halves");
  assert.equal(heldLandings(state).length,0);
  const replay=spawnTest(process.execPath,[LAND,"--refuse-held",`${heldB.batch.id}:${heldB.entry.id}`,"--because=operator declined"],{cwd:s.root,env:s.env,encoding:"utf8"});
  assert.equal(replay.status,0,replay.stderr);
});
