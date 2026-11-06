import {acquireRevision,dependencyCache} from "./dependency-inputs.ts";
import {withPackageManager} from "./package-manager.ts";
import {heldLandings,prepareHeldResolution} from "./held-landings.ts";
import {queuedLandings} from "./landing-state.ts";
import { hostEnvironment, launcherPolicyNames } from "../gate/canonical-environment.ts";
import { toolingSliceArgs } from "../gate/tooling-slice.ts";
import { spawnTest as processTest, waitFor } from "../gate/test-wait.ts";
// Shared fixture for the land.ts tests (land-*.test.ts), split by topic so
// node's test runner runs them in parallel, one process per file. It declares
// and registers no test: each topic file registers its own.
//
// land.ts against a scratch repository and a stand-in gate: the train.
//
//   node --test tooling/lanes/land-*.test.ts
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
import {fixtureInputs} from "./node-inputs-test-fixture.ts";
import {acquire as acquireNodeInputs} from "./node-inputs.ts";

// Fake gates read their own fixture controls from a private file. The real
// gate environment deliberately does not forward these launcher variables.
export function saveControls(env:NodeJS.ProcessEnv):void {
  if (!env.LAND_TEST_CONTROLS) return;
  const quote=(value:string)=>"'"+value.replaceAll("'", "'\\''")+"'";
  writeFileSync(env.LAND_TEST_CONTROLS+".json",JSON.stringify({imports:[...(env.NODE_OPTIONS??"").matchAll(/--import=([^ ]+)/g)].map(match=>match[1])}));
  writeFileSync(env.LAND_TEST_CONTROLS,Object.entries(env).filter(([k,v])=>k.startsWith("LAND_TEST_") && v!==undefined).map(([k,v])=>`export ${k}=${quote(v!)}`).join("\n")+"\n");
}
export const spawnTest:typeof processTest=(command,args,options,what)=>{saveControls(options?.env ?? {});return processTest(command,args,options,what);};
export const controls=(s:Scratch,text:string)=>`. '${s.env.LAND_TEST_CONTROLS}'\n${text}`;
export const reportContext=`node - "$NTS_GATE_RUN_DIR/summary.json" <<'CONTEXT'
const fs=require("node:fs"),path=process.argv[2],summary=JSON.parse(fs.readFileSync(path));
summary.environment=JSON.parse(process.env.NTS_GATE_ENV_CONTEXT).report;
if (process.env.LAND_TEST_NON_CANONICAL) summary.environment.canonical=false;
const members=Number(process.env.NTS_GATE_TRAIN_MEMBERS||0),failed=summary.steps.find(row=>row.verdict==='FAIL'&&!row.instrument);
if(members>1&&failed) summary.train_red_stop={version:1,commit:summary.identities.commit,members,trigger:failed.name,cancelled:[],decided_at:'2026-11-05T22:00:00.000Z',drained_at:'2026-11-05T22:00:01.000Z'};
summary.fail_fast=false;summary.interrupted=null;
if(summary.train_red_stop&&process.env.LAND_TEST_PROOF_FAULT==='missing')delete summary.train_red_stop;
if(summary.train_red_stop&&process.env.LAND_TEST_PROOF_FAULT==='foreign')summary.train_red_stop.commit='f'.repeat(40);
if(summary.train_red_stop&&process.env.LAND_TEST_PROOF_FAULT==='contradictory')summary.train_red_stop.cancelled=[failed.name];
if(process.env.LAND_TEST_PROOF_FAULT==='drain-timeout'){summary.scope_execution=true;summary.scope_cleanup={state:'error',reason:'step cgroup drain timed out'};}
if(process.env.LAND_TEST_PROOF_FAULT==='passing-red'){delete summary.train_red_stop;summary.steps=summary.steps.map(row=>({...row,verdict:'PASS'}));summary.verdict='red';}
if(process.env.LAND_TEST_PROOF_FAULT==='interrupted')summary.interrupted='signal SIGTERM';
fs.writeFileSync(path,JSON.stringify(summary));
CONTEXT
`;

export const LAND = new URL("./land.ts", import.meta.url).pathname;

export const STAND_IN_GATE = `set -eu
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

export type Scratch = { root: string; home: string; gates: string; env: NodeJS.ProcessEnv };

export const made: string[] = [];
export const ownUnits: string[] = [];
export const ownClients = new Set<Promise<Landed>>();
export async function cleanupFixtures():Promise<void> {
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
export function test(name:string,optionsOrBody:TestOptions|((t:TestContext)=>unknown),body?:(t:TestContext)=>unknown) {
  const options=typeof optionsOrBody==="function"?{}:optionsOrBody;
  const run=typeof optionsOrBody==="function"?optionsOrBody:body!;
  return nativeTest(name,options,async t=>{try{return await run(t);}finally{await cleanupFixtures();}});
}

export function scratch(): Scratch {
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
  const program=readFileSync(runtime,"utf8"),ready=program.replace("new Admission({ report: say })","new Admission({ read: () => 32, report: say })");
  assert.notEqual(ready,program,"the stand-in controller owns its retry admission policy");
  writeFileSync(runtime,ready);

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

export function run(s: Scratch, cwd: string, args: string[]): string {
  const r = spawnTest("git", args, { cwd, env: s.env, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A lane's tree on its own branch from main, with one commit writing `files`. */
export function lane(s: Scratch, name: string, files: Record<string, string>): string {
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

export type Landed = { status: number | null; out: string };

export type QueuedRecord={id:string;sha:string;pid:number;unit?:string;durable?:boolean};
export function queuedForUnit(s:Scratch,unit:string):QueuedRecord|undefined {
  const queue=join(s.home,".cache/nts-land/pending");
  for(const name of existsSync(queue)?readdirSync(queue):[]){
    if(!name.endsWith(".json"))continue;
    try{const row=JSON.parse(readFileSync(join(queue,name),"utf8"));if(name===row.id+".json"&&row.unit===unit)return row;}catch{}
  }
}
export function land(s: Scratch, tree: string, cpus?: string): { child: ChildProcess; done: Promise<Landed>; unit:string; record:()=>QueuedRecord|undefined } {
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

export function fastGate(s: Scratch): void {
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

// Check the state itself; the common guard reports a hung fixture by name.
export const until = waitFor;

export function observeDisk(s:Scratch,availableBytes:number):string {
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

/** Land every tree at once: the lock is held until all of them are queued. */
export async function landTogether(s: Scratch, trees: string[]): Promise<Landed[]> {
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

export const gates = (s: Scratch) => (existsSync(s.gates) ? readFileSync(s.gates, "utf8").trim().split("\n").length : 0);
export const onMain = (s: Scratch, path: string) => spawnTest("git", ["cat-file", "-e", `main:${path}`], { cwd: s.root, env: s.env }).status === 0;

export function memoryGate(s: Scratch, mainRed = false): void {
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
`+reportContext));
  if (mainRed) writeFileSync(join(s.root, "BAD_MEMORY"), "already red on main\n");
  run(s, s.root, ["add", "tooling/gate", ...(mainRed ? ["BAD_MEMORY"] : [])]);
  run(s, s.root, ["commit", "-q", "-m", "a memory check selected only by another landing"]);
}

export function resourceGate(s:Scratch,mode:"candidate-red"|"both-red"|"both-pass"|"mixed"|"mismatch"):void {
  const completed=Array.from({length:39},(_,i)=>`done-${i}`),names=[...completed,"resource-c","resource-llvm"];
  writeFileSync(join(s.root,"tooling/gate/run.mjs"),`process.stdout.write(JSON.stringify(${JSON.stringify(Object.fromEntries(names.map(name=>[name,[]])))}));\n`);
  writeFileSync(join(s.root,"tooling/gate/owed.mjs"),selectorFixture({steps:JSON.stringify(names),projects:"null",catalogue:JSON.stringify(names)}));
  writeFileSync(join(s.root,"tooling/gate/pinned.sh"),controls(s,STAND_IN_GATE.slice(0,STAND_IN_GATE.indexOf("verdict=green step=PASS"))+`
node --input-type=module - "$sha" <<'RESOURCE'
import {appendFileSync,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {beginComparison,digest,resourceStop} from ${JSON.stringify(new URL("./resource-comparison.ts",import.meta.url).href)};
const requested=process.env.NTS_GATE_STEPS.split(/\\s+/),candidate=existsSync(join(process.env.NTS_GATE_TREE,'CANDIDATE'));
const full=requested.length===41,mode=${JSON.stringify(mode)},compiler=digest(process.argv[2]);
const steps=requested.map(name=>{
 const resource=name.startsWith('resource-');
 const fail=resource&&(candidate?(full||mode==='candidate-red'||mode==='both-red'||mode==='mixed'||mode==='mismatch'):mode==='both-red');
 if(resource){
   const report=beginComparison({...process.env,NTS_GATE_STEP:name,NTS_GATE_STEP_ATTEMPT:process.env.NTS_GATE_RUN_DIR,NTS_GATE_STEP_RESULT:join(process.env.NTS_GATE_RUN_DIR,name+'.instrument.json')});
   const stop=resourceStop('case.js',{bucket:name==='resource-c'?'memory-cap':'timeout',why:'emit'});
   report.complete({suite:'test262',under:'test/staging',backend:name,compiler,record:digest('record'),selection:digest('population'),policy:digest(mode==='mismatch'&&!candidate?'changed budget':'budget')},fail?(mode==='mixed'?2:1):0,fail?[stop]:[]);
 }
 return {name,verdict:fail?'FAIL':'PASS'};
});
appendFileSync(process.env.LAND_TEST_GATES+'.scopes',JSON.stringify({requested,candidate})+'\\n');
writeFileSync(join(process.env.NTS_GATE_RUN_DIR,'summary.json'),JSON.stringify({requested,steps,verdict:steps.some(row=>row.verdict==='FAIL')?'red':'green',started:'t',wall_s:1,identities:{commit:process.argv[2],nts:{sha256:compiler}},environment:JSON.parse(process.env.NTS_GATE_ENV_CONTEXT).report}));
RESOURCE
`+reportContext));
  run(s,s.root,["add","tooling/gate"]);run(s,s.root,["commit","-qm","typed resource gate"]);
}

export function boundaryFixture():Scratch {
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
export function gateEvents(s:Scratch):string[]{const path=s.env.LAND_TEST_TRAIN_EVENTS!;return existsSync(path)?readFileSync(path,"utf8").trim().split("\n").filter(Boolean):[];}
export function releaseTrain(s:Scratch,index:number):void{writeFileSync(`${s.env.LAND_TEST_TRAIN_WAIT}.${gateEvents(s)[index]}`,"release\n");}
export function pendingReady(s:Scratch):{blockedReason?:string}[]{const dir=join(s.home,".cache/nts-land/ready");return existsSync(dir)?readdirSync(dir).filter(n=>n.endsWith(".json")).map(n=>JSON.parse(readFileSync(join(dir,n),"utf8"))):[];}


export function serviceSubmission(s: Scratch, tree: string): string {
  saveControls(s.env);
  const unit=`nts-test-land-submit-${randomUUID().slice(0,8)}`;ownUnits.push(unit);
  const client=gateCommand(process.execPath,[LAND,"HEAD"]);
  const result=spawnTest("systemd-run",["--user","--collect",...toolingSliceArgs(s.env),`--unit=${unit}`,`--working-directory=${tree}`,"--property=LimitCORE=0",...systemdEnvironment(s.env),...(s.env.NTS_TOOLING_SLICE?[`--setenv=NTS_TOOLING_SLICE=${s.env.NTS_TOOLING_SLICE}`]:[]),`--setenv=NTS_LAND_HOME=${s.home}`,`--setenv=NTS_LAND_SUBMISSION_UNIT=${unit}`,client.command,...client.args],{encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);return unit;
}
export function frozenBarrier(s: Scratch): {entered:string;release:string} {
  const entered=join(s.home,"frozen-entered"),release=join(s.home,"frozen-release");
  const file=join(s.root,"tooling/gate/pinned.sh");
  writeFileSync(file,readFileSync(file,"utf8").replace("verdict=green step=PASS",`touch '${entered}'\nwhile [ ! -e '${release}' ]; do sleep 0.02; done\nverdict=green step=PASS`));
  run(s,s.root,["add","tooling/gate/pinned.sh"]);run(s,s.root,["commit","-qm","frozen gate barrier"]);
  return {entered,release};
}
export function states(s: Scratch) {
  const directory=join(s.home,".cache/nts-land/results");
  return existsSync(directory)?readdirSync(directory).filter(file=>file.endsWith(".json")).map(file=>JSON.parse(readFileSync(join(directory,file),"utf8"))):[];
}
