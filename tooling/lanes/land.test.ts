import {heldLandings,prepareHeldResolution} from "./held-landings.ts";
import {queuedLandings} from "./landing-state.ts";
import { hostEnvironment, launcherPolicyNames } from "../gate/canonical-environment.ts";
import { toolingSliceArgs } from "../gate/tooling-slice.ts";
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
import { chmodSync, cpSync, existsSync, symlinkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test as nativeTest, type TestContext, type TestOptions } from "node:test";
import assert from "node:assert/strict";
import { cpuList, gateCpus, inheritedCpus, gateCommand } from "../gate/affinity.ts";
import { readLedger, VerificationLedger } from "./verification-ledger.ts";
import {GateResource} from "./gate-resource.ts";
import {STANDING_GATE_POLICY} from "../gate/verdict-policy.ts";
import {randomUUID} from "node:crypto";
import {systemdEnvironment} from "../gate/environment.ts";
import {selectorFixture} from "./selector-fixture.ts";

// Fake gates read their own fixture controls from a private file. The real
// gate environment deliberately does not forward these launcher variables.
function saveControls(env:NodeJS.ProcessEnv):void {
  if (!env.LAND_TEST_CONTROLS) return;
  const quote=(value:string)=>"'"+value.replaceAll("'", "'\\''")+"'";
  writeFileSync(env.LAND_TEST_CONTROLS+".json",JSON.stringify({imports:[...(env.NODE_OPTIONS??"").matchAll(/--import=([^ ]+)/g)].map(match=>match[1])}));
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
node - "$NTS_GATE_RUN_DIR/summary.json" <<'REQUESTED_STEPS'
const fs=require("node:fs"),file=process.argv[2],summary=JSON.parse(fs.readFileSync(file));
const requested=(process.env.NTS_GATE_STEPS||"fake").split(/\\s+/).filter(Boolean),row=summary.steps[0];
summary.requested=requested;summary.steps=requested.map(name=>({...row,name}));
fs.writeFileSync(file,JSON.stringify(summary));
REQUESTED_STEPS
`;

type Scratch = { root: string; home: string; gates: string; env: NodeJS.ProcessEnv };

const made: string[] = [];
const ownUnits: string[] = [];
const ownClients = new Set<Promise<Landed>>();
async function cleanupFixtures():Promise<void> {
  for(const unit of ownUnits.splice(0))processTest("systemctl",["--user","stop",unit],{encoding:"utf8"});
  await Promise.all([...ownClients]);
  for (const dir of made.splice(0)) {
    const trains=join(dir,"home/.cache/nts-land/trains");
    for(const name of existsSync(trains)?readdirSync(trains):[]) {
      const manifest=join(trains,name,"owner.json");if(!existsSync(manifest))continue;
      const owner=JSON.parse(readFileSync(manifest,"utf8"));
      processTest("systemctl",["--user","stop",owner.unit],{encoding:"utf8"});
    }
    rmSync(dir, { recursive: true, force: true });
  }
}
after(cleanupFixtures);
function test(name:string,optionsOrBody:TestOptions|((t:TestContext)=>unknown),body?:(t:TestContext)=>unknown) {
  const options=typeof optionsOrBody==="function"?{}:optionsOrBody;
  const run=typeof optionsOrBody==="function"?optionsOrBody:body!;
  return nativeTest(name,options,async t=>{try{return await run(t);}finally{await cleanupFixtures();}});
}

function scratch(): Scratch {
  const dir = mkdtempSync(join(tmpdir(), "land-test-"));
  made.push(dir);
  const root = join(dir, "repo");
  const home = join(dir, "home");
  mkdirSync(join(home, ".cache/nts-parallel-20261004/mainctl"), { recursive: true });
  mkdirSync(join(root, "tooling/gate"), { recursive: true });
  const source = new URL("../../", import.meta.url).pathname;
  for (const folder of ["tooling/gate", "tooling/lanes"]) cpSync(join(source,folder),join(root,folder),{recursive:true});
  writeFileSync(join(root,".gitignore"),"node_modules\n");
  symlinkSync(join(source,"node_modules"),join(root,"node_modules"));
  writeFileSync(join(root,"tooling/lanes/inputs.sh"),'#!/bin/sh\nln -sfn "$2/node_modules" "$3/node_modules"\n');
  const runtime=join(root,"tooling/lanes/land.ts"),context=join(dir,"controls.sh.json");
  writeFileSync(runtime,readFileSync(runtime,"utf8").replace('const argv = process.argv.slice(2);',`const argv = process.argv.slice(2);if(process.env.NTS_LAND_TRAIN_UNIT){for(const preload of JSON.parse(readFileSync(${JSON.stringify(context)},'utf8')).imports)await import(/^[a-z][a-z0-9+.-]*:/i.test(preload)?preload:pathToFileURL(preload).href);}`));

  for (const project of ["java-from-ts", "ts-from-java"]) {
    mkdirSync(join(root, "tests/interop", project), { recursive: true });
    writeFileSync(join(root, "tests/interop", project, "build.sh"), "#!/bin/sh\nexit 0\n");
  }
  writeFileSync(join(root, "tooling/gate/pinned.sh"), `. '${join(dir,"controls.sh")}'\n`+STAND_IN_GATE+reportContext);
  writeFileSync(join(root, "tooling/gate/run.mjs"), 'process.stdout.write(JSON.stringify({fake: [],interop: []}));\n');
  // Narrows interop to what a commit's INTEROP file names, as owed.mjs does.
  writeFileSync(
    join(root, "tooling/gate/owed.mjs"),
    selectorFixture(),
  );
  writeFileSync(join(root, "shared.txt"), "one\n");
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_") && !k.startsWith("NTS_") && !launcherPolicyNames({[k]:v}).length) env[k] = v;
  Object.assign(env, {
    HOME: home,
    CARGO_HOME: hostEnvironment(process.env).CARGO_HOME,
    RUSTUP_HOME: hostEnvironment(process.env).RUSTUP_HOME,
    NTS_LAND_HOME: home,
    NTS_TOOLING_SLICE: process.env.NTS_TOOLING_SLICE,
    LAND_TEST_GATES: join(dir, "gates.log"),
    LAND_TEST_CONTROLS: join(dir,"controls.sh"),
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  });
  const s = { root, home, gates: join(dir, "gates.log"), env };
  run(s, root, ["init", "-q", "-b", "main"]);
  run(s, root, ["config", "user.name", "t"]); run(s,root,["config","user.email","t@t"]);
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

type QueuedRecord={id:string;sha:string;pid:number;unit?:string;durable?:boolean};
function queuedForUnit(s:Scratch,unit:string):QueuedRecord|undefined {
  const queue=join(s.home,".cache/nts-land/pending");
  for(const name of existsSync(queue)?readdirSync(queue):[]){
    if(!name.endsWith(".json"))continue;
    try{const row=JSON.parse(readFileSync(join(queue,name),"utf8"));if(name===row.id+".json"&&row.unit===unit)return row;}catch{}
  }
}
function land(s: Scratch, tree: string, cpus?: string): { child: ChildProcess; done: Promise<Landed>; unit:string; record:()=>QueuedRecord|undefined } {
  saveControls(s.env);
  const unit=`nts-test-land-client-${randomUUID().slice(0,8)}`;ownUnits.push(unit);
  const command=cpus?"taskset":process.execPath,args=cpus?["-c",cpus,process.execPath,LAND,"HEAD"]:[LAND,"HEAD"];
  const client=gateCommand(command,args);
  const controls=Object.entries(s.env).filter(([key,value])=>value!==undefined&&(/^(?:NTS_|LAND_TEST_|GIT_|NODE_OPTIONS$)/.test(key)||launcherPolicyNames({[key]:value}).length>0)).map(([key,value])=>`--setenv=${key}=${value}`);
  const child=spawn("systemd-run",["--user","--wait","--pipe","--quiet","--collect",...toolingSliceArgs(s.env),`--unit=${unit}`,`--working-directory=${tree}`,"--property=LimitCORE=0","--property=Nice=19",...systemdEnvironment(s.env),...controls,`--setenv=NTS_LAND_SUBMISSION_UNIT=${unit}`,client.command,...client.args]);
  let out = "";
  child.stdout?.on("data", (d) => (out += d));
  child.stderr?.on("data", (d) => (out += d));
  const done = new Promise<Landed>((resolve,reject) => {child.on("error",reject);child.on("close",status=>resolve({status,out}));});
  ownClients.add(done);void done.finally(()=>ownClients.delete(done));
  return { child, done,unit,record:()=>queuedForUnit(s,unit) };
}

function fastGate(s: Scratch): void {
  writeFileSync(join(s.root, "tooling/gate/run.mjs"), 'process.stdout.write(process.argv.includes("--tree-only") ? "tree-check\\n" : JSON.stringify({"tree-check":[],fake:[]}));\n');
  writeFileSync(join(s.root, "tooling/gate/owed.mjs"), selectorFixture({steps:'["tree-check"]',projects:"null"}));
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
  assert.ok(!existsSync(join(s.home, ".cache/nts-land/pending")));
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
  const s=scratch(),tree=lane(s,"tsrs/resource-wait",{"one.txt":"one\n"});
  const lock=join(s.home,".cache/nts-land.lock"),resourcePath=join(s.home,".cache/nts-parallel-20261004/mainctl/gate-tree.lock");
  const resource=GateResource.tryAcquire(resourcePath)!;
  const pending=land(s,tree);
  let result:Landed;
  try {
    const stopped=()=>pending.child.exitCode===null?undefined:`lander exited ${pending.child.exitCode}`;
    const manifest=join(s.home,".cache/nts-land/train-owner.json");
    await until("the train owner's durable manifest",()=>existsSync(manifest),{stopped});
    const owner=JSON.parse(readFileSync(manifest,"utf8")),inode=statSync(resourcePath).ino;
    await until("the train service blocked on the gate resource",()=>readFileSync("/proc/locks","utf8").split("\n").some(line=>{
      const fields=line.trim().split(/\s+/);if(!fields.includes("->")||!fields.some(field=>field.endsWith(`:${inode}`)))return false;
      const pid=fields[5];try{return readFileSync(`/proc/${pid}/cgroup`,"utf8").includes(`/${owner.unit}.service`);}catch{return false;}
    }),{stopped});
    const checked=spawnTest("/usr/bin/flock",["-n",lock,"true"]);
    assert.equal(checked.status,0,`the service holds no landing lock while blocked on its resource: ${checked.stderr}`);
    assert.equal(gates(s),0);
  } finally { resource.close();result=await pending.done; }
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
  const pending=land(s,tree),queue=join(s.home,".cache/nts-land/pending");
  await until("new train final queue record",()=>pending.record()!==undefined);
  writeFileSync(go,"");assert.equal(await stopped,0);
  const result=await pending.done;assert.equal(result.status,0,result.out);
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

// Check the state itself; the common guard reports a hung fixture by name.
const until = waitFor;

function observeDisk(s:Scratch,availableBytes:number):string {
  const observation=join(s.home,"disk-available-bytes");
  writeFileSync(observation,String(availableBytes));
  const preload=join(s.home,"disk-observation.ts");
  writeFileSync(preload,`import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
const actual=fs.statfsSync;
fs.statfsSync=(...args)=>{const observed=actual(...args),available=Number(fs.readFileSync(${JSON.stringify(observation)},"utf8"));return {...observed,bavail:typeof observed.bsize==="bigint"?BigInt(available)/observed.bsize:Math.floor(available/observed.bsize)};};
syncBuiltinESMExports();\n`);
  s.env.NODE_OPTIONS=`--import=${preload}`;
  return observation;
}

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
  observeDisk(s,80*2**30);
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

test("low disk holds every queued submission until admission recovers", async () => {
  const s = scratch();
  writeFileSync(join(s.root, "Cargo.toml"), "[workspace]\n");
  run(s, s.root, ["add", "Cargo.toml"]);
  run(s, s.root, ["commit", "-q", "-m", "Cargo workspace"]);
  const trees = ["one","two","three"].map(name=>lane(s,`disk-floor-${name}`,{[name]:name+"\n"}));
  const cache = join(s.home, ".cache/nts-parallel-20261004/mainctl/gate-target/debug/keep");
  mkdirSync(dirname(cache), { recursive: true });
  writeFileSync(cache, "keep the warm profile\n");
  // Replace the free-space observation without filling the shared disk. The
  // preload must survive the lander's re-entry under its own flock.
  const observation=observeDisk(s,1);
  const results=landTogether(s,trees);
  try {
    const state=join(s.home,".cache/nts-land/status.json");
    await until("the queued train's disk-admission hold",()=>existsSync(state)&&JSON.parse(readFileSync(state,"utf8")).resource==="disk");
    const held=JSON.parse(readFileSync(state,"utf8"));
    assert.equal(held.state,"held");
    assert.match(held.reason,/working space above the 40 GiB disk floor/);
    assert.equal(held.train.length,3);
    assert.ok(Number.isFinite(Date.parse(held.since)));
    assert.ok(held.age_s>=0);
    assert.equal(readdirSync(join(s.home,".cache/nts-land/pending")).filter(n=>n.endsWith(".json")).length,3);
    assert.equal(readFileSync(cache,"utf8"),"keep the warm profile\n");
    assert.equal(gates(s),0,"a resource hold starts no gate");
  } finally {
    writeFileSync(observation,String(80*2**30));
  }
  for (const result of await results) assert.equal(result.status,0,result.out);
  assert.equal(gates(s),1,"all three queued submissions share the admitted train");
  for (const name of ["one","two","three"]) assert.equal(run(s,s.root,["show",`main:${name}`]),name);
  assert.equal(readFileSync(cache,"utf8"),"keep the warm profile\n");
});

test("missing gate environment refuses before queueing or waiting for a held lock", async () => {
  const s = scratch();
  const tree = lane(s, "android-env", {
    "tooling/gate/owed.mjs": selectorFixture({steps:'["dex"]',projects:"null"}),
    "tooling/gate/run.mjs": 'process.stdout.write(JSON.stringify({fake: [],dex: ["android"]}));\n',
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
    assert.equal(existsSync(join(s.home, ".cache/nts-land/pending")), false);
    assert.equal(gates(s), 0);
  } finally {
    process.kill(-holder.pid!, "SIGTERM");
  }
});

test("the locked train rechecks capabilities before starting its gate", async () => {
  const s = scratch();
  const tree = lane(s, "train-env", {
    "tooling/gate/owed.mjs": selectorFixture({steps:'["dex"]',projects:"null"}),
    "tooling/gate/run.mjs": 'process.stdout.write(JSON.stringify({fake: [],dex: ["android"]}));\n',
  });
  s.env.ANDROID_HOME="/declared/android";
  const preload=join(s.home,"remove-capability.ts");
  writeFileSync(preload,'if(process.env.NTS_LAND_TRAIN_UNIT)delete process.env.ANDROID_HOME;\n');
  s.env.NODE_OPTIONS=`--import=${preload}`;
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
  const queue = join(s.home, ".cache/nts-land/pending");
  const landings = [];
  for (const tree of trees) {
    landings.push(land(s, tree));
    await until(`${tree} final queue record`, () => landings.at(-1)!.record()!==undefined);
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
  assert.equal(existsSync(join(s.home,".cache/nts-land/pending")),false);
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
  writeFileSync(join(s.root, "tooling/gate/owed.mjs"),selectorFixture({steps:'changes.some(c=>c.path==="SELECT_MEMORY")?["fake","memory"]:["fake"]',projects:"null"}));
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
  assert.equal(existsSync(join(s.home,".cache/nts-land/pending")),false);
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

function boundaryFixture():Scratch {
  const s=scratch();fastGate(s);
  s.env.LAND_TEST_FAST_CHECKS=join(s.home,"private-checks");
  s.env.LAND_TEST_TRAIN_EVENTS=join(s.home,"train-events");
  s.env.LAND_TEST_TRAIN_WAIT=join(s.home,"release-train");
  writeFileSync(join(s.root,"tooling/gate/owed.mjs"),selectorFixture({body:"const paths=changes.map(c=>c.path);",steps:'paths.every(p=>p.startsWith("docs/"))?["tree-check"]:["fake"]',projects:"null"}));
  const pinned=join(s.root,"tooling/gate/pinned.sh");
  writeFileSync(pinned,readFileSync(pinned,"utf8")+`
if [ -n "\${LAND_TEST_TRAIN_WAIT:-}" ]; then
 echo "$sha" >> "$LAND_TEST_TRAIN_EVENTS"
 while [ ! -f "$LAND_TEST_TRAIN_WAIT.$sha" ]; do sleep 0.02; done
fi
`);
  mkdirSync(join(s.root,"docs"));writeFileSync(join(s.root,"docs/page.md"),"base\n");
  run(s,s.root,["add","tooling","docs"]);run(s,s.root,["commit","-qm","boundary fixture"]);
  return s;
}
function gateEvents(s:Scratch):string[]{const path=s.env.LAND_TEST_TRAIN_EVENTS!;return existsSync(path)?readFileSync(path,"utf8").trim().split("\n").filter(Boolean):[];}
function releaseTrain(s:Scratch,index:number):void{writeFileSync(`${s.env.LAND_TEST_TRAIN_WAIT}.${gateEvents(s)[index]}`,"release\n");}
function pendingReady(s:Scratch):{blockedReason?:string}[]{const dir=join(s.home,".cache/nts-land/ready");return existsSync(dir)?readdirSync(dir).filter(n=>n.endsWith(".json")).map(n=>JSON.parse(readFileSync(join(dir,n),"utf8"))):[];}

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


function serviceSubmission(s: Scratch, tree: string): string {
  saveControls(s.env);
  const unit=`nts-test-land-submit-${randomUUID().slice(0,8)}`;ownUnits.push(unit);
  const client=gateCommand(process.execPath,[LAND,"HEAD"]);
  const result=spawnTest("systemd-run",["--user","--collect",...toolingSliceArgs(s.env),`--unit=${unit}`,`--working-directory=${tree}`,"--property=LimitCORE=0",...systemdEnvironment(s.env),...(s.env.NTS_TOOLING_SLICE?[`--setenv=NTS_TOOLING_SLICE=${s.env.NTS_TOOLING_SLICE}`]:[]),`--setenv=NTS_LAND_HOME=${s.home}`,`--setenv=NTS_LAND_SUBMISSION_UNIT=${unit}`,client.command,...client.args],{encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);return unit;
}
function frozenBarrier(s: Scratch): {entered:string;release:string} {
  const entered=join(s.home,"frozen-entered"),release=join(s.home,"frozen-release");
  const file=join(s.root,"tooling/gate/pinned.sh");
  writeFileSync(file,readFileSync(file,"utf8").replace("verdict=green step=PASS",`touch '${entered}'\nwhile [ ! -e '${release}' ]; do sleep 0.02; done\nverdict=green step=PASS`));
  run(s,s.root,["add","tooling/gate/pinned.sh"]);run(s,s.root,["commit","-qm","frozen gate barrier"]);
  return {entered,release};
}
function states(s: Scratch) {
  const directory=join(s.home,".cache/nts-land/results");
  return existsSync(directory)?readdirSync(directory).filter(file=>file.endsWith(".json")).map(file=>JSON.parse(readFileSync(join(directory,file),"utf8"))):[];
}
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

test("recovering an answered legacy entry preserves its result bytes and original train",async()=>{
  const s=scratch(),base=run(s,s.root,["rev-parse","HEAD"]),store=join(s.home,".cache/nts-land"),id="1-1";
  mkdirSync(join(store,"queue"),{recursive:true});mkdirSync(join(store,"results"));
  writeFileSync(join(store,"queue",id+".json"),JSON.stringify({id,sha:base,pid:process.pid,tree:s.root,at:1}));
  const path=join(store,"results",id+".json"),original=JSON.stringify({state:"landed",message:"legacy proof",landing:base,main:base,trainUnit:"original-unit",trace:"original-trace"},null,4)+"\n";writeFileSync(path,original);
  const result=await land(s,lane(s,"after-legacy-answer",{a:"green\n"})).done;assert.equal(result.status,0,result.out);
  assert.equal(readFileSync(path,"utf8"),original);assert.equal(existsSync(join(store,"queue",id+".json")),false);
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

test("a legacy waiter and a measurement waiter both acquire the lock between service trains",async()=>{
  const s=scratch(),barrier=frozenBarrier(s),a=lane(s,"fair-a",{a:"green\n"}),b=lane(s,"fair-b",{b:"green\n"});
  serviceSubmission(s,a);await until("first fairness train",()=>existsSync(barrier.entered));
  const second=serviceSubmission(s,b);await until("second fairness final record",()=>queuedForUnit(s,second)!==undefined);
  const resource=join(s.home,".cache/nts-parallel-20261004/mainctl/gate-tree.lock"),landing=join(s.home,".cache/nts-land.lock");
  const legacy=join(s.home,"legacy-acquired"),measurement=join(s.home,"measurement-acquired");
  const reader=(path:string)=>"readFileSync("+JSON.stringify(path)+",'utf8')";
  const holders=[spawn("sh",["-c",'exec 8>>"$1"; exec 9>>"$2"; flock 8; flock 9; touch "$3"',"legacy",resource,landing,legacy]),spawn("sh",["-c",'exec 9>>"$1"; flock 9; touch "$2"',"measurement",landing,measurement])];
  const completed=holders.map(child=>new Promise<void>((resolve,reject)=>{child.on("error",reject);child.on("close",code=>code===0?resolve():reject(new Error(`lock waiter exited ${code}`)));}));
  // Both subprocesses really block in flock before the gate is released.
  const blocked=(child:ChildProcess)=>{
    const p= `/proc/${child.pid}/task/${child.pid}/children`;
    if(!existsSync(p))return false;const ids=readFileSync(p,"utf8").trim().split(/\s+/);
    return readFileSync("/proc/locks","utf8").split("\n").some(line=>line.includes("->")&&ids.includes(line.trim().split(/\s+/)[5]));
  };
  await until("both kernel lock waiters",()=>holders.every(blocked));
  writeFileSync(barrier.release,"continue");
  await Promise.all(completed);
  await until("both service trains finish",()=>states(s).length===2);
  assert.equal(existsSync(legacy),true);assert.equal(existsSync(measurement),true);assert.equal(gates(s),2);
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
