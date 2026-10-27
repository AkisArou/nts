import { launcherPolicyNames, ENVIRONMENT_CONTEXT } from "../gate/canonical-environment.ts";
import { STANDING_GATE_POLICY } from "../gate/verdict-policy.ts";
import { spawnTest } from "../gate/test-wait.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fullPlan, fullEnvironment } from "./full-plan.ts";

const scratch = join(homedir(), ".cache/nts-scratch/full-run-tests");
mkdirSync(scratch, { recursive: true });

test("missing full-run environment refuses before history, lock or setup", t => {
  const home = mkdtempSync(join(scratch, "missing-env-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const result = spawnTest(process.execPath, [new URL("./full.ts", import.meta.url).pathname, "main"], {
    env: { ...process.env, HOME: home, ANDROID_HOME: "", JAVA_HOME: "", DEBUGINFOD_URLS: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  for (const name of ["ANDROID_HOME", "JAVA_HOME", "DEBUGINFOD_URLS"]) assert.match(result.stdout, new RegExp(`${name} is missing`));
  assert.match(result.stdout, /node tooling\/lanes\/land-unit.ts/);
  assert.doesNotMatch(result.stdout, /unlanded branches older/);
  assert.equal(existsSync(join(home, ".cache/nts-land.lock")), false);
  assert.equal(existsSync(join(home, ".cache/nts-full")), false);
});

function fixture(t: { after(fn: () => void): void }) {
  const directory = mkdtempSync(join(scratch, "run-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "repo"), home = join(directory, "full");
  mkdirSync(join(root, "tooling/gate"), { recursive: true });
  mkdirSync(join(root, "tooling/lanes"), { recursive: true });
  mkdirSync(join(root, "results"), { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_") && !key.startsWith("NTS_") && !launcherPolicyNames({[key]:process.env[key]}).length));
  Object.assign(env, {
    GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  writeFileSync(join(root, "results/marker"), "main record\n");
  writeFileSync(join(root, "tooling/gate/pinned.sh"), readFileSync(new URL("../gate/pinned.sh", import.meta.url)));
  writeFileSync(join(root,"tooling/gate/canonical-environment.ts"),readFileSync(new URL("../gate/canonical-environment.ts",import.meta.url)));
    writeFileSync(join(root,"tooling/gate/run-temporary.ts"),readFileSync(new URL("../gate/run-temporary.ts",import.meta.url)));
  // These controls exercise the real sealed worktree setup, without a build
  // or dependence on delegated cpusets (affinity has its own kernel tests).
  writeFileSync(join(root, "tooling/gate/affinity.ts"), "");
  writeFileSync(join(root, "tooling/lanes/inputs.sh"), 'mkdir -p "$NTS_GATE_TREE/results"\nprintf CANDIDATE > "$NTS_GATE_TREE/results/setup-marker"\n');
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
  const f=fixture(t),source=new URL("../gate/",import.meta.url).pathname,gate=join(f.root,"tooling/gate");
  // Exercise the real verdict runner in its own repository, with two stand-in
  // steps that both return 77. Only the source-owned device skip may be green.
  for(const name of readdirSync(source)) {
    if(name==="run.mjs") writeFileSync(join(gate,name),readFileSync(join(source,name)));
    else if(!existsSync(join(gate,name)) && name!=="all.sh") symlinkSync(join(source,name),join(gate,name));
  }
  const listed=spawnTest("sh",[join(source,"all.sh"),"--list"],{encoding:"utf8"});
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
    const actual=spawnTest(process.execPath,[join(gate,"run.mjs")],{cwd:f.root,env,encoding:"utf8"});
    const accepted=step==="on-device";
    assert.equal(actual.status,accepted?0:1,actual.stdout+actual.stderr);
    const summary=JSON.parse(readFileSync(join(plan.run,"summary.json"),"utf8"));
    assert.equal(summary.environment.canonical,true);
    assert.equal(summary.verdict,accepted?"green":"red");
    assert.equal(summary.steps[0].verdict,"SKIPPED");
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
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: plan.tree, encoding: "utf8" }).trim(), f.candidate);
  assert.equal(readFileSync(join(plan.tree, "results/setup-marker"), "utf8"), "CANDIDATE");
  assert.equal(readFileSync(join(f.root, "results/marker"), "utf8"), "main record\n");
  assert.equal(readFileSync(join(f.home, "runs/latest"), "utf8"), "main's last full run\n");
  assert.equal(existsSync(join(f.home, "tree")), false);
  assert.equal(f.git("status", "--porcelain"), "");
});
