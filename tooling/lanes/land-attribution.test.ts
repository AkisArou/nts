// land.ts tests: attribution. The shared fixture is land-test-fixture.ts;
// see its header for how the stand-in gate and scratch repositories work.

import { heldLandings } from "./held-landings.ts";
import { waitFor } from "../gate/test-wait.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { LAND, STAND_IN_GATE, controls, gates, land, landTogether, lane, memoryGate, onMain, reportContext, run, scratch, spawnTest, states, test, until } from "./land-test-fixture.ts";

test("a red train is halved until the red landing is alone, and only it is refused", async () => {
  const s = scratch();
  const a = lane(s, "a", { "a.txt": "a\n" });
  const b = lane(s, "b", { "b.txt": "b\n" });
  const red = lane(s, "red", { RED: "\n" });
  const c = lane(s, "c", { "c.txt": "c\n" });
  const [ra, rb, rr, rc] = await landTogether(s, [a, b, red, c]);
  assert.equal(ra.status, 0, ra.out);
  assert.equal(rb.status, 0, rb.out);
  assert.equal(rc.status, 0, rc.out);
  assert.equal(rr.status, 1, rr.out);
  assert.match(rr.out, /gate not green: fake=FAIL/);
  assert.ok(onMain(s, "a.txt") && onMain(s, "b.txt") && onMain(s, "c.txt"));
  assert.ok(!onMain(s, "RED"));
  // [a b red c] red, [a b] green, [red c] red, [red] red, [c] green.
  assert.equal(gates(s), 8, "the three red attempts also check their failed step on main");
});

for (const culpritFirst of [true, false]) test(`halving keeps a red step the culprit does not owe (${culpritFirst ? "first" : "second"} half)`, async () => {
  const s = scratch();
  memoryGate(s);
  const culprit = lane(s, "culprit", { BAD_MEMORY: "the allocation regression\n" });
  const selector = lane(s, "selector", { SELECT_MEMORY: "select the memory check\n" });
  const asked = culpritFirst ? [culprit, selector] : [selector, culprit];
  const results = await landTogether(s, asked);
  const bad = results[culpritFirst ? 0 : 1];
  const good = results[culpritFirst ? 1 : 0];
  assert.equal(bad.status, 1, bad.out);
  assert.match(bad.out, /memory=FAIL/);
  assert.equal(good.status, 0, good.out);
  assert.equal(onMain(s, "BAD_MEMORY"), false);
  assert.equal(onMain(s, "SELECT_MEMORY"), true);
  const runs = readFileSync(s.gates + ".steps", "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(runs.length, 5, "the train and culprit failures each check main");
  assert.equal(runs.filter(r => r.culprit).length, 2);
  for (const r of runs) assert.ok(r.requested.includes("memory"), "neither half drops the train's red check");
});

for (const selectorFirst of [true, false]) test(`a red main refuses only the landing that owes its red step (${selectorFirst ? "first" : "second"} in train)`, async () => {
  const s = scratch();
  memoryGate(s, true);
  const unrelated = lane(s, "unrelated", { "unrelated.txt": "safe tooling change\n" });
  const selector = lane(s, "selector", { SELECT_MEMORY: "owes memory\n" });
  const results = await landTogether(s, selectorFirst ? [selector, unrelated] : [unrelated, selector]);
  const red = results[selectorFirst ? 0 : 1];
  const green = results[selectorFirst ? 1 : 0];
  assert.equal(red.status, 1, red.out);
  assert.match(red.out, /red on main.*memory/);
  assert.equal(green.status, 0, green.out);
  assert.equal(onMain(s, "SELECT_MEMORY"), false);
  assert.equal(onMain(s, "unrelated.txt"), true);
  const runs = readFileSync(s.gates + ".steps", "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(runs.length, 3, "failed train, base check, then only the unrelated landing");
  assert.deepEqual(runs.map(r => r.requested), [["fake", "memory"], ["memory"], ["fake"]]);
});

test("a landing that repeats one ahead of it in a red train is not told it landed", async () => {
  const s = scratch();
  const red = lane(s, "red", { RED: "\n", "a.txt": "a\n" });
  const again = lane(s, "again", { RED: "\n", "a.txt": "a\n" });
  const [rr, ra] = await landTogether(s, [red, again]);
  assert.equal(rr.status, 1, rr.out);
  assert.equal(ra.status, 1, ra.out);
  assert.ok(!onMain(s, "a.txt"));
});

test("a withdrawn frozen member leaves before the surviving train is halved",async()=>{
  const s=scratch(),bad=lane(s,"withdrawn-red",{RED:"red\n"}),a=lane(s,"survivor-a",{a:"green\n"}),b=lane(s,"survivor-b",{b:"green\n"});
  const badSha=run(s,bad,["rev-parse","HEAD"]);
  const gate=join(s.root,"tooling/gate/pinned.sh");
  writeFileSync(gate,readFileSync(gate,"utf8")+`\nif [ -e "$NTS_GATE_TREE/RED" ]; then node tooling/lanes/land.ts --withdraw '${badSha}'; fi\n`);
  run(s,s.root,["add","tooling/gate/pinned.sh"]);run(s,s.root,["commit","-qm","withdrawal request"]);
  const [withdrawn,...survivors]=await landTogether(s,[bad,a,b]);
  assert.notEqual(withdrawn.status,0,withdrawn.out);
  for(const result of survivors)assert.equal(result.status,0,result.out);
  assert.equal(gates(s),3,"one red train, its green base, then both survivors together");
  assert.ok(onMain(s,"a"));assert.ok(onMain(s,"b"));assert.equal(onMain(s,"RED"),false);
});


test("a completed failure and a hung remainder refuse the culprit instead of holding it",async()=>{
  const s=scratch(),state=join(s.home,".cache/nts-land");
  writeFileSync(join(s.root,"tooling/gate/pinned.sh"),controls(s,STAND_IN_GATE+reportContext+`
if [ -e "$NTS_GATE_TREE/FAIL_AND_HUNG" ]; then
node - "$NTS_GATE_RUN_DIR/summary.json" <<'MIXED'
const fs=require('node:fs'),file=process.argv[2],summary=JSON.parse(fs.readFileSync(file));
summary.verdict='red';summary.steps[0]={...summary.steps[0],verdict:'FAIL',reason:'completed assertion failed; unfinished work hung',instrument:{kind:'hung',verdict:'FAIL',completedFailures:1}};
fs.writeFileSync(file,JSON.stringify(summary));
MIXED
exit 1
fi
`));
  run(s,s.root,["add","tooling/gate/pinned.sh"]);run(s,s.root,["commit","-qm","mixed failure and hang stand-in"]);
  const tree=lane(s,"failure-before-hang",{FAIL_AND_HUNG:"definite failure\n"}),client=land(s,tree);
  await waitFor("the mixed train's disposition",()=>states(s).length>0||heldLandings(state).length>0);
  const held=heldLandings(state);
  if(held.length){
    const resolved=spawnTest(process.execPath,[LAND,"--refuse-held",held[0].entry.id,"--because=mixed control complete"],{cwd:s.root,env:s.env,encoding:"utf8"});assert.equal(resolved.status,0,resolved.stderr);
  }
  const result=await client.done;
  assert.equal(held.length,0,"a definite failure is red, not held");
  assert.equal(result.status,1,result.out);assert.match(result.out,/gate not green: fake=FAIL/);
  assert.equal(states(s)[0].state,"red");assert.equal(gates(s),2,"one candidate and its healthy baseline, no retry");
  assert.equal(onMain(s,"FAIL_AND_HUNG"),false);
});
