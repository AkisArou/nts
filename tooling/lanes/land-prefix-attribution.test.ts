// Exact prefix attribution, interruption and recovery against private trains.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { heldLandings } from "./held-landings.ts";
import { readLedger } from "./verification-ledger.ts";
import { LAND, STAND_IN_GATE, controls, gates, land, landTogether, lane, memoryGate, onMain, reportContext, run, scratch, spawnTest, states, test, until } from "./land-test-fixture.ts";

for (const point of ["prefix", "survivors"] as const) test(`a withdrawal at the ${point} boundary cannot enter the survivor gate`, async () => {
  const s = scratch(), marker = join(s.home, "withdrew"), preload = join(s.home, "withdraw-boundary.ts");
  const bad = lane(s, "withdraw-cause", { RED: "failure\n" }), good = lane(s, "withdraw-target", { withdrawn: "must never land\n" });
  const target = run(s, good, ["rev-parse", "HEAD"]);
  writeFileSync(preload, `import fs from 'node:fs';import {execFileSync} from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const rename=fs.renameSync;fs.renameSync=function(...args){const answer=rename.apply(this,args),to=String(args[1]);
if(process.env.NTS_LAND_TRAIN_UNIT&&!fs.existsSync(${JSON.stringify(marker)})){
 let reached=false;
 if(${JSON.stringify(point)}==='prefix'&&to.endsWith('/attribution-journal.json')){const j=JSON.parse(fs.readFileSync(to,'utf8'));reached=j.events.at(-1)?.kind==='start';}
 if(${JSON.stringify(point)}==='survivors'&&to.endsWith('/frozen-train.json')){const j=JSON.parse(fs.readFileSync(to,'utf8'));reached=!!j.composition?.survivor;}
 if(reached){fs.writeFileSync(${JSON.stringify(marker)},'boundary reached');execFileSync(process.execPath,[${JSON.stringify(LAND)},'--withdraw',${JSON.stringify(target)}],{cwd:${JSON.stringify(s.root)},env:process.env,stdio:'pipe'});}
}return answer;};syncBuiltinESMExports();`);
  s.env.NODE_OPTIONS = `--import=${preload}`;
  const results = await landTogether(s, [bad, good]);
  assert.equal(existsSync(marker), true, "the withdrawal ran during attribution");
  assert.deepEqual(results.map(row => row.status), [1, 1], results.map(row => row.out).join("\n"));
  assert.equal(onMain(s, "withdrawn"), false);
  assert.ok(states(s).some(row => row.state === "withdrawn"), "the withdrawn member is answered explicitly");
});

test("a restart during a second attribution preserves the completed survivor phase", async () => {
  const s = scratch(); memoryGate(s);
  const pinned = join(s.root, "tooling/gate/pinned.sh"), original = readFileSync(pinned, "utf8");
  writeFileSync(pinned, original.replace('const steps = requested.map(name => ({name, verdict: name === "memory" && culprit ? "FAIL" : "PASS"}));', `const first=existsSync(join(process.env.NTS_GATE_TREE,'RED'));
const steps=requested.map(name=>({name,verdict:name==='fake'&&first?'FAIL':name==='memory'&&culprit?(first?'NOT RUN':'FAIL'):'PASS',...(name==='memory'&&first&&culprit?{cancelled_by:'fake'}:{})}));`)
    + `\nnode - "$NTS_GATE_RUN_DIR/summary.json" <<'PHASE_PROOF'
const fs=require('node:fs'),file=process.argv[2],s=JSON.parse(fs.readFileSync(file));
if(s.train_red_stop)s.train_red_stop.cancelled=s.steps.filter(row=>row.cancelled_by).map(row=>row.name);
fs.writeFileSync(file,JSON.stringify(s));
PHASE_PROOF\n`);
  run(s, s.root, ["add", "tooling/gate/pinned.sh"]); run(s, s.root, ["commit", "-qm", "two distinct completed failure scopes"]);
  const observed = join(s.home, "phase-observed.json"), seen = join(s.home, "phase-journals.json"), preload = join(s.home, "phase-crash.ts");
  writeFileSync(preload, `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const rename=fs.renameSync;fs.renameSync=function(...args){const value=rename.apply(this,args),to=String(args[1]);
if(process.env.NTS_LAND_TRAIN_UNIT&&to.endsWith('/attribution-journal.json')){
 const seenPath=${JSON.stringify(seen)},observed=${JSON.stringify(observed)},paths=fs.existsSync(seenPath)?JSON.parse(fs.readFileSync(seenPath,'utf8')):[];
 if(!paths.includes(to)){paths.push(to);fs.writeFileSync(seenPath,JSON.stringify(paths));}
 if(paths.length===2&&!fs.existsSync(observed)){
  const f=JSON.parse(fs.readFileSync(${JSON.stringify(join(s.home, ".cache/nts-land/frozen-train.json"))},'utf8')).composition;
  const path=f.survivor.originRun+'/survivor-phase-'+f.generation+'.json';
  fs.writeFileSync(observed,JSON.stringify({path,bytes:fs.readFileSync(path,'utf8')}));process.exit(73);
 }
}return value;};syncBuiltinESMExports();`);
  s.env.NODE_OPTIONS = `--import=${preload}`;
  const first = lane(s, "phase-first-cause", { RED: "first failure\n" }), second = lane(s, "phase-second-cause", { BAD_MEMORY: "second failure\n" }),
    good = lane(s, "phase-survivor", { SELECT_MEMORY: "select both checks\n" });
  const results = await landTogether(s, [first, second, good]);
  assert.deepEqual(results.map(row => row.status), [1, 1, 0], results.map(row => row.out).join("\n"));
  const saved = JSON.parse(readFileSync(observed, "utf8")) as { path: string; bytes: string };
  assert.equal(readFileSync(saved.path, "utf8"), saved.bytes, "recovery did not run another survivor gate and cannot rewrite its phase");
  assert.ok(onMain(s, "SELECT_MEMORY")); assert.equal(onMain(s, "RED"), false); assert.equal(onMain(s, "BAD_MEMORY"), false);
});

test("actual prefix attribution finds two culprits and retains the later dependent control",async()=>{
  const s=scratch(),gate=join(s.root,"tooling/gate/pinned.sh");
  writeFileSync(gate,readFileSync(gate,"utf8").replace('[ -e "$NTS_GATE_TREE/RED" ]','{ [ -e "$NTS_GATE_TREE/RED" ] || [ -e "$NTS_GATE_TREE/RED_TWO" ]; }'));
  run(s,s.root,["add","tooling/gate/pinned.sh"]);run(s,s.root,["commit","-qm","two independent failing causes"]);
  const a=lane(s,"first-safe",{a:"safe\n"}),bad=lane(s,"first-bad",{RED:"failure one\n"}),
    dependent=lane(s,"later-control",{control:"the new check fails only while RED is present\n"}),bad2=lane(s,"second-bad",{RED_TWO:"failure two\n"});
  const results=await landTogether(s,[a,bad,dependent,bad2]);
  assert.deepEqual(results.map(r=>r.status),[0,1,0,1],results.map(r=>r.out).join("\n"));
  assert.ok(onMain(s,"a")&&onMain(s,"control"));assert.equal(onMain(s,"RED"),false);assert.equal(onMain(s,"RED_TWO"),false);
  const state=join(s.home,".cache/nts-land"),runs=join(state,"runs");
  const file=readdirSync(runs).map(name=>join(runs,name,"attribution-journal.json")).find(existsSync);assert.ok(file);
  const journal=JSON.parse(readFileSync(file,"utf8"));
  const prefixRuns=journal.events.filter(row=>row.kind==="complete");
  assert.deepEqual(prefixRuns.map(row=>row.result.verdict),["green","red","green","red"]);
  const ledger=readLedger(join(state,"verification"))!;
  const strict=ledger.transactions.filter(tx=>tx.kind==="strict");assert.equal(strict.length,1);
  assert.equal(strict[0].entries.length,2,"prefix green is never used as a fast-forward proof");
});

test("actual prefix attribution journals a refused prerequisite and lands the unrelated survivor",async()=>{
  const s=scratch(),bad=lane(s,"bad-prerequisite",{RED:"actual failure\n"}),badSha=run(s,bad,["rev-parse","HEAD"]),dependent=join(s.home,"Projects/nts-lanes/dependent-conflict");
  run(s,s.root,["worktree","add","-q","-b","dependent-conflict",dependent,badSha]);
  writeFileSync(join(dependent,"dependent"),"requires the refused prerequisite\n");run(s,dependent,["add","dependent"]);run(s,dependent,["commit","-qm","dependent conflict"]);
  const good=lane(s,"unrelated-survivor",{safe:"safe\n"}),state=join(s.home,".cache/nts-land");
  const pending=landTogether(s,[bad,dependent,good]);let completed:Landed[]|undefined;
  void pending.then(results=>{completed=results;});
  try {
    await until("the survivor disposition or an attribution hold",()=>completed!==undefined||heldLandings(state).length>0);
    assert.equal(heldLandings(state).length,0,"a journaled prerequisite conflict cannot hold an unrelated survivor");
    const results=await pending;assert.deepEqual(results.map(row=>row.status),[1,1,0],results.map(row=>row.out).join("\n"));
    assert.match(results[1].out,/withdrawn or refused prerequisite/);
    assert.ok(onMain(s,"safe"));assert.equal(onMain(s,"RED"),false);assert.equal(onMain(s,"dependent"),false);
    const runs=join(state,"runs"),journal=readdirSync(runs).map(name=>join(runs,name,"attribution-journal.json")).find(existsSync);assert.ok(journal);
    const saved=JSON.parse(readFileSync(journal,"utf8"));assert.equal(saved.events.filter(event=>event.kind==="omit").length,1);
  } finally {
    for(const row of heldLandings(state)) {
      const release=spawnTest(process.execPath,[LAND,"--refuse-held",`${row.batch.id}:${row.entry.id}`,"--because=prerequisite conflict control completed"],{cwd:s.root,env:s.env,encoding:"utf8"});assert.equal(release.status,0,release.stderr);
    }
    await pending;
  }
});

test("an interrupted single-member measurement holds its completed failure before a base check",async()=>{
  const s=scratch(),base=run(s,s.root,["rev-parse","main"]),state=join(s.home,".cache/nts-land");
  s.env.LAND_TEST_PROOF_FAULT="interrupted";
  const tree=lane(s,"interrupted-failure",{RED:"completed failure before interruption\n"});
  let answered=false;const pending=land(s,tree).done.then(result=>{answered=true;return result;});
  try {
    await until("an interrupted single-member measurement disposition",()=>answered||heldLandings(state).length===1);
    const held=heldLandings(state);assert.equal(held.length,1,"an interrupted measurement must hold, even beside a completed failure");
    assert.match(held[0].batch.reason,/interrupted.*signal SIGTERM/);
    assert.equal(gates(s),1,"an interrupted measurement cannot enter a base check or culprit attribution");
    assert.equal(states(s).length,0);assert.equal(run(s,s.root,["rev-parse","main"]),base);
  } finally {
    for(const row of heldLandings(state)) {
      const answer=spawnTest(process.execPath,[LAND,"--refuse-held",`${row.batch.id}:${row.entry.id}`,"--because=interrupted measurement control completed"],{cwd:s.root,env:s.env,encoding:"utf8"});
      assert.equal(answer.status,0,answer.stderr);
    }
    await pending;
  }
});

for(const fault of ["missing","foreign","contradictory","drain-timeout","passing-red"])test(`actual train holds ${fault} red-stop evidence before attribution`,async()=>{
  const s=scratch(),base=run(s,s.root,["rev-parse","main"]);s.env.LAND_TEST_PROOF_FAULT=fault;
  const bad=lane(s,"bad-proof",{RED:"actual failure\n"}),good=lane(s,"safe-proof",{safe:"safe\n"}),state=join(s.home,".cache/nts-land");
  const pending=landTogether(s,[bad,good]);
  await until("the rejected cancellation proof hold",()=>heldLandings(state).length===2);
  const held=heldLandings(state);assert.ok(held.every(row=>/red-stop|ownership cleanup/.test(row.batch.reason)));
  assert.equal(gates(s),1);assert.equal(states(s).length,0);assert.equal(run(s,s.root,["rev-parse","main"]),base);
  for(const row of held){
    const refused=spawnTest(process.execPath,[LAND,"--refuse-held",`${row.batch.id}:${row.entry.id}`,"--because=proof fault control completed"],{cwd:s.root,env:s.env,encoding:"utf8"});
    assert.equal(refused.status,0,refused.stderr);
  }
  for(const result of await pending)assert.equal(result.status,1,result.out);
});

for(const point of ["pending-prefix","journaled-refusal","survivor-start"] as const)test(`actual attribution recovery at ${point}`,async()=>{
  const s=scratch(),state=join(s.home,".cache/nts-land"),trigger=join(s.home,"crash-armed"),preload=join(s.home,"attribution-crash.ts");
  writeFileSync(trigger,"armed");
  writeFileSync(preload,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const rename=fs.renameSync;fs.renameSync=function(...args){const answer=rename.apply(this,args),to=String(args[1]);
if(process.env.NTS_LAND_TRAIN_UNIT&&fs.existsSync(${JSON.stringify(trigger)})){
 const point=${JSON.stringify(point)};
 if(to.endsWith('/attribution-journal.json')){const journal=JSON.parse(fs.readFileSync(to,'utf8')),last=journal.events.at(-1);
  if(point==='pending-prefix'&&last?.kind==='start'||point==='journaled-refusal'&&last?.kind==='complete'&&last.result.verdict==='red'){fs.unlinkSync(${JSON.stringify(trigger)});process.exit(73);}}
 if(point==='survivor-start'&&to.endsWith('/frozen-train.json')){const saved=JSON.parse(fs.readFileSync(to,'utf8'));
  if(saved.composition?.survivor?.started&&!saved.composition.survivor.finished){fs.unlinkSync(${JSON.stringify(trigger)});process.exit(73);}}
}return answer;};syncBuiltinESMExports();`);
  s.env.NODE_OPTIONS=`--import=${preload}`;
  const bad=lane(s,"recover-bad",{RED:"actual failure\n"}),good=lane(s,"recover-good",{safe:"safe\n"}),base=run(s,s.root,["rev-parse","main"]),badSha=run(s,bad,["rev-parse","HEAD"]);
  const pending=landTogether(s,[bad,good]);
  if(point==="journaled-refusal") {
    const results=await pending;assert.deepEqual(results.map(row=>row.status),[1,0],results.map(row=>row.out).join("\n"));
    assert.equal(gates(s),5,"recovery reuses the recorded base-green scope and never reruns the culprit prefix");
    assert.equal(readFileSync(s.gates,"utf8").trim().split("\n").filter(line=>line.startsWith(badSha+" ")).length,1);
    assert.equal(states(s).filter(row=>row.state==="red").length,1);assert.ok(onMain(s,"safe"));assert.equal(onMain(s,"RED"),false);
  } else {
    await until("the interrupted attribution hold",()=>heldLandings(state).length===(point==="pending-prefix"?2:1));
    const held=heldLandings(state);assert.ok(held.every(row=>/interrupted/.test(row.batch.reason)));
    assert.equal(run(s,s.root,["rev-parse","main"]),base,"prefix PASS cannot fast-forward an unmeasured survivor gate");
    assert.equal(states(s).length,point==="pending-prefix"?0:1);
    assert.equal(gates(s),point==="pending-prefix"?2:4);
    for(const row of held){
      const refused=spawnTest(process.execPath,[LAND,"--refuse-held",`${row.batch.id}:${row.entry.id}`,"--because=recovery fault control completed"],{cwd:s.root,env:s.env,encoding:"utf8"});assert.equal(refused.status,0,refused.stderr);
    }
    for(const result of await pending)assert.equal(result.status,1,result.out);
  }
  assert.equal(existsSync(trigger),false,"the injected process death was reached");
});

for(const fault of ["interrupted","scope-cleanup"] as const)test(`a pressure retry with ${fault} evidence holds before completed rows can land`,async()=>{
  const s=scratch(),state=join(s.home,".cache/nts-land"),once=join(s.home,"retry-once");
  const admission=join(s.root,"tooling/gate/admission.ts"),original=readFileSync(admission,"utf8"),ready=original.replace("read = () => memAvailableGB()","read = () => 32");
  assert.notEqual(ready,original,"the private retry fixture supplies its own admission answer");writeFileSync(admission,ready);
  writeFileSync(join(s.root,"tooling/gate/pinned.sh"),controls(s,STAND_IN_GATE+reportContext+`
node - "$NTS_GATE_RUN_DIR/summary.json" <<'RETRY_FAULT'
const fs=require('node:fs'),file=process.argv[2],once=${JSON.stringify(once)},summary=JSON.parse(fs.readFileSync(file));
if(!fs.existsSync(once)){
 fs.writeFileSync(once,'first pressure attempt');summary.verdict='red';delete summary.train_red_stop;
 summary.steps[0]={...summary.steps[0],verdict:'INSTRUMENT',reason:'controlled pressure',instrument:{kind:'memory-pressure'}};
 process.exitCode=1;
}else if(${JSON.stringify(fault)}==='interrupted')summary.interrupted='signal SIGTERM';
else{summary.scope_execution=true;summary.scope_cleanup={state:'error',reason:'step cgroup drain timed out'};}
fs.writeFileSync(file,JSON.stringify(summary));
RETRY_FAULT
`));
  run(s,s.root,["add","tooling/gate/pinned.sh","tooling/gate/admission.ts"]);run(s,s.root,["commit","-qm","controlled retry fault"]);
  const base=run(s,s.root,["rev-parse","main"]);
  const a=lane(s,"retry-fault-a",{a:"safe\n"}),b=lane(s,"retry-fault-b",{b:"safe\n"});
  let answered=false;const pending=landTogether(s,[a,b]).then(result=>{answered=true;return result;});
  try {
    await until("the invalid retry disposition",()=>answered||heldLandings(state).length===2);
    const held=heldLandings(state);assert.equal(held.length,2,"a retry cannot launder an interrupted or undrained measurement into PASS");
    assert.equal(gates(s),2);assert.equal(states(s).length,0);
    assert.equal(run(s,s.root,["rev-parse","main"]),base,"a retry's passing rows cannot replace its missing measurement proof");
  } finally {
    for(const row of heldLandings(state)){
      const answer=spawnTest(process.execPath,[LAND,"--refuse-held",`${row.batch.id}:${row.entry.id}`,"--because=retry evidence control completed"],{cwd:s.root,env:s.env,encoding:"utf8"});assert.equal(answer.status,0,answer.stderr);
    }
    await pending;
  }
});

test("the actual pressure retry accepts changed infrastructure addresses with unchanged program host", async () => {
  const s = scratch(), once = join(s.home, "host-retry-once");
  const admission = join(s.root, "tooling/gate/admission.ts");
  writeFileSync(admission, readFileSync(admission, "utf8").replace("read = () => memAvailableGB()", "read = () => 32"));
  writeFileSync(join(s.root, "tooling/gate/pinned.sh"), controls(s, STAND_IN_GATE + reportContext + `
node - "$NTS_GATE_RUN_DIR/summary.json" <<'HOST_RETRY'
const fs=require('node:fs'),path=process.argv[2],once=${JSON.stringify(once)},summary=JSON.parse(fs.readFileSync(path));
if(!fs.existsSync(once)){
 fs.writeFileSync(once,'first attempt');summary.verdict='red';delete summary.train_red_stop;
 summary.steps[0]={...summary.steps[0],verdict:'INSTRUMENT',reason:'controlled pressure',instrument:{kind:'memory-pressure'}};process.exitCode=1;
}else{
 summary.environment.host.DBUS_SESSION_BUS_ADDRESS='unix:path=/fixture-retry-bus';
 summary.environment.host.XDG_RUNTIME_DIR='/fixture-retry-runtime';
}
fs.writeFileSync(path,JSON.stringify(summary));
HOST_RETRY
`));
  run(s, s.root, ["add", "tooling/gate/pinned.sh", "tooling/gate/admission.ts"]); run(s, s.root, ["commit", "-qm", "private host retry control"]);
  const first = lane(s, "host-retry-a", { first: "safe\n" }), second = lane(s, "host-retry-b", { second: "safe\n" });
  const state = join(s.home, ".cache/nts-land");
  let completed = false;
  const pending = landTogether(s, [first, second]).then(rows => { completed = true; return rows; });
  try {
    await until("the infrastructure-address retry disposition", () => completed || heldLandings(state).length > 0);
    assert.equal(heldLandings(state).length, 0, "infrastructure addresses cannot invalidate an unchanged program host");
    const results = await pending;
    assert.deepEqual(results.map(row => row.status), [0, 0], results.map(row => row.out).join("\n"));
    assert.equal(gates(s), 2, "one measured retry joins the retained work");
    assert.ok(onMain(s, "first") && onMain(s, "second"));
  } finally {
    for (const row of heldLandings(state)) {
      const answer = spawnTest(process.execPath, [LAND, "--refuse-held", `${row.batch.id}:${row.entry.id}`, "--because=private infrastructure-address control completed"], { cwd: s.root, env: s.env, encoding: "utf8" });
      assert.equal(answer.status, 0, answer.stderr);
    }
    await pending;
  }
});
