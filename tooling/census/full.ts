// The full run: the gate steps a landing leaves out, on a pin of main.
//
//   node tooling/census/full.ts            # main's tip
//   node tooling/census/full.ts <commit>   # any commit on main
//
// A landing runs the core (`WIDE` in tooling/gate/owed.mjs says which steps it
// leaves out and why). This runs the rest -- integrity, the profile, addons,
// interop, counting, memory, the device and the others -- with `pinned.sh`, at
// one commit, in a tree and target of their own (`~/.cache/nts-full`), never
// the landing gate's. Started by hand: before calling a milestone, when a
// family is finished, or every few days while the machine is idle.
//
// A step that is red here is red on main. Bisect it over the landings since
// the last green full run (`git log` from the commit its summary names), and
// fix it before new work. Each run's logs and summary stay under
// `~/.cache/nts-full/runs/<commit>-<time>`.
//
// It waits for memory before it starts and never starts beside a gate: the
// wide steps are the heaviest there are, and a landing's memory checks are
// what a neighbour breaks.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { WIDE } from "../gate/owed.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HOME = join(homedir(), ".cache/nts-full");
const git = (args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

const asked = process.argv[2] ?? "main";
const resolved = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${asked}^{commit}`], { cwd: ROOT, encoding: "utf8" });
if (resolved.status !== 0) {
  console.log(`  NOT RUN: \`${asked}\` names no commit`);
  process.exit(2);
}
const commit = resolved.stdout.trim();
if (spawnSync("git", ["merge-base", "--is-ancestor", commit, "main"], { cwd: ROOT }).status !== 0) {
  console.log(`  NOT RUN: ${asked} is not on main -- the full run measures main, and a branch is a landing's to gate`);
  process.exit(2);
}

// The landing gate holds this lock while it runs; a full run beside it would
// starve both, and red the gate's memory checks.
const landLock = join(homedir(), ".cache/nts-land.lock");
if (existsSync(landLock) && spawnSync("flock", ["-n", landLock, "true"]).status !== 0) {
  console.log("  NOT RUN: a landing is gating -- start the full run when the queue is quiet (`lane status`)");
  process.exit(2);
}
const available = () => Number(/MemAvailable:\s+(\d+)/.exec(readFileSync("/proc/meminfo", "utf8"))?.[1] ?? 0) / 1048576;
if (available() < 16) {
  console.log(`  NOT RUN: ${available().toFixed(1)} GB available, under the 16 the wide steps start at`);
  process.exit(2);
}

const steps = [...WIDE];
const short = commit.slice(0, 12);
const run = join(HOME, "runs", `${short}-${Date.now()}`);
mkdirSync(run, { recursive: true });
console.log(`  full run of ${short} (${git(["log", "-1", "--format=%s", commit])})`);
console.log(`  steps: ${steps.join(" ")}`);
console.log(`  logs: ${run}`);

const gated = spawnSync("sh", [join(ROOT, "tooling/gate/pinned.sh"), commit], {
  cwd: ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    NTS_GATE_STEPS: steps.join(" "),
    NTS_GATE_TREE: join(HOME, "tree"),
    NTS_GATE_TARGET: join(HOME, "target"),
    NTS_GATE_RUN_DIR: run,
    NTS_TSGO: process.env.NTS_TSGO ?? join(ROOT, "target/tsgo"),
  },
});

const summary = join(run, "summary.json");
if (!existsSync(summary)) {
  console.log(`  the run wrote no summary (exit ${gated.status}); see ${run}`);
  process.exit(1);
}
const verdicts = (JSON.parse(readFileSync(summary, "utf8")).steps ?? []) as { name: string; verdict: string }[];
const red = verdicts.filter((s) => s.verdict !== "PASS" && s.verdict !== "SKIPPED");
console.log(red.length === 0 ? `  full run of ${short}: green` : `  full run of ${short}: RED -- ${red.map((s) => `${s.name} ${s.verdict}`).join(", ")}; bisect over the landings since the last green full run`);
process.exit(red.length === 0 ? 0 : 1);
