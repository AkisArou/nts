// land.ts tests: resources. The shared fixture is land-test-fixture.ts;
// see its header for how the stand-in gate and scratch repositories work.

import { acquireRevision, dependencyCache } from "./dependency-inputs.ts";
import { withPackageManager } from "./package-manager.ts";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, symlinkSync, mkdirSync, readdirSync, readFileSync, statSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after } from "node:test";
import assert from "node:assert/strict";
import { cpuList, gateCpus, inheritedCpus } from "../gate/affinity.ts";
import { GateResource } from "./gate-resource.ts";
import { selectorFixture } from "./selector-fixture.ts";
import { fixtureInputs } from "./node-inputs-test-fixture.ts";
import { acquire as acquireNodeInputs } from "./node-inputs.ts";
import { LAND, STAND_IN_GATE, cleanupFixtures, controls, frozenBarrier, gates, land, landTogether, lane, observeDisk, onMain, queuedForUnit, reportContext, run, scratch, serviceSubmission, spawnTest, states, test, until, type Landed } from "./land-test-fixture.ts";

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

test("native inputs link the upstream TypeScript corpus without an external compiler", async t => {
  const s = scratch();
  const corpus = join(s.root, "third_party/typescript");
  mkdirSync(corpus, { recursive: true });
  writeFileSync(join(corpus, "marker"), "upstream corpus\n");
  const a = lane(s, "native-inputs", { "package.json": JSON.stringify({name:"corpus-input-control",type:"module",private:true,packageManager:"pnpm@10.15.0"}), "pnpm-workspace.yaml":"packages: []\n", "pnpm-lock.yaml": "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n" });
  const reference=join(s.home,"node-reference"),nodeCache=join(s.home,".cache/nts-node-inputs");
  const identities=fixtureInputs(reference,"24.20.0");
  // cleanupFixtures runs in this test wrapper's finally, before t.after.
  // Restore and remove this control's immutable cache before that owner drains.
  const releaseInputs=()=>{
    function writable(path:string){if(statSync(path).isDirectory()){chmodSync(path,0o755);for(const name of readdirSync(path))writable(join(path,name));}}
    if(existsSync(nodeCache)){writable(nodeCache);rmSync(nodeCache,{recursive:true,force:true});}
  };
  try {
  acquireNodeInputs(reference,nodeCache,identities);
  for(const name of [".tool-versions","build/node-deps/recipes.json"]){
    mkdirSync(dirname(join(a,name)),{recursive:true});writeFileSync(join(a,name),readFileSync(join(reference,name)));
  }
  const scripts=join(a,"tooling/lanes");mkdirSync(scripts,{recursive:true});mkdirSync(join(a,"tooling/bootstrap"),{recursive:true});
  for(const name of ["inputs.sh","node-inputs.ts"])writeFileSync(join(scripts,name),readFileSync(new URL("./"+name,import.meta.url)));
  writeFileSync(join(scripts,"node-inputs.json"),JSON.stringify(identities));
  symlinkSync(new URL("../bootstrap/node.ts",import.meta.url).pathname,join(a,"tooling/bootstrap/node.ts"));
  assert.ok(existsSync(join(scripts,"dependency-inputs.ts")),"the landing fixture supplies the real dependency consumer");
  await withPackageManager(a,{},manager=>manager.run(["install","--offline","--lockfile-only","--ignore-scripts"]));
  run(s,a,["add","pnpm-lock.yaml"]);run(s,a,["commit","--allow-empty","-qm","canonical empty dependency lock"]);
  const cache=dependencyCache(s.root);t.after(()=>rmSync(cache,{recursive:true,force:true}));
  await acquireRevision(s.root,a,"HEAD");
  for (const mode of ["lane", "gate"]) {
    const prepared = spawnTest("sh", [join(scripts,"inputs.sh"), mode, s.root, a], { env: s.env, encoding: "utf8" });
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.equal(realpathSync(join(a, "third_party/typescript")), corpus);
  }
  } finally { releaseInputs(); }
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

test("a launcher profile override refuses before queueing and leaves its cache alone", async()=>{
  const s=scratch(),tree=lane(s,"profile-override",{change:"one\n"});
  s.env.CARGO_PROFILE_DEV_OPT_LEVEL="2";
  const result=await land(s,tree).done;
  assert.equal(result.status,1,result.out);assert.match(result.out,/launcher verdict-policy.*CARGO_PROFILE_DEV_OPT_LEVEL/);
  assert.equal(existsSync(join(s.home,".cache/nts-land/pending")),false);
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
