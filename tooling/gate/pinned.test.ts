import {gitArguments} from "./git-arguments/main.ts";
import {assignTestValues,fixtureEnvironment} from './test-environment.ts';
import { gateEnvironment, launcherPolicyNames } from "./canonical-environment.ts";
import { spawnTest, waitFor } from "./test-wait.ts";
import { copyModuleClosure } from "./module-closure-fixture.ts";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {pathToFileURL} from "node:url";
import {ownMemory,withoutHanded} from "./test-memory.ts";
import {admittedEntry,readLedger} from "./memory-ledger.ts";
import {GateResource} from "./gate-resource.ts";
import { testScratch } from "./test-scratch.ts";

const script = readFileSync(new URL("./pinned.sh", import.meta.url), "utf8");

for (const refuses of [false, true]) for (const inherited of [false,true]) {
  test(`candidate owns input preparation${refuses ? " and its failure is preserved" : ""}${inherited ? " under the inherited tree lock" : ""}`, t => {
    const directory = testScratch(t, "pinned-candidate");
    const root = join(directory, "repo");
    const tree = join(directory, "gate-tree");
    mkdirSync(join(root, "tooling/gate"), { recursive: true });
    mkdirSync(join(root, "tooling/inputs"), { recursive: true });
    const env = Object.fromEntries(Object.entries(fixtureEnvironment(t)).filter(([key]) => !key.startsWith("GIT_") && !key.startsWith("NTS_") && !launcherPolicyNames({[key]:process.env[key]}).length));
    Object.assign(env, {
      GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      NTS_GATE_TREE: tree, NTS_GATE_TARGET: join(directory, "target"), NTS_GATE_SETUP_ONLY: "1",
      NTS_GATE_RUN_DIR: join(directory, "run"),
    });
    const git = (...args: string[]) => execFileSync("git", gitArguments(args), { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    writeFileSync(join(root, "tooling/gate/pinned.sh"), script);
    copyModuleClosure(["tooling/gate/canonical-environment.ts", "tooling/inputs/linker.ts"], root);
    // Affinity is independently tested; this fixture isolates which commit
    // supplies preparation without depending on delegated host cpusets.
    writeFileSync(join(root, "tooling/gate/affinity.ts"), "");
    writeFileSync(join(root, "tooling/inputs/link.sh"), 'printf owner > "' + join(directory, "marker") + '"\n');
    git("init", "-q");
    git("add", ".");
    git("commit", "-qm", "owner");
    const owner = git("rev-parse", "HEAD");
    writeFileSync(join(root, "tooling/inputs/link.sh"), 'test -z "${NTS_GATE_LOCK_FD:-}" || { echo "lock marker leaked into candidate tools" >&2; exit 24; }\n' + (refuses
      ? 'echo "candidate input is missing" >&2\nexit 23\n'
      : 'printf candidate > "' + join(directory, "marker") + '"\n'));
    git("add", ".");
    git("commit", "-qm", "candidate");
    const candidate = git("rev-parse", "HEAD");
    git("checkout", "--detach", "-q", owner);
    const held=inherited ? GateResource.tryAcquire(`${tree}.lock`)! : null;
    const result = spawnTest("sh", [join(root, "tooling/gate/pinned.sh"), candidate], { cwd: root, env:{...env,...(held?{NTS_GATE_LOCK_FD:"8"}:{})}, encoding: "utf8",
      ...(held ? {stdio:held.stdio("pipe")} : {}) });
    held?.close();
    if (refuses) {
      assert.equal(result.status, 23, result.stdout + result.stderr);
      assert.match(result.stderr, /candidate input is missing/);
    } else {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(readFileSync(join(directory, "marker"), "utf8"), "candidate");
    }
  });
}

for (const status of [0, 23]) test(`pinned Cargo owns admission until its exit ${status}, before the gate`, async t => {
  const directory = testScratch(t, "pinned-admission"), root = join(directory, "repo"), tree = join(directory, "tree");
  const target = join(directory, "target"), bin = join(directory, "bin");
  mkdirSync(join(root, "tooling/gate"), {recursive:true});mkdirSync(bin);
  copyModuleClosure(["tooling/gate/canonical-environment.ts", "tooling/gate/admit.ts", "tooling/inputs/linker.ts"], root);
  writeFileSync(join(root, "tooling/gate/pinned.sh"), script);
  const affinity=join(root,"tooling/gate/affinity.ts"), originalAffinity=readFileSync(affinity,"utf8");
  const entry='if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)';
  assert.equal(originalAffinity.split(entry).length,2);
  writeFileSync(affinity,originalAffinity.replace(entry,'if (false)'));
  writeFileSync(join(root, "tooling/inputs/link.sh"), "exit 0\n");
  const owned = ownMemory(join(directory, "machine"));
  // Model the actual tooling parent even in a standalone focused invocation.
  const fixture=fixtureEnvironment(t);
  const parent=gateEnvironment(fixture,{run:join(directory,"parent"),owned:{NTS_GATE_STEP:"tooling"}});
  const env=withoutHanded(parent.env);
  assignTestValues(env,{NTS_GATE_STEP:undefined,NTS_GATE_STEP_ATTEMPT:undefined,NTS_GATE_STEP_RESULT:undefined,
    NTS_GATE_STEP_MEMORY_BYTES:undefined,NTS_GATE_CASE_COSTS_DIR:undefined,NTS_MEMORY_HANDOVER:undefined});
  const git = (...args:string[]) => execFileSync("git", gitArguments(args), {cwd:root,env:fixture,encoding:"utf8"}).trim();
  const memory = pathToFileURL(join(tree, "tooling/gate/memory-ledger.ts")).href;
  const cargo = join(bin, "cargo");
  writeFileSync(cargo, `#!${process.execPath}
(async()=>{
  const assert=await import('node:assert/strict'),fs=await import('node:fs');
  const {admittedEntry}=await import(${JSON.stringify(memory)});
  const id=process.env.NTS_MEMORY_RESERVATION,ledger=process.env.NTS_MEMORY_LEDGER;
  assert.ok(id,'Cargo preparation has no memory reservation');
  const entry=admittedEntry(ledger,id);assert.ok(entry,'Cargo preparation reservation is not live');
  assert.equal(process.env.CARGO_TARGET_DIR,${JSON.stringify(target)});
  fs.writeSync(1,'BUILD '+JSON.stringify({id,owner:entry.owner.pid,cargo:process.pid})+'\\n');
  const release=Buffer.alloc(1);assert.equal(fs.readSync(0,release,0,1,null),1);
  process.exitCode=${status};
})().catch(error=>{console.error(error);process.exitCode=97;});
`);chmodSync(cargo,0o755);
  writeFileSync(join(root, "tooling/gate/all.sh"), `#!/bin/sh
node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import {admittedEntry,readLedger} from './tooling/gate/memory-ledger.ts';
assert.equal(process.env.NTS_MEMORY_RESERVATION,undefined,'the build reservation leaked into gate entry');
for(const entry of readLedger(process.env.NTS_MEMORY_LEDGER).admitted){
  assert.equal(admittedEntry(process.env.NTS_MEMORY_LEDGER,entry.id),null,'a live build owner survives gate entry');
}
console.log('GATE after build owner exited');
JS
`);
  git("init","-q");git("add",".");git("commit","-qm","candidate");const candidate=git("rev-parse","HEAD");
  const planned = gateEnvironment(env, {run:join(directory,"run"),owned:{...owned,NTS_GATE_TREE:tree,NTS_GATE_TARGET:target,PATH:bin+":"+env.PATH}});
  const child=spawn("sh",[join(root,"tooling/gate/pinned.sh"),candidate,"compile-time"],{cwd:root,env:planned.env,stdio:["pipe","pipe","pipe"]});
  let stdout="",stderr="",closed=false;child.stdout.on("data",part=>stdout+=part);child.stderr.on("data",part=>stderr+=part);
  const done=new Promise<{status:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{
    child.once("error",reject);child.once("close",(status,signal)=>{closed=true;resolve({status,signal});});
  });
  try{
    await waitFor("pinned Cargo admitted barrier",()=>/^BUILD (.*)$/m.test(stdout),{stopped:()=>closed?stdout+stderr:undefined});
    const row=JSON.parse(/^BUILD (.*)$/m.exec(stdout)![1]!) as {id:string;owner:number;cargo:number};
    assert.equal(admittedEntry(owned.NTS_MEMORY_LEDGER,row.id)?.owner.pid,row.owner);
    assert.doesNotMatch(stdout,/GATE after build owner exited/);assert.equal(readLedger(owned.NTS_MEMORY_LEDGER).admitted.length,1);
    child.stdin.end("x");assert.deepEqual(await done,{status,signal:null},stdout+stderr);
    assert.equal(stdout.includes("GATE after build owner exited"),status===0);
    assert.equal(admittedEntry(owned.NTS_MEMORY_LEDGER,row.id),null,'the preparation owner is gone before the route returns');
    if(status===0)assert.match(stdout,/GATE after build owner exited/);
  }finally{child.stdin.end();if(!closed)await done;}
});
