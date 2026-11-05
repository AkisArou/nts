// land.ts tests: train. The shared fixture is land-test-fixture.ts;
// see its header for how the stand-in gate and scratch repositories work.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after } from "node:test";
import assert from "node:assert/strict";
import { selectorFixture } from "./selector-fixture.ts";
import { STAND_IN_GATE, controls, gates, land, landTogether, lane, made, onMain, reportContext, run, scratch, test, until, type Landed } from "./land-test-fixture.ts";

for(const scenario of [
  {name:"an accepted on-device skip",step:"on-device",accepted:true,lands:true},
  {name:"an unaccepted on-device skip",step:"on-device",accepted:false,lands:false},
  {name:"an accepted skip outside standing policy",step:"fake",accepted:true,lands:false},
]) test(`the real post-gate decision handles ${scenario.name}`,async()=>{
  const s=scratch(),base=run(s,s.root,["rev-parse","main"]);
  writeFileSync(join(s.root,"tooling/gate/run.mjs"),'process.stdout.write(JSON.stringify({fake:[],"on-device":[]}));\n');
  writeFileSync(join(s.root,"tooling/gate/owed.mjs"),selectorFixture({steps:JSON.stringify([scenario.step]),projects:"null"}));
  writeFileSync(join(s.root,"tooling/gate/pinned.sh"),controls(s,STAND_IN_GATE+reportContext+`
node - "$NTS_GATE_RUN_DIR/summary.json" <<'VERDICT'
const fs=require("node:fs"),path=process.argv[2],summary=JSON.parse(fs.readFileSync(path));
summary.steps[0]={...summary.steps[0],name:${JSON.stringify(scenario.step)},verdict:"SKIPPED",accepted:${scenario.accepted}};
fs.writeFileSync(path,JSON.stringify(summary));
VERDICT
`));
  run(s,s.root,["add","tooling/gate"]);run(s,s.root,["commit","-qm","skip verdict control"]);
  const before=run(s,s.root,["rev-parse","main"]),tree=lane(s,"tsrs/skip-verdict",{"one.txt":"one\n"});
  const tip=run(s,tree,["rev-parse","HEAD"]),result=await land(s,tree).done;
  assert.equal(result.status,scenario.lands?0:1,result.out);
  assert.doesNotMatch(result.out,/ReferenceError/);
  assert.equal(run(s,s.root,["rev-parse","main"]),scenario.lands?tip:before);
  if(!scenario.lands) assert.match(result.out,new RegExp(`${scenario.step}=SKIPPED`));
  assert.notEqual(before,base);
});

test("one gate lands every landing queued behind the lock", async () => {
  const s = scratch();
  const a = lane(s, "a", { "a.txt": "a\n" });
  const b = lane(s, "b", { "b.txt": "b\n" });
  const c = lane(s, "c", { "c.txt": "c\n" });
  const [ra, rb, rc] = await landTogether(s, [a, b, c]);
  for (const r of [ra, rb, rc]) {
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /LANDED .* in a train of 3/);
  }
  assert.equal(gates(s), 1);
  assert.ok(onMain(s, "a.txt") && onMain(s, "b.txt") && onMain(s, "c.txt"));
  assert.match(readFileSync(join(s.home, ".cache/nts-land/trains.tsv"), "utf8"), /\t3\tlanded\t/);
});

test("every member of a train carries the land note, not only its tip", async () => {
  const s = scratch();
  const a = lane(s, "a", { "a.txt": "a\n" });
  const b = lane(s, "b", { "b.txt": "b\n" });
  const [ra, rb] = await landTogether(s, [a, b]);
  const landed = (r: Landed) => /as ([0-9a-f]{12}): main is ([0-9a-f]{12})/.exec(r.out);
  const [first, second] = [landed(ra), landed(rb)];
  assert.ok(first && second, `${ra.out}\n${rb.out}`);
  const note = (sha: string) => run(s, s.root, ["notes", "--ref=land", "show", sha]);
  assert.match(note(second![1]), /train: /);
  assert.match(note(first![1]), new RegExp(`gated as part of: ${first![2]}`));
});

test("a landing that conflicts with one ahead of it is refused, and the train goes on", async () => {
  const s = scratch();
  const a = lane(s, "a", { "shared.txt": "from a\n" });
  const b = lane(s, "b", { "shared.txt": "from b\n" });
  const c = lane(s, "c", { "c.txt": "c\n" });
  const later=["d","e","f","g"].map(name=>lane(s,name,{[`${name}.txt`]:`${name}\n`}));
  const [ra, rb, rc,...rest] = await landTogether(s, [a, b, c,...later]);
  assert.equal(ra.status, 0, ra.out);
  assert.equal(rc.status, 0, rc.out);
  assert.equal(rb.status, 1, rb.out);
  for(const result of rest)assert.equal(result.status,0,result.out);
  assert.match(rb.out, /does not replay onto main \(\w+\) or the 1 landing\(s\) ahead of it/);
  assert.equal(readFileSync(join(a, "shared.txt"), "utf8"), "from a\n");
  assert.equal(run(s, s.root, ["show", "main:shared.txt"]), "from a");
  assert.equal(gates(s), 1);
  const owner=JSON.parse(readFileSync(join(s.home,".cache/nts-land/train-owner.json"),"utf8"));
  assert.match(readFileSync(owner.trace,"utf8"),/does not replay onto main/);
});

test("a landing alone still lands, and its changes already on main land as nothing", async () => {
  const s = scratch();
  const a = lane(s, "a", { "a.txt": "a\n" });
  const [first] = await landTogether(s, [a]);
  assert.equal(first.status, 0, first.out);
  assert.doesNotMatch(first.out, /train of/);
  // The same change again, made on another branch from the old main.
  run(s, s.root, ["branch", "again", "main~1"]);
  const again = join(s.root, "..", "again");
  run(s, s.root, ["worktree", "add", "-q", again, "again"]);
  writeFileSync(join(again, "a.txt"), "a\n");
  run(s, again, ["add", "-A"]);
  run(s, again, ["commit", "-q", "-m", "a again"]);
  const [second] = await landTogether(s, [again]);
  assert.equal(second.status, 0, second.out);
  assert.match(second.out, /changes are on main already/);
  assert.equal(gates(s), 1);
});

test("the interop projects owed.mjs names reach the gate", async () => {
  const s = scratch();
  const a = lane(s, "a", { INTEROP: "java-from-ts ts-from-java\n" });
  const [ra] = await landTogether(s, [a]);
  assert.equal(ra.status, 0, ra.out);
  assert.match(ra.out, /owes: fake interop \(interop: java-from-ts ts-from-java\)/);
  assert.match(readFileSync(s.gates, "utf8"), / java-from-ts ts-from-java$/m);
});

test("a landing lands the commit it was queued with, though its tree moves on while it waits", async () => {
  const s = scratch();
  const a = lane(s, "a", { "a.txt": "a\n" });
  const lock = join(s.home, ".cache/nts-land.lock");
  writeFileSync(lock, "");
  const holder = spawn("flock", [lock, process.execPath, "-e", "process.stdin.resume()"], { detached: true });
  await until("the lock to be held", () => readFileSync("/proc/locks", "utf8").includes(`${holder.pid} `));
  const landing = land(s, a);
  const queue = join(s.home, ".cache/nts-land/pending");
  await until("its final queue record", () => landing.record()!==undefined);
  writeFileSync(join(a, "later.txt"), "later\n");
  run(s, a, ["add", "-A"]);
  run(s, a, ["commit", "-q", "-m", "later"]);
  process.kill(-holder.pid!, "SIGTERM");
  const r = await landing.done;
  assert.equal(r.status, 0, r.out);
  assert.ok(onMain(s, "a.txt"));
  assert.ok(!onMain(s, "later.txt"));
});

test("commits that landed as replayed copies are not replayed again", async () => {
  // The fixture-first workflow: a subject lands on its own, replayed because
  // main had moved, so main has a copy with another id; then main changes the
  // subject's file; then the fix lands from the branch that still holds the
  // original subject. Replaying that original again conflicts with main's
  // newer file (CompilerHelper's bigint fix, 2026-10-14).
  const s = scratch();
  const branch = lane(s, "fix", { "subject.txt": "one\n" });
  const subject = run(s, branch, ["rev-parse", "HEAD"]);
  const other = lane(s, "other", { "other.txt": "o\n" });
  const [ro] = await landTogether(s, [other]);
  assert.equal(ro.status, 0, ro.out);
  const [rs] = await landTogether(s, [branch]);
  assert.equal(rs.status, 0, rs.out);
  assert.notEqual(run(s, s.root, ["rev-parse", "main"]), subject, "the subject should have landed as a replayed copy");
  // Main changes the subject's file after it landed.
  run(s, s.root, ["checkout", "-q", "main"]);
  writeFileSync(join(s.root, "subject.txt"), "one, revised\n");
  run(s, s.root, ["commit", "-q", "-am", "revise the subject on main"]);
  // The fix, on top of the original subject.
  writeFileSync(join(branch, "fix.txt"), "fix\n");
  run(s, branch, ["add", "-A"]);
  run(s, branch, ["commit", "-q", "-m", "the fix"]);
  const [rf] = await landTogether(s, [branch]);
  assert.equal(rf.status, 0, rf.out);
  assert.ok(onMain(s, "fix.txt"));
  assert.equal(run(s, s.root, ["show", "main:subject.txt"]), "one, revised");
});

test("the dated platform policy accepts Windows SKIPs without a per-landing flag, and records it", async () => {
  // The Windows lane's paths, with no Windows reachable (the stand-in's log).
  const s = scratch();
  const test = lane(s, "test", { "compiler/codegen/c/tests/com.rs": "// a host test\n", "docs/windows-lane-goal.md": "notes\n" });
  const [rt] = await landTogether(s, [test]);
  assert.equal(rt.status, 0, rt.out);
  const runtime = lane(s, "runtime", { "runtime/winrt/x.c": "/* runs on Windows */\n" });
  const [rr] = await landTogether(s, [runtime]);
  assert.equal(rr.status, 0, rr.out);
  assert.match(run(s, s.root, ["notes", "--ref=land", "show", "main"]), /unrun accepted by user policy 2026-10-23: windows/);
  const apple = lane(s, "apple-runtime", { "runtime/objc/x.c": "/* runs on Apple */\n" });
  const [ra] = await landTogether(s, [apple]);
  assert.equal(ra.status, 0, ra.out);
  assert.match(run(s, s.root, ["notes", "--ref=land", "show", "main"]), /unrun accepted by user policy 2026-10-23: apple/);
});

test("a later landing revisits a recorded topic after its lane home switches away, leaving unsent branches alone", async () => {
  const s = scratch();
  const tree = lane(s, "compiler/first", { "first.txt": "first\n" });
  const first = await land(s, tree).done; assert.equal(first.status, 0, first.out);
  assert.equal(run(s, tree, ["symbolic-ref", "--short", "HEAD"]), "compiler/first");
  run(s, tree, ["switch", "-qc", "compiler/next", "main"]);
  writeFileSync(join(tree, "next.txt"), "next\n"); run(s, tree, ["add", "next.txt"]); run(s, tree, ["commit", "-qm", "next"]);
  run(s, s.root, ["branch", "compiler/never-submitted", "main"]);
  const second = await land(s, tree).done; assert.equal(second.status, 0, second.out);
  assert.equal(run(s, s.root, ["for-each-ref", "refs/heads/compiler/first"]), "");
  assert.ok(run(s, s.root, ["for-each-ref", "refs/heads/compiler/never-submitted"]));
  assert.equal(run(s, tree, ["symbolic-ref", "--short", "HEAD"]), "compiler/next");
});

test("an upkeep logging failure cannot turn a successful landing red", async () => {
  const s = scratch();
  const tree = lane(s, "logging", { "landed.txt": "landed\n" });
  mkdirSync(join(s.home, ".cache/nts-land/upkeep.jsonl"), { recursive: true });
  const r = await land(s, tree).done;
  assert.equal(r.status, 0, r.out); assert.ok(onMain(s, "landed.txt"));
  assert.match(r.out, /upkeep incomplete; landing remains successful/);
  assert.equal(run(s, tree, ["symbolic-ref", "--short", "HEAD"]), "logging");
});

test("a non-canonical green summary cannot land",async()=>{
  const s=scratch(),tree=lane(s,"experiment-report",{change:"one\n"});
  s.env.LAND_TEST_NON_CANONICAL="1";
  const before=run(s,s.root,["rev-parse","main"]),result=await land(s,tree).done;
  assert.equal(result.status,1,result.out);assert.match(result.out,/non-canonical or unrecorded environment is not landing evidence/);
  assert.equal(run(s,s.root,["rev-parse","main"]),before);
});

test("reverse-queued stacked submissions land their own ranges in one train",async()=>{
  const s=scratch();
  const a=lane(s,"stack-a",{"shared":"first\n"});
  const aSha=run(s,a,["rev-parse","HEAD"]),b=join(s.home,"Projects/nts-lanes/stack-b");
  run(s,s.root,["worktree","add","-q","-b","stack-b",b,aSha]);
  writeFileSync(join(b,"shared"),"second\n");run(s,b,["add","shared"]);run(s,b,["commit","-qm","stack-b"]);
  writeFileSync(join(s.root,"main-moved"),"new main\n");run(s,s.root,["add","main-moved"]);run(s,s.root,["commit","-qm","main moved"]);
  const results=await landTogether(s,[b,a]);
  for(const result of results)assert.equal(result.status,0,result.out);
  assert.equal(gates(s),1);
  assert.equal(run(s,s.root,["show","main:shared"]),"second");
  assert.equal(run(s,s.root,["log","-1","--format=%s"]),"stack-b");
});

test("a dead queued prerequisite cannot be silently replayed through its descendant",async()=>{
  const s=scratch(),a=lane(s,"withdrawn-base",{"base-change":"first\n"});
  const aSha=run(s,a,["rev-parse","HEAD"]),b=join(s.home,"Projects/nts-lanes/dependent");
  run(s,s.root,["worktree","add","-q","-b","dependent",b,aSha]);
  writeFileSync(join(b,"dependent"),"second\n");run(s,b,["add","dependent"]);run(s,b,["commit","-qm","dependent"]);
  const queue=join(s.home,".cache/nts-land/pending");mkdirSync(queue,{recursive:true});
  writeFileSync(join(queue,"withdrawn.json"),JSON.stringify({id:"withdrawn",sha:aSha,tree:a,pid:2147483647,at:0}));
  const result=await land(s,b).done;
  assert.equal(result.status,1,result.out);
  assert.match(result.out,/withdrawn or refused prerequisite/);
  assert.equal(gates(s),0);
  assert.equal(onMain(s,"base-change"),false);
  assert.equal(onMain(s,"dependent"),false);
});
