import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
  mkdirSync(bin);
  writeFileSync(join(bin, "systemd-run"), `#!${process.execPath}\nrequire("node:fs").writeFileSync(process.env.UNIT_CAPTURE, JSON.stringify(process.argv.slice(2)));\n`);
  chmodSync(join(bin, "systemd-run"), 0o755);
  writeFileSync(join(root, "tooling/lanes/land.ts"), `if (!process.argv.includes("--dry-run")) process.exit(99);
if (process.env.FAIL_PREFLIGHT === "1") process.exit(2);
console.log("preflight passed");\n`);
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_") && !key.startsWith("NTS_")));
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
  const launch = () => spawnSync(process.execPath, [new URL("./land-unit.ts", import.meta.url).pathname, "HEAD", "flags"], {
    cwd: tree, env, encoding: "utf8", timeout: 30_000,
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
  const directory = args.find(arg => arg.startsWith("--working-directory="))!.slice("--working-directory=".length);
  assert.equal(f.git(directory, "rev-parse", "HEAD"), f.sha);
  for (const { name } of GATE_ENVIRONMENT) {
    if (f.env[name]) assert.ok(args.includes(`--setenv=${name}=${f.env[name]}`), name);
  }
  assert.equal(args.some(arg => arg.includes("UNRELATED_SECRET") || arg.includes("never forward this")), false);
  assert.match(result.stdout, new RegExp(`queued ${f.sha} as nts-land-flags-`));
  assert.match(result.stdout, /log: .*land\.log/);
});

test("core dumps require an explicit debugging opt-in", t => {
  const f = fixture(t);
  f.env.NTS_COREDUMPS = "1";
  const result = f.launch();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const args: string[] = JSON.parse(readFileSync(f.capture, "utf8"));
  assert.ok(args.includes("--property=LimitCORE=infinity"));
  assert.ok(args.includes("--setenv=NTS_COREDUMPS=1"));
});

test("a failed detached preflight never starts a unit and removes its own submission tree", t => {
  const f = fixture(t);
  f.env.FAIL_PREFLIGHT = "1";
  const result = f.launch();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /landing preflight failed; nothing queued/);
  assert.equal(existsSync(f.capture), false);
  assert.equal(f.git(f.root, "worktree", "list", "--porcelain").split("\n").filter(line => line.startsWith("worktree ")).length, 2);
});
