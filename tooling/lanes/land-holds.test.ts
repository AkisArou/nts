// land.ts tests: holds. The shared fixture is land-test-fixture.ts;
// see its header for how the stand-in gate and scratch repositories work.

import { heldLandings } from "./held-landings.ts";
import { waitFor } from "../gate/test-wait.ts";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { LAND, STAND_IN_GATE, controls, gates, land, landTogether, lane, onMain, reportContext, resourceGate, run, scratch, spawnTest, states, test, until } from "./land-test-fixture.ts";

for(const mode of ["candidate-red","both-red","mixed"] as const)test(`resource comparison actual train: ${mode}`,async()=>{
  const s=scratch();resourceGate(s,mode);
  const tree=lane(s,`tsrs/${mode}`,{CANDIDATE:"candidate\n"}),result=await land(s,tree).done;
  assert.equal(result.status,1,result.out);
  const scopes=readFileSync(s.gates+".scopes","utf8").trim().split("\n").map(line=>JSON.parse(line));
  assert.equal(scopes.length,mode==="mixed"?2:3,"definite failures retain the baseline-only path");
  assert.equal(scopes[0].requested.length,41);
  assert.deepEqual(scopes.slice(1).map(row=>row.requested),Array(scopes.length-1).fill(["resource-c","resource-llvm"]));
  if(mode==="both-red")assert.match(result.out,/red on main/);
  else assert.equal(onMain(s,"CANDIDATE"),false);
});

test("resource recheck both-pass holds, then operator retry measures only two steps and carries 39",async()=>{
  const s=scratch();resourceGate(s,"both-pass");
  const tree=lane(s,"tsrs/resource-hold",{CANDIDATE:"candidate\n"}),pending=land(s,tree),state=join(s.home,".cache/nts-land");
  await until("the resource-only hold",()=>heldLandings(state).length===1);
  const held=heldLandings(state)[0];assert.deepEqual(held.batch.retry?.steps,["resource-c","resource-llvm"]);
  assert.equal(states(s).length,0,"a passing pair never publishes green");assert.equal(gates(s),3);
  const retry=spawnTest(process.execPath,[LAND,"--retry-held",`${held.batch.id}:${held.entry.id}`,"--because=paired load cleared"],{cwd:s.root,env:s.env,encoding:"utf8"});
  assert.equal(retry.status,0,retry.stderr);
  const result=await pending.done;assert.equal(result.status,0,result.out);
  const scopes=readFileSync(s.gates+".scopes","utf8").trim().split("\n").map(line=>JSON.parse(line));
  assert.equal(scopes.length,4);assert.deepEqual(scopes[3].requested,["resource-c","resource-llvm"]);
  const runs=join(state,"runs"),joined=readdirSync(runs).map(name=>JSON.parse(readFileSync(join(runs,name,"summary.json"),"utf8"))).find(row=>row.verdict==="green"&&row.steps.length===41);
  assert.ok(joined);assert.equal(joined.attempts.length,2);assert.equal(new Set(joined.steps.slice(0,39).map(row=>row.evidence_run)).size,1);
  assert.notEqual(joined.steps[0].evidence_run,joined.steps[39].evidence_run);assert.ok(onMain(s,"CANDIDATE"));
});

test("resource recheck with mismatched budgets holds without attribution",async()=>{
  const s=scratch();resourceGate(s,"mismatch");const tree=lane(s,"tsrs/resource-mismatch",{CANDIDATE:"candidate\n"});
  const pending=land(s,tree),state=join(s.home,".cache/nts-land");
  await until("the unmatched pair hold",()=>heldLandings(state).length===1);
  const held=heldLandings(state)[0];assert.match(held.batch.reason,/budget/);assert.equal(gates(s),3);assert.equal(states(s).length,0);
  const refused=spawnTest(process.execPath,[LAND,"--refuse-held",`${held.batch.id}:${held.entry.id}`,"--because=retain mismatch evidence"],{cwd:s.root,env:s.env,encoding:"utf8"});
  assert.equal(refused.status,0,refused.stderr);assert.equal((await pending.done).status,1);
});

test("a pressure-only train holds its members and retries the frozen step without baseline or halving", async () => {
  const s = scratch();
  const once = join(s.home, "pressure-once");
  writeFileSync(join(s.root, "tooling/gate/pinned.sh"), controls(s, STAND_IN_GATE + reportContext + `
node - "$NTS_GATE_RUN_DIR/summary.json" <<'PRESSURE'
const fs=require("node:fs"),file=process.argv[2],once=${JSON.stringify(once)},summary=JSON.parse(fs.readFileSync(file));
if(!fs.existsSync(once)) {
 fs.writeFileSync(once,"first attempt");
 summary.verdict="red";
 summary.steps[0]={...summary.steps[0],verdict:"INSTRUMENT",reason:"system memory pressure; not a case verdict",instrument:{kind:"memory-pressure"}};
 fs.writeFileSync(file,JSON.stringify(summary));
 fs.writeFileSync(once+".summary",fs.readFileSync(file));
 process.exitCode=1;
}
PRESSURE
`));
  run(s, s.root, ["add", "tooling/gate/pinned.sh"]); run(s, s.root, ["commit", "-q", "-m", "pressure stand-in"]);
  const a = lane(s, "pressure-a", { "a.txt": "a\n" }), b = lane(s, "pressure-b", { "b.txt": "b\n" });
  const results = await landTogether(s, [a, b]);
  for (const result of results) assert.equal(result.status, 0, result.out);
  const output = results.map(result => result.out).join("\n");
  assert.match(output, /instrument hold .*same frozen train, no baseline check or halving/);
  assert.doesNotMatch(output, /checking failed steps on main|gating its first half/);
  assert.equal(gates(s), 2, "one original train plus one pressure retry, no baseline or half");
  const pins = readFileSync(s.gates, "utf8").trim().split("\n").map(line => line.split(" ")[0]);
  assert.equal(pins[0], pins[1], "both attempts use the exact frozen train");
  assert.ok(onMain(s, "a.txt") && onMain(s, "b.txt"));
  const directory = join(s.home, ".cache/nts-land/runs");
  const runDir = join(directory, readdirSync(directory)[0]);
  const composite = JSON.parse(readFileSync(join(runDir, "summary.json"), "utf8"));
  assert.equal(composite.attempts.length, 2); assert.equal(composite.verdict, "green");
  assert.deepEqual(readFileSync(join(runDir, "summary.attempt-1.json")), readFileSync(once + ".summary"), "original summary bytes are preserved");
  assert.equal(JSON.parse(readFileSync(join(runDir, "summary.attempt-1.json"), "utf8")).steps[0].verdict, "INSTRUMENT");
});

test("a runaway train is held with its reason in lane status, never attributed or halved",async()=>{
  const s=scratch(),state=join(s.home,".cache/nts-land");
  writeFileSync(join(s.root,"tooling/gate/pinned.sh"),controls(s,STAND_IN_GATE+reportContext+`
if [ -e "$NTS_GATE_TREE/RUNAWAY" ]; then
node - "$NTS_GATE_RUN_DIR/summary.json" <<'RUNAWAY'
const fs=require('node:fs'),file=process.argv[2],summary=JSON.parse(fs.readFileSync(file));
summary.verdict='red';summary.steps[0]={...summary.steps[0],verdict:'NOT RUN',reason:'fixture command NOT RUN (runaway): used 2 CPU s',instrument:{kind:'runaway',verdict:'NOT RUN'}};
fs.writeFileSync(file,JSON.stringify(summary));
RUNAWAY
exit 2
fi
`));
  run(s,s.root,["add","tooling/gate/pinned.sh"]);run(s,s.root,["commit","-qm","runaway stand-in"]);
  const tree=lane(s,"runaway",{RUNAWAY:"busy\n",product:"unchanged until measured\n"}),client=land(s,tree);
  let ended;client.done.then(result=>{ended=result;});
  await waitFor("the runaway train's operator hold",()=>heldLandings(state).length===1,{stopped:()=>ended?`client ended ${ended.status}: ${ended.out}`:undefined});
  assert.equal(gates(s),1);assert.equal(states(s).length,0);assert.equal(onMain(s,"product"),false);
  const view=spawnTest(process.execPath,[new URL("./lane.ts",import.meta.url).pathname,"status","--json"],{cwd:s.root,env:s.env,encoding:"utf8"});
  assert.equal(view.status,0,view.stderr);const queued=JSON.parse(view.stdout).queue;
  assert.equal(queued.length,1);assert.equal(queued[0].hold.state,"held");assert.match(queued[0].hold.reason,/runaway.*2 CPU s/);
  const held=heldLandings(state)[0];
  const resolved=spawnTest(process.execPath,[LAND,"--refuse-held",`${held.batch.id}:${held.entry.id}`,"--because=runaway control complete"],{cwd:s.root,env:s.env,encoding:"utf8"});
  assert.equal(resolved.status,0,resolved.stderr);assert.equal((await client.done).status,1);assert.equal(gates(s),1);
});

test("an unmeasured baseline holds the frozen members without blaming main or halving",async()=>{
  const s=scratch(),state=join(s.home,".cache/nts-land");
  writeFileSync(join(s.root,"tooling/gate/pinned.sh"),controls(s,STAND_IN_GATE+reportContext+`
if [ ! -e "$NTS_GATE_TREE/RED" ]; then
 node - "$NTS_GATE_RUN_DIR/summary.json" <<'BASELINE'
const fs=require('node:fs'),file=process.argv[2],summary=JSON.parse(fs.readFileSync(file));summary.verdict='red';summary.steps[0]={...summary.steps[0],verdict:'INSTRUMENT',reason:'baseline tool unavailable',instrument:{kind:'tooling-setup'}};fs.writeFileSync(file,JSON.stringify(summary));
BASELINE
 exit 2
fi
`));
  run(s,s.root,["add","tooling/gate/pinned.sh"]);run(s,s.root,["commit","-qm","unmeasured baseline"]);
  const a=lane(s,"baseline-a",{RED:"actual assertion\n"}),b=lane(s,"baseline-b",{b:"green\n"});
  const results=landTogether(s,[a,b]);
  await until("baseline instrument hold",()=>heldLandings(state).length===2);
  assert.equal(states(s).length,0);assert.equal(gates(s),2,"one real red, one unavailable baseline, no half");
  assert.match(heldLandings(state)[0].batch.reason,/baseline not measured:.*baseline tool unavailable/);
  for(const row of heldLandings(state)){
    const r=spawnTest(process.execPath,[LAND,"--refuse-held",`${row.batch.id}:${row.entry.id}`,"--because=control finished"],{cwd:s.root,env:s.env,encoding:"utf8"});assert.equal(r.status,0,r.stderr);
  }
  for(const result of await results){assert.equal(result.status,1);assert.match(result.out,/control finished/);assert.doesNotMatch(result.out,/gating its first half|red on main/);}
});

for(const broken of ["missing","malformed","wrong-pin"] as const)test(`an unavailable ${broken} gate measurement holds instead of attributing a failure`,async()=>{
  const s=scratch(),state=join(s.home,".cache/nts-land");
  const damage=broken==="missing"?'rm "$NTS_GATE_RUN_DIR/summary.json"':broken==="malformed"?'printf "{" > "$NTS_GATE_RUN_DIR/summary.json"':`node - "$NTS_GATE_RUN_DIR/summary.json" <<'PIN'
const fs=require('node:fs'),file=process.argv[2],summary=JSON.parse(fs.readFileSync(file));summary.identities.commit='f'.repeat(40);fs.writeFileSync(file,JSON.stringify(summary));
PIN`;
  writeFileSync(join(s.root,"tooling/gate/pinned.sh"),controls(s,STAND_IN_GATE+reportContext+damage+"\nexit 2\n"));
  run(s,s.root,["add","tooling/gate/pinned.sh"]);run(s,s.root,["commit","-qm","unavailable summary control"]);
  const a=lane(s,"unmeasured-a",{a:"green\n"}),b=lane(s,"unmeasured-b",{b:"green\n"}),results=landTogether(s,[a,b]);
  await until("the unavailable measurement hold",()=>heldLandings(state).length===2);
  assert.equal(states(s).length,0);assert.equal(gates(s),1,"no baseline or half without a result");
  for(const row of heldLandings(state)){
    const r=spawnTest(process.execPath,[LAND,"--refuse-held",`${row.batch.id}:${row.entry.id}`,"--because=unavailable control complete"],{cwd:s.root,env:s.env,encoding:"utf8"});assert.equal(r.status,0,r.stderr);
  }
  for(const result of await results){assert.equal(result.status,1,result.out);assert.match(result.out,/unavailable control complete/);assert.doesNotMatch(result.out,/checking failed steps on main|gating its first half/);}
});
