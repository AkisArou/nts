import { launcherPolicyNames } from "../gate/canonical-environment.ts";
import { spawnTest } from "../gate/test-wait.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { GATE_ENVIRONMENT } from "../gate/environment.ts";

function fixture(t: { after(fn: () => void): void }) {
  const directory = mkdtempSync(join(tmpdir(), "land-unit-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "main"), tree = join(directory, "compiler"), home = join(directory, "home");
  const bin = join(directory, "bin"), capture = join(directory, "unit.json");
  mkdirSync(join(root, "tooling/lanes"), { recursive: true });
  writeFileSync(join(root,".gitignore"),".inputs-ready\nthird_party/\n");
  mkdirSync(bin);
  writeFileSync(join(bin, "systemd-run"), `#!${process.execPath}\nrequire("node:fs").writeFileSync(process.env.UNIT_CAPTURE, JSON.stringify(process.argv.slice(2)));\n`);
  chmodSync(join(bin, "systemd-run"), 0o755);
  writeFileSync(join(root, "tooling/lanes/land.ts"), `if (!process.argv.includes("--dry-run")) process.exit(99);
if (!require("node:fs").existsSync(".inputs-ready")) process.exit(98);
if (process.env.FAIL_PREFLIGHT === "1") process.exit(1);
if (process.env.INSTRUMENT_PREFLIGHT === "1") { console.error("instrument failure: audit: no test262 checkout"); process.exit(2); }
console.log("preflight passed");\n`);
  writeFileSync(join(root, "tooling/lanes/inputs.sh"), '#!/bin/sh\nset -eu\ntest "$1" = lane\nif [ "${NEED_SHARED_CORPUS:-}" = 1 ]; then test -f "$2/third_party/test262/SENTINEL"; fi\ntouch "$3/.inputs-ready"\n');
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_") && !key.startsWith("NTS_") && !launcherPolicyNames({[key]:process.env[key]}).length));
  Object.assign(env, {
    HOME: home, PATH: `${bin}:${process.env.PATH}`, UNIT_CAPTURE: capture,
    JAVA_HOME: "/jdk with spaces/$literal", ANDROID_HOME: "/sdk with spaces",
    DEBUGINFOD_URLS: "https://symbols.example/a https://symbols.example/b",
    UNRELATED_SECRET: "never forward this",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
  });
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "."); git(root, "commit", "-qm", "main");
  git(root, "worktree", "add", "-qb", "compiler/test", tree, "main");
  writeFileSync(join(tree, "feature"), "caller HEAD\n");
  git(tree, "add", "feature"); git(tree, "commit", "-qm", "feature");
  const sha = git(tree, "rev-parse", "HEAD");
  const launch = () => spawnTest(process.execPath, [new URL("./land-unit.ts", import.meta.url).pathname, "HEAD", "flags"], {
    cwd: tree, env, encoding: "utf8",
  });
  return { root, tree, home, capture, env, git, sha, launch };
}

test("the detached launcher seals the caller's HEAD and forwards the descriptor literally", t => {
  const f = fixture(t);
  assert.notEqual(f.sha, f.git(f.root, "rev-parse", "HEAD"));
  const result = f.launch();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const args: string[] = JSON.parse(readFileSync(f.capture, "utf8"));
  assert.equal(args.at(-1), f.sha);
  assert.ok(args.includes("--property=LimitCORE=0"));
  assert.ok(args.includes("--setenv=NTS_LAND_AUTHOR_BRANCH=compiler/test"));
  const directory = args.find(arg => arg.startsWith("--working-directory="))!.slice("--working-directory=".length);
  assert.equal(f.git(directory, "rev-parse", "HEAD"), f.sha);
  for (const { name } of GATE_ENVIRONMENT) {
    if (f.env[name]) assert.ok(args.includes(`--setenv=${name}=${f.env[name]}`), name);
  }
  assert.equal(args.some(arg => arg.includes("UNRELATED_SECRET") || arg.includes("never forward this")), false);
  assert.match(result.stdout, new RegExp(`queued ${f.sha} as nts-land-flags-`));
  assert.match(result.stdout, /log: .*land\.log/);
  const hook=args.find(arg=>arg.startsWith("--property=ExecStopPost="));
  assert.ok(hook,JSON.stringify(args));
  assert.match(hook,/taskset.*cleanup\.ts.*--post-stop.*nts-land-flags-/);
  assert.ok(args.some(arg=>arg.startsWith("--property=StandardOutput=append:")));
  assert.ok(args.some(arg=>arg.startsWith("--property=StandardError=append:")));
  const manifest=JSON.parse(readFileSync(join(directory,"..","submission.json"),"utf8"));
  assert.equal(manifest.sha,f.sha);
  assert.equal(manifest.preparingPid,null);
  assert.ok(existsSync(join(directory,"..","cleanup.ts")),"the stop hook survives deletion of the worktree");
});

test("a landing refuses experimental core dumps before creating a unit", t => {
  const f = fixture(t);
  f.env.NTS_COREDUMPS = "1";
  const result = f.launch();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr,/launcher verdict-policy.*NTS_COREDUMPS/);
  assert.equal(existsSync(f.capture),false);
});

test("a failed detached preflight never starts a unit and removes its own submission tree", t => {
  const f = fixture(t);
  f.env.FAIL_PREFLIGHT = "1";
  const result = f.launch();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /landing preflight failed; nothing queued/);
  assert.equal(existsSync(f.capture), false);
  assert.equal(f.git(f.root, "worktree", "list", "--porcelain").split("\n").filter(line => line.startsWith("worktree ")).length, 2);
  assert.match(f.git(f.root,"for-each-ref","--format=%(objectname)","refs/archive/land-submissions"),new RegExp(f.sha));
});

test("a fresh detached docs launcher gets third-party inputs from the shared checkout",t=>{
  const f=fixture(t),corpus=join(f.root,"third_party/test262");mkdirSync(corpus,{recursive:true});writeFileSync(join(corpus,"SENTINEL"),"shared input\n");
  f.git(f.tree,"switch","--detach","HEAD");f.env.NEED_SHARED_CORPUS="1";
  assert.equal(existsSync(join(f.tree,"third_party/test262")),false);
  const result=f.launch();assert.equal(result.status,0,result.stdout+result.stderr);assert.ok(existsSync(f.capture));
});
test("an instrument preflight is named without calling it a change refusal",t=>{
  const f=fixture(t);f.env.INSTRUMENT_PREFLIGHT="1";const result=f.launch();
  assert.equal(result.status,1);assert.match(result.stderr,/instrument failure: audit: no test262 checkout/);assert.match(result.stderr,/landing preflight instrument failure/);assert.doesNotMatch(result.stderr,/gate would refuse/);assert.equal(existsSync(f.capture),false);
});
