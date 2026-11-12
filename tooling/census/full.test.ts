import {fixtureEnvironment} from "../gate/test-environment.ts";
import {gateEnvironment, launcherPolicyNames, ENVIRONMENT_CONTEXT} from "../gate/canonical-environment.ts";
import {STANDING_GATE_POLICY} from "../gate/verdict-policy.ts";
import {spawnTest} from "../gate/test-wait.ts";
import {copyModuleClosure, moduleClosure} from "../gate/module-closure-fixture.ts";
import {removeOracleSnapshot} from "../differential/oracle-emit.ts";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync} from "node:fs";
import {join, dirname} from "node:path";

import {test} from "node:test";
import {fullPlan, fullEnvironment} from "./full-plan.ts";
import {testScratch, newTestScratch} from "../gate/test-scratch.ts";
import {ownMemory} from "../gate/test-memory.ts";


test("missing full-run environment refuses before setup", t => {
  const home = testScratch(t, "full-run-missing-env");
  const result = spawnTest(process.execPath, [new URL("./full.ts", import.meta.url).pathname, "main"], {
    env: { ...fixtureEnvironment(t), HOME: home, ANDROID_HOME: "", JAVA_HOME: "", DEBUGINFOD_URLS: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  for (const name of ["ANDROID_HOME", "JAVA_HOME", "DEBUGINFOD_URLS"]) assert.match(result.stdout, new RegExp(`${name} is missing`));
  assert.match(result.stdout, /node tooling\/landing\/check.ts/);
  assert.equal(existsSync(join(home, ".cache/nts-full")), false);
});

function fixture(t: { after(fn: () => void): void }) {
  const directory = newTestScratch("full-run");
  t.after(() => removeOracleSnapshot(directory));
  const root = join(directory, "repo"), home = join(directory, "full");
  mkdirSync(join(root, "tooling/gate"), { recursive: true });
  mkdirSync(join(root, "tooling/inputs"), { recursive: true });
  mkdirSync(join(root, "results"), { recursive: true });
  const env = Object.fromEntries(Object.entries(fixtureEnvironment(t)).filter(([key]) => !key.startsWith("GIT_") && !key.startsWith("NTS_") && !launcherPolicyNames({[key]:process.env[key]}).length));
  Object.assign(env, {
    GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  writeFileSync(join(root, "results/marker"), "main record\n");
  writeFileSync(join(root, "tooling/gate/pinned.sh"), readFileSync(new URL("../gate/pinned.sh", import.meta.url)));
  copyModuleClosure(["tooling/gate/canonical-environment.ts", "tooling/differential/oracle-toolchain.json", "tooling/inputs/linker.ts"], root);
  // These controls exercise the real sealed worktree setup, without a build
  // or dependence on delegated cpusets (affinity has its own kernel tests).
  writeFileSync(join(root, "tooling/gate/affinity.ts"), "");
  writeFileSync(join(root, "tooling/inputs/link.sh"), 'mkdir -p "$NTS_GATE_TREE/results"\nprintf CANDIDATE > "$NTS_GATE_TREE/results/setup-marker"\n');
  git("init", "-q", "-b", "main"); git("add", "."); git("commit", "-qm", "main");
  git("checkout", "-qb", "candidate");
  writeFileSync(join(root, "candidate"), "candidate input\n");
  git("add", "."); git("commit", "-qm", "candidate");
  const candidate = git("rev-parse", "HEAD");
  git("checkout", "-q", "main");
  return { directory, root, home, env, git, candidate };
}

test("the default full run refuses a non-main pin and writes nothing", t => {
  const f = fixture(t);
  assert.throws(() => fullPlan(f.root, f.home, [f.candidate]), /not on main/);
  assert.throws(() => fullPlan(f.root, f.home, ["--candidate"]), /explicit commit/);
  assert.throws(() => fullPlan(f.root, f.home, ["does-not-exist", "--candidate"]), /names no commit/);
  assert.throws(() => fullPlan(f.root, f.home, ["main:results/marker", "--candidate"]), /names no commit/);
  const main = fullPlan(f.root, f.home, [], 123);
  assert.equal(main.label, "MAIN");
  assert.equal(main.tree, join(f.home, "tree"));
  assert.equal(main.commit, f.git("rev-parse", "main"));
  assert.equal(existsSync(f.home), false);
  assert.equal(f.git("status", "--porcelain"), "");
});

test("a plain full run canonically accepts exactly the landing's standing skips",t=>{
  const f=fixture(t),source=dirname(new URL("../gate/run.mjs",import.meta.url).pathname),gate=join(f.root,"tooling/gate");
  // Exercise the real verdict runner in its own repository, with two stand-in
  // steps that both return 77. Only the source-owned device skip may be green.
  for(const file of moduleClosure(["tooling/gate/run.mjs"])){
    const target=join(f.root,file),original=join(source,"../..",file);
    mkdirSync(dirname(target),{recursive:true});
    if(file==="tooling/gate/run.mjs")writeFileSync(target,readFileSync(original));
    else if(!existsSync(target))symlinkSync(original,target);
  }
  symlinkSync(new URL("../gate/times.tsv",import.meta.url),join(gate,"times.tsv"));
  const listed=spawnTest("sh",[new URL("../gate/all.sh",import.meta.url).pathname,"--list"],{encoding:"utf8"});
  assert.equal(listed.status,0,listed.stderr);
  writeFileSync(join(gate,"all.sh"),`#!/bin/sh\nif [ "$1" = --list ]; then\ncat <<'NAMES'\n${listed.stdout.trim()}\nNAMES\nelse\n  echo 'SKIP: fixture unavailable'\n  exit 77\nfi\n`);
  const home=join(f.directory,"home");
  mkdirSync(join(f.root,"target/release"),{recursive:true});
  writeFileSync(join(f.root,"target/release/nts"),"fixture compiler identity; steps return 77 without invoking it\n");
  for(const [index,step] of ["on-device","rustfmt"].entries()) {
    const plan=fullPlan(f.root,join(home,".cache/nts-full"),[],789+index),env=fullEnvironment(plan,[step],{...f.env,HOME:home});
    assert.equal(env.NTS_GATE_ACCEPT_SKIP,STANDING_GATE_POLICY.NTS_GATE_ACCEPT_SKIP);
    assert.equal(env.NTS_GATE_ACCEPT_SKIP,"on-device");
    assert.equal(JSON.parse(env[ENVIRONMENT_CONTEXT]!).report.canonical,true);
    // The inner run decides by a reading and a ledger of its own, never the
    // host's memory, which a full gate can hold low, or the machine's queue.
    const admitted=gateEnvironment(env,{run:plan.run,owned:ownMemory(join(f.directory,"memory"))}).env;
    const actual=spawnTest(process.execPath,[join(gate,"run.mjs")],{cwd:f.root,env:admitted,encoding:"utf8"});
    const accepted=step==="on-device";
    assert.equal(actual.status,accepted?0:1,actual.stdout+actual.stderr);
    const summary=JSON.parse(readFileSync(join(plan.run,"summary.json"),"utf8"));
    assert.equal(summary.environment.canonical,true);
    assert.equal(summary.verdict,accepted?"green":"red");
    assert.equal(summary.steps[0].verdict,"SKIPPED",JSON.stringify(summary.steps[0]));
    assert.equal(summary.steps[0].accepted===true,accepted);
  }
});

test("candidate setup consumes a sealed sha and cannot write main's records or full-run history", t => {
  const f = fixture(t);
  mkdirSync(join(f.home, "runs"), { recursive: true });
  writeFileSync(join(f.home, "runs/latest"), "main's last full run\n");
  const plan = fullPlan(f.root, f.home, ["candidate", "--candidate"], 456);
  assert.equal(plan.commit, f.candidate);
  assert.equal(plan.label, "CANDIDATE");
  assert.match(plan.run, new RegExp(`/candidates/runs/CANDIDATE-${f.candidate.slice(0, 12)}-456$`));
  assert.equal(plan.tree, join(f.home, "candidates/tree"));
  assert.equal(plan.target, join(f.home, "candidates/target"));
  // Moving the caller's ref cannot change the sealed candidate.
  f.git("branch", "-f", "candidate", "main");
  const env = fullEnvironment(plan, ["corpus"], { ...f.env, NTS_GATE_RECORD_TIMES: "1", NTS_GATE_TREE: f.root, NTS_GATE_SETUP_ONLY: "1" });
  assert.equal(env.NTS_GATE_RECORD_TIMES, "0");
  assert.equal(env.NTS_GATE_RUN_DIR, plan.run);
  const result = spawnTest("sh", [join(f.root, "tooling/gate/pinned.sh"), plan.commit], { cwd: f.root, env, encoding: "utf8",});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], {env:fixtureEnvironment(t), cwd: plan.tree, encoding: "utf8" }).trim(), f.candidate);
  assert.equal(readFileSync(join(plan.tree, "results/setup-marker"), "utf8"), "CANDIDATE");
  assert.equal(readFileSync(join(f.root, "results/marker"), "utf8"), "main record\n");
  assert.equal(readFileSync(join(f.home, "runs/latest"), "utf8"), "main's last full run\n");
  assert.equal(existsSync(join(f.home, "tree")), false);
  assert.equal(f.git("status", "--porcelain"), "");
});
