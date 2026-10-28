import { launcherPolicyNames } from "../gate/canonical-environment.ts";
import { spawnTest as processTest, waitFor } from "../gate/test-wait.ts";
// land.ts against a scratch repository and a stand-in gate: the train.
//
//   node --test tooling/lanes/land.test.ts
//
// Each test makes a repository whose `tooling/gate/pinned.sh` is a stand-in:
// it checks the commit out in the gate tree and writes a summary that is red
// when the commit has a file named RED, and it logs every commit it gates. The
// lock is held while the landings queue, so whoever takes it next finds them
// all waiting, as a lane does behind a half-hour gate.

import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { cpuList, gateCpus, inheritedCpus } from "../gate/affinity.ts";
import { readLedger, VerificationLedger } from "./verification-ledger.ts";
import {GateResource} from "./gate-resource.ts";
import {STANDING_GATE_POLICY} from "../gate/verdict-policy.ts";

// Fake gates read their own fixture controls from a private file. The real
// gate environment deliberately does not forward these launcher variables.
function saveControls(env:NodeJS.ProcessEnv):void {
  if (!env.LAND_TEST_CONTROLS) return;
  const quote=(value:string)=>"'"+value.replaceAll("'", "'\\''")+"'";
  writeFileSync(env.LAND_TEST_CONTROLS,Object.entries(env).filter(([k,v])=>k.startsWith("LAND_TEST_") && v!==undefined).map(([k,v])=>`export ${k}=${quote(v!)}`).join("\n")+"\n");
}
const spawnTest:typeof processTest=(command,args,options,what)=>{saveControls(options?.env ?? {});return processTest(command,args,options,what);};
const controls=(s:Scratch,text:string)=>`. '${s.env.LAND_TEST_CONTROLS}'\n${text}`;
const reportContext=`node - "$NTS_GATE_RUN_DIR/summary.json" <<'CONTEXT'
const fs=require("node:fs"),path=process.argv[2],summary=JSON.parse(fs.readFileSync(path));
summary.environment=JSON.parse(process.env.NTS_GATE_ENV_CONTEXT).report;
if (process.env.LAND_TEST_NON_CANONICAL) summary.environment.canonical=false;
fs.writeFileSync(path,JSON.stringify(summary));
CONTEXT
`;

const LAND = new URL("./land.ts", import.meta.url).pathname;

const STAND_IN_GATE = `set -eu
sha=$1
if [ -e "$NTS_GATE_TREE/.git" ]; then
  git -C "$NTS_GATE_TREE" checkout -q --detach --force "$sha"
else
  git worktree add -q --detach "$NTS_GATE_TREE" "$sha"
fi
[ -n "\${NTS_GATE_SETUP_ONLY:-}" ] && exit 0
if [ -n "\${LAND_TEST_AFFINITY:-}" ]; then
  awk '/^Cpus_allowed_list:/ {print $2}' /proc/self/status > "$LAND_TEST_AFFINITY"
  sh -c 'awk "/^Cpus_allowed_list:/ {print \\$2}" /proc/self/status' >> "$LAND_TEST_AFFINITY"
fi
if [ -n "\${LAND_TEST_CHECKERS:-}" ]; then
  test "$NTS_CHECKERS" = "1"
fi
printf '%s' "\${CARGO_PROFILE_DEV_DEBUG-unset}" > "$NTS_GATE_RUN_DIR/test-debug-mode"
printf '%s' "\${CARGO_PROFILE_DEV_OPT_LEVEL-unset}" > "$NTS_GATE_RUN_DIR/test-opt-level"
printf '%s' "\${NTS_GATE_ACCEPT_SKIP-unset}" > "$NTS_GATE_RUN_DIR/test-accepted-skips"
echo "$sha \${NTS_INTEROP_PROJECTS:-}" >> "$LAND_TEST_GATES"
verdict=green step=PASS
if [ -e "$NTS_GATE_TREE/RED" ]; then verdict=red step=FAIL; fi
# A platform whose programs never ran, as interop's log says it.
echo "  windows-hello    skipped: SKIP windows-x86_64 (hello): not run" > "$NTS_GATE_RUN_DIR/interop.log"
echo "  apple-hello      skipped: SKIP macos (hello): not run" >> "$NTS_GATE_RUN_DIR/interop.log"
printf '{"verdict":"%s","started":"t","wall_s":1,"steps":[{"name":"fake","verdict":"%s","log":"%s"}],"identities":{"commit":"%s"}}' \\
  "$verdict" "$step" "$NTS_GATE_RUN_DIR/interop.log" "$sha" > "$NTS_GATE_RUN_DIR/summary.json"
`;

type Scratch = { root: string; home: string; gates: string; env: NodeJS.ProcessEnv };

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function scratch(): Scratch {
  const dir = mkdtempSync(join(tmpdir(), "land-test-"));
  made.push(dir);
  const root = join(dir, "repo");
  const home = join(dir, "home");
  mkdirSync(join(home, ".cache/nts-parallel-20261004/mainctl"), { recursive: true });
  mkdirSync(join(root, "tooling/gate"), { recursive: true });
  writeFileSync(join(root, "tooling/gate/pinned.sh"), `. '${join(dir,"controls.sh")}'\n`+STAND_IN_GATE+reportContext);
  writeFileSync(join(root, "tooling/gate/run.mjs"), 'process.stdout.write(JSON.stringify({fake: []}));\n');
  // Narrows interop to what a commit's INTEROP file names, as owed.mjs does.
  writeFileSync(
    join(root, "tooling/gate/owed.mjs"),
    `import { existsSync, readFileSync } from "node:fs";\nconst p = existsSync("INTEROP") ? \` NTS_INTEROP_PROJECTS="\${readFileSync("INTEROP", "utf8").trim()}"\` : "";\nconsole.log(\`NTS_GATE_STEPS="fake"\${p} sh tooling/gate/all.sh\`);\n`,
  );
  writeFileSync(join(root, "shared.txt"), "one\n");
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_") && !k.startsWith("NTS_") && !launcherPolicyNames({[k]:v}).length) env[k] = v;
  Object.assign(env, {
    NTS_LAND_HOME: home,
    LAND_TEST_GATES: join(dir, "gates.log"),
    LAND_TEST_CONTROLS: join(dir,"controls.sh"),
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  });
  const s = { root, home, gates: join(dir, "gates.log"), env };
  run(s, root, ["init", "-q", "-b", "main"]);
  run(s, root, ["add", "-A"]);
  run(s, root, ["commit", "-q", "-m", "base"]);
  return s;
}

function run(s: Scratch, cwd: string, args: string[]): string {
  const r = spawnTest("git", args, { cwd, env: s.env, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A lane's tree on its own branch from main, with one commit writing `files`. */
function lane(s: Scratch, name: string, files: Record<string, string>): string {
  // These model persistent agent homes: successful landings must leave their
  // checked-out branches attached for the next commit.
  const tree = join(s.home, "Projects/nts-lanes", name);
  mkdirSync(dirname(tree), { recursive: true });
  run(s, s.root, ["worktree", "add", "-q", "-b", name, tree, "main"]);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(join(tree, path), text);
  }
  run(s, tree, ["add", "-A"]);
  run(s, tree, ["commit", "-q", "-m", name]);
  return tree;
}

type Landed = { status: number | null; out: string };

function land(s: Scratch, tree: string, cpus?: string): { child: ChildProcess; done: Promise<Landed> } {
  saveControls(s.env);
  const child = cpus
    ? spawn("taskset", ["-c", cpus, process.execPath, LAND, "HEAD"], { cwd: tree, env: s.env })
    : spawn(process.execPath, [LAND, "HEAD"], { cwd: tree, env: s.env });
  let out = "";
  child.stdout?.on("data", (d) => (out += d));
  child.stderr?.on("data", (d) => (out += d));
  const done = new Promise<Landed>((resolve) => child.on("exit", (status) => resolve({ status, out })));
  return { child, done };
}

function fastGate(s: Scratch): void {
  writeFileSync(join(s.root, "tooling/gate/run.mjs"), 'process.stdout.write(process.argv.includes("--tree-only") ? "tree-check\\n" : JSON.stringify({"tree-check":[],fake:[]}));\n');
  writeFileSync(join(s.root, "tooling/gate/owed.mjs"), 'process.stdout.write(\'NTS_GATE_STEPS="tree-check" sh tooling/gate/all.sh\\n\');\n');
  writeFileSync(join(s.root, "tooling/gate/all.sh"), controls(s,`#!/bin/sh
set -eu
mkdir -p "$NTS_GATE_RUN_DIR"
git rev-parse HEAD >> "$LAND_TEST_FAST_CHECKS"
if [ -n "\${LAND_TEST_FAST_WAIT:-}" ] && [ ! -e "$LAND_TEST_FAST_WAIT.done" ]; then
  touch "$LAND_TEST_FAST_WAIT"
  while [ ! -e "$LAND_TEST_FAST_WAIT.done" ]; do sleep 0.02; done
fi
verdict=green step=PASS
if [ -e TREE_RED ]; then verdict=red step=FAIL; fi
printf '{"verdict":"%s","identities":{"commit":"%s"},"steps":[{"name":"tree-check","verdict":"%s"}]}' "$verdict" "$(git rev-parse --short=12 HEAD)" "$step" > "$NTS_GATE_RUN_DIR/summary.json"
${reportContext}
[ "$verdict" = green ]
`));
  s.env.LAND_TEST_FAST_CHECKS = join(s.home, "fast-checks");
  run(s, s.root, ["add", "tooling/gate"]);
  run(s, s.root, ["commit", "-q", "-m", "tree-only rules"]);
}

test("tree-only changes land without a queue entry or full gate", async () => {
  const s = scratch(); fastGate(s);
  const tree = lane(s, "fast", { "docs/new.md": "doc\n" });
  const result = await land(s, tree).done;
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /tree-only checks, no train/);
  assert.equal(run(s, s.root, ["rev-parse", "main"]), run(s, tree, ["rev-parse", "HEAD"]));
  assert.ok(!existsSync(join(s.home, ".cache/nts-land/queue")));
  assert.equal(gates(s), 0);
  const saved = readLedger(join(s.home, ".cache/nts-land/verification"))!;
  assert.equal(saved.mode, "strict");
  assert.equal(saved.transactions[0].kind, "tree-only");
  assert.equal(saved.verified.tip, run(s, s.root, ["rev-parse", "main"]));
});

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

for(const scenario of [
  {name:"an accepted on-device skip",step:"on-device",accepted:true,lands:true},
  {name:"an unaccepted on-device skip",step:"on-device",accepted:false,lands:false},
  {name:"an accepted skip outside standing policy",step:"fake",accepted:true,lands:false},
]) test(`the real post-gate decision handles ${scenario.name}`,async()=>{
  const s=scratch(),base=run(s,s.root,["rev-parse","main"]);
  writeFileSync(join(s.root,"tooling/gate/run.mjs"),'process.stdout.write(JSON.stringify({fake:[],"on-device":[]}));\n');
  writeFileSync(join(s.root,"tooling/gate/owed.mjs"),`process.stdout.write('NTS_GATE_STEPS="${scenario.step}" sh tooling/gate/all.sh\\n');\n`);
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

test("a train waits for the gate resource without retaining the landing lock",async()=>{
  const s=scratch();
  writeFileSync(join(s.root,"tooling/gate/pinned.sh"),"# nts-gate-tree-lock-handoff: 8\n"+controls(s,STAND_IN_GATE+reportContext));
  // The marker is on its own line after a leading newline, as in pinned.sh.
  writeFileSync(join(s.root,"tooling/gate/pinned.sh"),"\n"+readFileSync(join(s.root,"tooling/gate/pinned.sh"),"utf8"));
  run(s,s.root,["add","tooling/gate/pinned.sh"]);run(s,s.root,["commit","-qm","lock handoff"]);
  const tree=lane(s,"tsrs/resource-wait",{"one.txt":"one\n"});
  const lock=join(s.home,".cache/nts-land.lock"),held=join(s.home,"probe-held"),release=join(s.home,"release-probe");
  const bin=join(s.home,"bin"),probe=join(bin,"probe.ts");mkdirSync(bin);
  // Queue publication precedes the lander's initial lock probe. Hold that
  // probe until the test observes it: the old immediate assertion must fail
  // here regardless of how the scheduler orders the parent and child.
  writeFileSync(probe,`import {writeFileSync,existsSync} from "node:fs";\nimport {waitFor} from ${JSON.stringify(new URL("../gate/test-wait.ts",import.meta.url).pathname)};\nwriteFileSync(${JSON.stringify(held)},"");\nawait waitFor("the test to release the initial lock probe",()=>existsSync(${JSON.stringify(release)}));\n`);
  const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
  // exec preserves the unrelated descriptor-8 gate-resource handoff too.
  writeFileSync(join(bin,"flock"),`#!/bin/sh\nif [ "$#" = 3 ] && [ "$1" = -n ] && [ "$2" = ${quote(lock)} ] && [ "$3" = true ]; then\n  exec /usr/bin/flock -n "$2" ${quote(process.execPath)} ${quote(probe)}\nfi\nexec /usr/bin/flock "$@"\n`);chmodSync(join(bin,"flock"),0o755);
  s.env.PATH=bin+":"+s.env.PATH;
  const resource=GateResource.tryAcquire(join(s.home,".cache/nts-parallel-20261004/mainctl/gate-tree.lock"))!;
  const pending=land(s,tree),queue=join(s.home,".cache/nts-land/queue");
  let result:Landed;
  try {
    const stopped=()=>pending.child.exitCode===null?undefined:`lander exited ${pending.child.exitCode}`;
    await until("the lander's initial lock probe",()=>existsSync(held),{stopped});
    assert.ok(existsSync(queue) && readdirSync(queue).length>0);
    assert.equal(spawnTest("/usr/bin/flock",["-n",lock,"true"]).status,1,"queue publication does not prove the landing lock is free");
    writeFileSync(release,"");
    await until("the landing lock to be released while the gate resource is busy",()=>{
      const checked=spawnTest("/usr/bin/flock",["-n",lock,"true"]);
      assert.ok(checked.status===0 || checked.status===1,checked.stderr);
      return checked.status===0;
    },{stopped});
    assert.equal(gates(s),0);
  } finally {
    writeFileSync(release,"");resource.close();result=await pending.done;
  }
  assert.equal(result.status,0,result.out);
});

test("an older lock holder waiting for pinned.sh cannot deadlock a new train",async()=>{
  const s=scratch();
  writeFileSync(join(s.root,"tooling/gate/pinned.sh"),"\n# nts-gate-tree-lock-handoff: 8\n"+controls(s,STAND_IN_GATE+reportContext));
  run(s,s.root,["add","tooling/gate/pinned.sh"]);run(s,s.root,["commit","-qm","lock handoff"]);
  const tree=lane(s,"tsrs/older-holder",{"one.txt":"one\n"}),ready=join(s.home,"ready"),go=join(s.home,"go");
  const gateLock=join(s.home,".cache/nts-parallel-20261004/mainctl/gate-tree.lock");
  const holder=spawn("flock",[join(s.home,".cache/nts-land.lock"),"sh","-c",'touch "$1"; while [ ! -f "$2" ]; do sleep 0.02; done; flock "$3" true',"_",ready,go,gateLock]);
  const stopped=new Promise<number|null>(resolve=>holder.on("close",resolve));
  await until("old holder to take landing lock",()=>existsSync(ready));
  const pending=land(s,tree),queue=join(s.home,".cache/nts-land/queue");
  await until("new train to queue",()=>existsSync(queue) && readdirSync(queue).length>0);
  writeFileSync(go,"");assert.equal(await stopped,0);
  const result=await pending.done;assert.equal(result.status,0,result.out);
});

test("an unwritable verification journal refuses before any fast-forward", async () => {
  const s=scratch(), tree=lane(s,"ledger-unavailable",{"change":"one\n"});
  const base=run(s,s.root,["rev-parse","main"]);
  const directory=join(s.home,".cache/nts-land");mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,"verification"),"this is not a directory");
  const result=await land(s,tree).done;
  assert.notEqual(result.status,0,result.out);
  assert.equal(run(s,s.root,["rev-parse","main"]),base);
  assert.equal(gates(s),0);
});

test("a fast landing replays and rechecks if main moves before the short lock", async () => {
  const s = scratch(); fastGate(s);
  const tree = lane(s, "fast-moved", { "docs/new.md": "doc\n" });
  const original = run(s, tree, ["rev-parse", "HEAD"]);
  const wait = join(s.home, "checking"); s.env.LAND_TEST_FAST_WAIT = wait;
  const pending = land(s, tree);
  await until("private tree checks", () => existsSync(wait));
  assert.ok(!existsSync(join(s.home, ".cache/nts-land/queue")));
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
  assert.ok(!existsSync(join(s.home, ".cache/nts-land/queue")));
});

test("changed owed rules on main route a previously fast change through the gate", async () => {
  const s = scratch(); fastGate(s);
  const tree = lane(s, "fast-now-strict", { "docs/new.md": "doc\n" });
  const wait = join(s.home, "checking"); s.env.LAND_TEST_FAST_WAIT = wait;
  const pending = land(s, tree);
  await until("private tree checks", () => existsSync(wait));
  writeFileSync(join(s.root, "tooling/gate/owed.mjs"), 'process.stdout.write(\'NTS_GATE_STEPS="fake" sh tooling/gate/all.sh\\n\');\n');
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
  assert.ok(!existsSync(join(s.home, ".cache/nts-land/queue")));
});

// Check the state itself; the common guard reports a hung fixture by name.
const until = waitFor;

test("a landing keeps its warm cache and uses one optimized line-table variant", async () => {
  const s = scratch();
  const tree = lane(s, "warm-tests", { "change": "one\n" });
  const cache = join(s.home, ".cache/nts-parallel-20261004/mainctl/gate-target/debug/build/generated/out");
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, "private.rs"), "generated cache content\n");
  const result = await land(s, tree).done;
  assert.equal(result.status, 0, result.out);
  assert.equal(readFileSync(join(cache, "private.rs"), "utf8"), "generated cache content\n");
  const runs = join(s.home, ".cache/nts-land/runs");
  const run = readdirSync(runs)[0];
  assert.equal(readFileSync(join(runs, run, "test-debug-mode"), "utf8"), "line-tables-only");
  assert.equal(readFileSync(join(runs, run, "test-opt-level"), "utf8"), "1");
});

test("an oversized Cargo cache is cleaned whole and the train proceeds", async () => {
  const s = scratch();
  writeFileSync(join(s.root, "Cargo.toml"), "[workspace]\n");
  run(s, s.root, ["add", "Cargo.toml"]);
  run(s, s.root, ["commit", "-q", "-m", "Cargo workspace"]);
  const tree = lane(s, "cache-limit", { "change": "one\n" });
  const cache = join(s.home, ".cache/nts-parallel-20261004/mainctl/gate-target/debug/build/generated/out");
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, "private.rs"), "obsolete generated output\n");
  const target = join(s.home, ".cache/nts-parallel-20261004/mainctl/gate-target");
  mkdirSync(join(target, "debug/.fingerprint/old"), { recursive: true });
  writeFileSync(join(target, "debug/.fingerprint/old/state"), "obsolete Cargo state\n");
  mkdirSync(join(target, "release"));
  writeFileSync(join(target, "release/nts"), "keep release\n");
  assert.equal(existsSync(join(target, "CACHEDIR.TAG")), false);
  const bin = join(s.home, "bin");
  mkdirSync(bin);
  // Exercise the real landing guard without allocating seventy GiB.
  writeFileSync(join(bin, "du"), "#!/bin/sh\nprintf '73400320\\tcache\\n'\n");
  chmodSync(join(bin, "du"), 0o755);
  s.env.PATH = `${bin}:${s.env.PATH}`;
  const result = await land(s, tree).done;
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /Cargo dev-profile clean removed 70.0 GiB/);
  assert.equal(existsSync(join(target, "debug")), false);
  assert.equal(readFileSync(join(target, "release/nts"), "utf8"), "keep release\n");
  assert.match(readFileSync(join(target, "CACHEDIR.TAG"), "utf8"), /^Signature: 8a477f597d28d172789f06886806bc55\n/);
  assert.equal(gates(s), 1, "the train runs after cleaning the obsolete profile");
});

test("low disk still refuses a train and keeps a warm profile", () => {
  const s = scratch();
  writeFileSync(join(s.root, "Cargo.toml"), "[workspace]\n");
  run(s, s.root, ["add", "Cargo.toml"]);
  run(s, s.root, ["commit", "-q", "-m", "Cargo workspace"]);
  const tree = lane(s, "disk-floor", { "change": "one\n" });
  const cache = join(s.home, ".cache/nts-parallel-20261004/mainctl/gate-target/debug/keep");
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, "keep the warm profile\n");
  // Replace the free-space observation without filling the shared disk. The
  // preload must survive the lander's re-entry under its own flock.
  const preload = join(s.home, "low-disk.ts");
  writeFileSync(preload, `import fs from "node:fs";\nimport { syncBuiltinESMExports } from "node:module";\nconst actual = fs.statfsSync;\nfs.statfsSync = (...args) => ({ ...actual(...args), bavail: 1 });\nsyncBuiltinESMExports();\n`);
  const result = spawnTest(process.execPath, [LAND, "HEAD"], { cwd: tree, env: { ...s.env, NODE_OPTIONS: `--import=${preload}` }, encoding: "utf8" });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /working space above the 40 GiB disk floor/);
  assert.equal(readFileSync(cache, "utf8"), "keep the warm profile\n");
  assert.equal(gates(s), 0);
});

test("missing gate environment refuses before queueing or waiting for a held lock", async () => {
  const s = scratch();
  const tree = lane(s, "android-env", {
    "tooling/gate/owed.mjs": 'console.log(\'NTS_GATE_STEPS="dex"\');\n',
    "tooling/gate/run.mjs": 'process.stdout.write(JSON.stringify({dex: ["android"]}));\n',
  });
  s.env.ANDROID_HOME = "";
  const lock = join(s.home, ".cache/nts-land.lock");
  writeFileSync(lock, "");
  const holder = spawn("flock", [lock, process.execPath, "-e", "process.stdin.resume()"], { detached: true });
  try {
    await until("the lock to be held", () => readFileSync("/proc/locks", "utf8").includes(`${holder.pid} `));
    const result = spawnTest(process.execPath, [LAND, "HEAD"], { cwd: tree, env: s.env, encoding: "utf8",});
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /ANDROID_HOME is missing; required by step dex/);
    assert.match(result.stderr, /node tooling\/lanes\/land-unit.ts/);
    assert.equal(existsSync(join(s.home, ".cache/nts-land/queue")), false);
    assert.equal(gates(s), 0);
  } finally {
    process.kill(-holder.pid!, "SIGTERM");
  }
});

test("the locked train rechecks capabilities before starting its gate", async () => {
  const s = scratch();
  const tree = lane(s, "train-env", {
    "tooling/gate/owed.mjs": 'console.log(\'NTS_GATE_STEPS="dex"\');\n',
    "tooling/gate/run.mjs": 'process.stdout.write(JSON.stringify({dex: ["android"]}));\n',
  });
  s.env.ANDROID_HOME = "";
  // Enter at the train half, bypassing the pre-queue check as its flock child does.
  s.env.NTS_LAND_LOCKED = "1";
  const result = await land(s, tree).done;
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /ANDROID_HOME is missing; required by step dex/);
  assert.equal(gates(s), 0);
});

/** Land every tree at once: the lock is held until all of them are queued. */
async function landTogether(s: Scratch, trees: string[]): Promise<Landed[]> {
  const lock = join(s.home, ".cache/nts-land.lock");
  writeFileSync(lock, "");
  // Its own process group: `sleep` inherits the lock from `flock`, so both go.
  const holder = spawn("flock", [lock, process.execPath, "-e", "process.stdin.resume()"], { detached: true });
  await until("the lock to be held", () => readFileSync("/proc/locks", "utf8").includes(`${holder.pid} `));
  // One at a time, so the queue's order is the order given.
  const queue = join(s.home, ".cache/nts-land/queue");
  const landings = [];
  for (const tree of trees) {
    landings.push(land(s, tree));
    await until(`${tree} to queue`, () => existsSync(queue) && readdirSync(queue).length === landings.length);
  }
  process.kill(-holder.pid!, "SIGTERM");
  return Promise.all(landings.map((l) => l.done));
}

const gates = (s: Scratch) => (existsSync(s.gates) ? readFileSync(s.gates, "utf8").trim().split("\n").length : 0);
const onMain = (s: Scratch, path: string) => spawnTest("git", ["cat-file", "-e", `main:${path}`], { cwd: s.root, env: s.env }).status === 0;

test("native inputs link the upstream TypeScript corpus without an external compiler", () => {
  const s = scratch();
  const corpus = join(s.root, "third_party/typescript");
  mkdirSync(corpus, { recursive: true });
  writeFileSync(join(corpus, "marker"), "upstream corpus\n");
  const a = lane(s, "native-inputs", { "pnpm-lock.yaml": "importers: {}\n" });
  for (const mode of ["lane", "gate"]) {
    const prepared = spawnTest("sh", [new URL("./inputs.sh", import.meta.url).pathname, mode, s.root, a], { env: s.env, encoding: "utf8" });
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.equal(realpathSync(join(a, "third_party/typescript")), corpus);
  }
});

test("landing refuses a caller checker override before enqueue", async () => {
  const s = scratch();
  s.env.LAND_TEST_CHECKERS = "1";
  s.env.NTS_CHECKERS = "8";
  const a = lane(s, "frontend", { "a.txt": "a" });
  const result = await land(s, a).done;
  assert.equal(result.status, 1, result.out);
  assert.match(result.out,/launcher verdict-policy.*NTS_CHECKERS/);
  assert.equal(existsSync(join(s.home,".cache/nts-land/queue")),false);
});

test("the gate and its grandchild exclude the measurement core, preserving an E-core caller", { skip: process.platform !== "linux" }, async () => {
  const inherited = inheritedCpus();
  const eCores = cpuList(inherited).filter((cpu) => cpu >= 16);
  assert.ok(eCores.length > 0, "this host has E-cores for the inherited-mask control");
  for (const confined of [undefined, String(eCores[0])]) {
    const s = scratch();
    s.env.LAND_TEST_AFFINITY = join(s.home, "affinity.json");
    const tree = lane(s, "affinity", { "a.txt": "a\n" });
    const result = await land(s, tree, confined).done;
    assert.equal(result.status, 0, result.out);
    const expected = gateCpus(confined ?? inherited);
    assert.deepEqual(readFileSync(s.env.LAND_TEST_AFFINITY, "utf8").trim().split("\n"), [expected, expected]);
    assert.ok(result.out.includes(`gate affinity: CPUs ${expected}; measurement CPUs 4-5 excluded`), result.out);
    const run = JSON.parse(readFileSync(join(s.home, ".cache/nts-land/status.json"), "utf8")).run;
    assert.ok(readFileSync(join(run, "gate.log"), "utf8").includes(`gate affinity: CPUs ${expected};`));
  }
});

test("a marker a dead landing left behind does not stop the next", async () => {
  const s = scratch();
  const marker = join(s.home, ".cache/nts-parallel-20261004/mainctl/GATE-RUNNING");
  writeFileSync(marker, "land deadbeef0000 2026-10-21T19:37:31.275Z\n");
  const a = lane(s, "a", { "a.txt": "a\n" });
  const r = await land(s, a).done;
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /removing a dead landing's marker/);
  assert.ok(onMain(s, "a.txt"));
  assert.ok(!existsSync(marker), "the landing removes its own marker when it is done");
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

function memoryGate(s: Scratch, mainRed = false): void {
  writeFileSync(join(s.root, "tooling/gate/run.mjs"), 'process.stdout.write(JSON.stringify({fake: [], memory: []}));\n');
  writeFileSync(join(s.root, "tooling/gate/owed.mjs"), `
import { execFileSync } from "node:child_process";
const changed = execFileSync("git", ["diff", "--name-only", process.argv.at(-1)], {encoding: "utf8"}).split("\\n");
const steps = changed.includes("SELECT_MEMORY") ? "fake memory" : "fake";
console.log('NTS_GATE_STEPS="' + steps + '" sh tooling/gate/all.sh');
`);
  writeFileSync(join(s.root, "tooling/gate/pinned.sh"), controls(s,STAND_IN_GATE.slice(0, STAND_IN_GATE.indexOf("verdict=green step=PASS")) + `
node - "$sha" <<'JS'
const {appendFileSync, existsSync, writeFileSync} = require("node:fs");
const {join} = require("node:path");
const requested = process.env.NTS_GATE_STEPS.split(/\\s+/);
const culprit = existsSync(join(process.env.NTS_GATE_TREE, "BAD_MEMORY"));
const steps = requested.map(name => ({name, verdict: name === "memory" && culprit ? "FAIL" : "PASS"}));
appendFileSync(process.env.LAND_TEST_GATES + ".steps", JSON.stringify({requested, culprit}) + "\\n");
writeFileSync(join(process.env.NTS_GATE_RUN_DIR, "summary.json"), JSON.stringify({
  verdict: steps.some(s => s.verdict === "FAIL") ? "red" : "green",
  environment:JSON.parse(process.env.NTS_GATE_ENV_CONTEXT).report,
  steps, requested, started: "t", wall_s: 1, identities: {commit: process.argv[2]},
}));
JS
`));
  if (mainRed) writeFileSync(join(s.root, "BAD_MEMORY"), "already red on main\n");
  run(s, s.root, ["add", "tooling/gate", ...(mainRed ? ["BAD_MEMORY"] : [])]);
  run(s, s.root, ["commit", "-q", "-m", "a memory check selected only by another landing"]);
}

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

test("a landing that conflicts with one ahead of it is refused, and the train goes on", async () => {
  const s = scratch();
  const a = lane(s, "a", { "shared.txt": "from a\n" });
  const b = lane(s, "b", { "shared.txt": "from b\n" });
  const c = lane(s, "c", { "c.txt": "c\n" });
  const [ra, rb, rc] = await landTogether(s, [a, b, c]);
  assert.equal(ra.status, 0, ra.out);
  assert.equal(rc.status, 0, rc.out);
  assert.equal(rb.status, 1, rb.out);
  assert.match(rb.out, /does not replay onto main \(\w+\) or the 1 landing\(s\) ahead of it/);
  assert.equal(readFileSync(join(a, "shared.txt"), "utf8"), "from a\n");
  assert.equal(run(s, s.root, ["show", "main:shared.txt"]), "from a");
  assert.equal(gates(s), 1);
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

test("a landing that repeats one ahead of it in a red train is not told it landed", async () => {
  const s = scratch();
  const red = lane(s, "red", { RED: "\n", "a.txt": "a\n" });
  const again = lane(s, "again", { RED: "\n", "a.txt": "a\n" });
  const [rr, ra] = await landTogether(s, [red, again]);
  assert.equal(rr.status, 1, rr.out);
  assert.equal(ra.status, 1, ra.out);
  assert.ok(!onMain(s, "a.txt"));
});

test("the interop projects owed.mjs names reach the gate", async () => {
  const s = scratch();
  const a = lane(s, "a", { INTEROP: "java-from-ts ts-from-java\n" });
  const [ra] = await landTogether(s, [a]);
  assert.equal(ra.status, 0, ra.out);
  assert.match(ra.out, /owes: fake \(interop: java-from-ts ts-from-java\)/);
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
  const queue = join(s.home, ".cache/nts-land/queue");
  await until("it to queue", () => existsSync(queue) && readdirSync(queue).length === 1);
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

// Upkeep must fail closed when an own-user cwd cannot be read. A real host
// process can become non-dumpable while another tooling test execs it, so the
// deletion assertion cannot depend on the host's /proc. Supply only cwd
// observations in these child processes; Git, the lander and retirement stay
// real, and the child's own idle cwd still tests its move out of the tree.
for (const state of ["idle", "busy", "unreadable"] as const) {
  test(`post-landing scratch retirement respects ${state} process observations`, async () => {
    const s = scratch();
    const home = lane(s, "compiler/scratch", { "landed.txt": "landed\n" });
    run(s, s.root, ["tag", "compiler/scratch", "main"]); // An ambiguous short name is not a branch identity.
    const disposable = join(s.home, ".cache/nts-scratch/compiler/submission"); mkdirSync(dirname(disposable), { recursive: true }); run(s, s.root, ["worktree", "move", home, disposable]);
    const preload = "data:text/javascript," + encodeURIComponent(`
      import fs from "node:fs";
      import {syncBuiltinESMExports} from "node:module";
      const readlink = fs.readlinkSync;
      fs.readlinkSync = function(path, ...args) {
        if (/^\\/proc\\/\\d+\\/cwd$/.test(String(path))) {
          if (String(path) !== "/proc/" + process.pid + "/cwd") return "/";
          if (${JSON.stringify(state)} === "unreadable") throw Object.assign(new Error("fixture: cwd unreadable"), {code:"EACCES"});
          return ${JSON.stringify(state)} === "busy" ? ${JSON.stringify(disposable)} : process.cwd();
        }
        return readlink.call(this, path, ...args);
      };
      syncBuiltinESMExports();
    `);
    s.env.NODE_OPTIONS = `${s.env.NODE_OPTIONS ?? ""} --import=${preload}`;
    const r = await land(s, disposable).done;
    assert.equal(r.status, 0, r.out);
    assert.ok(onMain(s, "landed.txt"), r.out);
    const upkeep = readFileSync(join(s.home, ".cache/nts-land/upkeep.jsonl"), "utf8");
    const branch = run(s, s.root, ["for-each-ref", "refs/heads/compiler/scratch"]);
    assert.equal(existsSync(disposable), state !== "idle", r.out);
    if (state === "idle") {
      assert.equal(branch, "", r.out);
      assert.match(upkeep, /"operation":"delete-landed-topic"/, r.out);
    } else {
      assert.ok(branch, r.out);
      assert.match(upkeep, state === "busy" ? /process cwd inside submission: \d+/ : /Cannot inspect own-user PID \d+/, r.out);
      assert.match(upkeep, /"status":"still checked out"/, r.out);
      assert.doesNotMatch(upkeep, /"operation":"delete-landed-topic"/, r.out);
    }
    assert.ok(run(s, s.root, ["for-each-ref", "refs/tags/compiler/scratch"]), r.out);
    assert.ok(existsSync(join(s.home, ".cache/nts-parallel-20261004/mainctl/gate-tree")), "the gate cache remains\n" + r.out);
  });
}

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

test("a launcher profile override refuses before queueing and leaves its cache alone", async()=>{
  const s=scratch(),tree=lane(s,"profile-override",{change:"one\n"});
  s.env.CARGO_PROFILE_DEV_OPT_LEVEL="2";
  const result=await land(s,tree).done;
  assert.equal(result.status,1,result.out);assert.match(result.out,/launcher verdict-policy.*CARGO_PROFILE_DEV_OPT_LEVEL/);
  assert.equal(existsSync(join(s.home,".cache/nts-land/queue")),false);
});

test("a non-canonical green summary cannot land",async()=>{
  const s=scratch(),tree=lane(s,"experiment-report",{change:"one\n"});
  s.env.LAND_TEST_NON_CANONICAL="1";
  const before=run(s,s.root,["rev-parse","main"]),result=await land(s,tree).done;
  assert.equal(result.status,1,result.out);assert.match(result.out,/non-canonical or unrecorded environment is not landing evidence/);
  assert.equal(run(s,s.root,["rev-parse","main"]),before);
});
