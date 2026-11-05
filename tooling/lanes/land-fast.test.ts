// land.ts tests: fast. The shared fixture is land-test-fixture.ts;
// see its header for how the stand-in gate and scratch repositories work.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after } from "node:test";
import assert from "node:assert/strict";
import { readLedger, VerificationLedger } from "./verification-ledger.ts";
import { selectorFixture } from "./selector-fixture.ts";
import { LAND, boundaryFixture, fastGate, gateEvents, gates, land, lane, pendingReady, releaseTrain, run, scratch, spawnTest, test, until, type Landed } from "./land-test-fixture.ts";

test("a real tree-only preflight names unmeasured inputs as an instrument failure",async()=>{
  const s=scratch();fastGate(s);
  writeFileSync(join(s.root,"tooling/gate/all.sh"),`set -eu
mkdir -p "$NTS_GATE_RUN_DIR"
printf '%s' '{"verdict":"red","steps":[{"name":"tree-check","verdict":"INSTRUMENT","reason":"no test262 checkout"}]}' > "$NTS_GATE_RUN_DIR/summary.json"
exit 2
`);
  run(s,s.root,["add","tooling/gate/all.sh"]);run(s,s.root,["commit","-qm","unmeasured preflight"]);
  const tree=lane(s,"docs-without-corpus",{"docs/new.md":"doc\n"});
  const result=spawnTest(process.execPath,[LAND,"HEAD","--dry-run"],{cwd:tree,env:s.env,encoding:"utf8"});
  assert.equal(result.status,2,result.stdout+result.stderr);assert.match(result.stderr,/instrument failure: tree-check: no test262 checkout/);assert.doesNotMatch(result.stderr,/gate would refuse/);assert.equal(gates(s),0);
});

test("tree-only changes land without a queue entry or full gate", async () => {
  const s = scratch(); fastGate(s);
  const tree = lane(s, "fast", { "docs/new.md": "doc\n" });
  const result = await land(s, tree).done;
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /tree-only checks, no train/);
  assert.equal(run(s, s.root, ["rev-parse", "main"]), run(s, tree, ["rev-parse", "HEAD"]));
  assert.ok(!existsSync(join(s.home, ".cache/nts-land/pending")));
  assert.equal(gates(s), 0);
  const saved = readLedger(join(s.home, ".cache/nts-land/verification"))!;
  assert.equal(saved.mode, "strict");
  assert.equal(saved.transactions[0].kind, "tree-only");
  assert.equal(saved.verified.tip, run(s, s.root, ["rev-parse", "main"]));
});

test("a coordinator docs commit is accounted for by the next strict train",async()=>{
  const s=scratch(),base=run(s,s.root,["rev-parse","main"]);
  new VerificationLedger(join(s.home,".cache/nts-land/verification"),s.root,base);
  mkdirSync(join(s.root,"docs"));writeFileSync(join(s.root,"docs/design.md"),"design\n");
  run(s,s.root,["add","docs/design.md"]);run(s,s.root,["commit","-qm","coordinator docs"]);
  const tree=lane(s,"tsrs/after-docs",{"next.txt":"next\n"}), result=await land(s,tree).done;
  assert.equal(result.status,0,result.out);
  const saved=readLedger(join(s.home,".cache/nts-land/verification"))!;
  assert.equal(saved.transactions[0].kind,"external");
  assert.equal(saved.transactions[0].entries[0].author.lane,"coordinator");
  assert.deepEqual(saved.transactions[0].entries[0].owed.steps,["fake"]);
  assert.equal(saved.verified.tip,run(s,s.root,["rev-parse","main"]));
});

test("a fast landing replays and rechecks if main moves before the short lock", async () => {
  const s = scratch(); fastGate(s);
  const tree = lane(s, "fast-moved", { "docs/new.md": "doc\n" });
  const original = run(s, tree, ["rev-parse", "HEAD"]);
  const wait = join(s.home, "checking"); s.env.LAND_TEST_FAST_WAIT = wait;
  const pending = land(s, tree);
  await until("private tree checks", () => existsSync(wait));
  assert.ok(!existsSync(join(s.home, ".cache/nts-land/pending")));
  writeFileSync(join(s.root, "peer.txt"), "peer\n");
  run(s, s.root, ["add", "peer.txt"]);
  run(s, s.root, ["commit", "-q", "-m", "a peer lands"]);
  writeFileSync(wait + ".done", "continue");
  const result = await pending.done;
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /main moved: replaying and rechecking/);
  const observations = readFileSync(s.env.LAND_TEST_FAST_CHECKS!, "utf8").trim().split("\n");
  assert.equal(observations.length, 2);
  assert.equal(observations[0], original);
  assert.equal(observations[1], run(s, s.root, ["rev-parse", "main"]));
  assert.notEqual(observations[0], observations[1]);
  assert.equal(readFileSync(join(s.root, "peer.txt"), "utf8"), "peer\n");
  assert.equal(gates(s), 0);
});

test("a failed tree check refuses immediately without moving main or queueing", async () => {
  const s = scratch(); fastGate(s);
  const base = run(s, s.root, ["rev-parse", "HEAD"]);
  const tree = lane(s, "fast-red", { TREE_RED: "bad\n" });
  const result = await land(s, tree).done;
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /tree-check FAIL/);
  assert.equal(run(s, s.root, ["rev-parse", "main"]), base);
  assert.ok(!existsSync(join(s.home, ".cache/nts-land/pending")));
});

test("changed owed rules on main route a previously fast change through the gate", async () => {
  const s = scratch(); fastGate(s);
  const tree = lane(s, "fast-now-strict", { "docs/new.md": "doc\n" });
  const wait = join(s.home, "checking"); s.env.LAND_TEST_FAST_WAIT = wait;
  const pending = land(s, tree);
  await until("private tree checks", () => existsSync(wait));
  writeFileSync(join(s.root, "tooling/gate/owed.mjs"), selectorFixture());
  run(s, s.root, ["add", "tooling/gate/owed.mjs"]);
  run(s, s.root, ["commit", "-q", "-m", "new strict obligation"]);
  writeFileSync(wait + ".done", "continue");
  const result = await pending.done;
  assert.equal(result.status, 0, result.out);
  assert.equal(gates(s), 1, result.out);
});

test("a tree-only landing refuses an ancestor holding the landing lock", () => {
  const s = scratch(); fastGate(s);
  const tree = lane(s, "fast-outer-lock", { "docs/new.md": "doc\n" });
  const result = spawnTest("flock", [join(s.home, ".cache/nts-land.lock"), process.execPath, LAND, "HEAD"], { cwd: tree, env: s.env, encoding: "utf8",});
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /run land.ts bare/);
  assert.ok(!existsSync(join(s.home, ".cache/nts-land/pending")));
});

test("docs submitted during a train land at its boundary with identical staged root content",async()=>{
  const s=boundaryFixture(),product=lane(s,"boundary-product",{product:"green\n"}),docs=lane(s,"boundary-docs",{"docs/page.md":"ready\n"});
  const first=land(s,product);
  await until("the product train's actual gate",()=>gateEvents(s).length===1);
  const ready=land(s,docs);
  try {
    await until("the checked docs ready intent",()=>pendingReady(s).length===1);
    writeFileSync(join(s.root,"docs/page.md"),"ready\n");run(s,s.root,["add","docs/page.md"]);
  }finally{releaseTrain(s,0);}
  for(const result of await Promise.all([first.done,ready.done]))assert.equal(result.status,0,result.out);
  assert.equal(gates(s),1,"docs use their private checks at the same train boundary");
  assert.equal(run(s,s.root,["show","main:docs/page.md"]),"ready");
  assert.equal(run(s,s.root,["diff","--cached","--name-only"]),"");
  assert.equal(pendingReady(s).length,0);
});

test("a dirty docs ready entry is retained without blocking the next product train",async()=>{
  const s=boundaryFixture(),a=lane(s,"before-docs",{a:"green\n"}),b=lane(s,"after-docs",{b:"green\n"}),docs=lane(s,"dirty-docs",{"docs/page.md":"ready\n"});
  const first=land(s,a);await until("the first actual product gate",()=>gateEvents(s).length===1);
  const ready=land(s,docs),second=land(s,b);
  try {
    await until("the checked docs ready intent",()=>pendingReady(s).length===1);
    await until("the next product final record",()=>second.record()!==undefined);
    writeFileSync(join(s.root,"docs/page.md"),"conflicting local edit\n");
  }finally{releaseTrain(s,0);}
  try {
    await until("the next product gate despite blocked docs",()=>gateEvents(s).length===2);
    const pending=pendingReady(s);assert.equal(pending.length,1);assert.match(pending[0].blockedReason??"",/root checkout conflict/);
    assert.equal(readFileSync(join(s.root,"docs/page.md"),"utf8"),"conflicting local edit\n");
  }finally{releaseTrain(s,1);}
  for(const result of await Promise.all([first.done,second.done]))assert.equal(result.status,0,result.out);
  assert.equal(run(s,s.root,["show","main:docs/page.md"]),"base");
  assert.equal(gates(s),2);
  writeFileSync(join(s.root,"docs/page.md"),"base\n");
  let completed:Landed|undefined;void ready.done.then(result=>{completed=result;});
  await until("the ready docs landing after its local conflict is cleared",()=>completed!==undefined);
  const result=completed!;assert.equal(result.status,0,result.out);
  assert.equal(run(s,s.root,["show","main:docs/page.md"]),"ready");
});
