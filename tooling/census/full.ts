// The full run: the gate steps a landing leaves out, on a pin of main.
//
//   node tooling/census/full.ts            # main's tip
//   node tooling/census/full.ts <commit>   # any commit on main
//   node tooling/census/full.ts <commit> --candidate  # explicit pre-landing wide validation
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
// `~/.cache/nts-full/runs/<commit>-<time>`. Explicit candidates use a separate
// candidates/{tree,target,runs/CANDIDATE-<sha>-<time>} namespace and never
// update the main history or re-record policy tables.
//
// It waits for memory before it starts and never starts beside a gate: the
// wide steps are the heaviest there are, and a landing's memory checks are
// what a neighbour breaks.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fullPlan, fullEnvironment } from "./full-plan.ts";

import { WIDE } from "../gate/owed.mjs";
import { gateEnvironmentError } from "../gate/environment.ts";
import { branchHealth, healthLines } from "../lanes/health.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HOME = join(homedir(), ".cache/nts-full");
const git = (args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const steps = [...WIDE];
// No queue, lock, history walk or worktree setup before required tools can run.
try {
  const problem = gateEnvironmentError(ROOT, steps);
  if (problem) { console.log(`  NOT RUN: ${problem}`); process.exit(2); }
} catch (error) {
  console.log(`  NOT RUN: environment preflight: ${(error as Error).message}`);
  process.exit(2);
}
console.log(healthLines(await branchHealth(ROOT)).join("\n"));

let plan: ReturnType<typeof fullPlan>;
try { plan = fullPlan(ROOT, HOME, process.argv.slice(2)); }
catch (error) { console.log(`  NOT RUN: ${String(error)}`); process.exit(2); }
const { candidate, commit, label, run } = plan;

// The landing lock, held for the whole run: a full run beside a gate would
// starve both and red the gate's memory checks, and only holding the lock
// keeps a landing from starting once the run has (a landing waits, queued).
const landLock = join(homedir(), ".cache/nts-land.lock");
const BUSY = 75;
const available = () => Number(/MemAvailable:\s+(\d+)/.exec(readFileSync("/proc/meminfo", "utf8"))?.[1] ?? 0) / 1048576;
if (available() < 16) {
  console.log(`  NOT RUN: ${available().toFixed(1)} GB available, under the 16 the wide steps start at`);
  process.exit(2);
}

const short = commit.slice(0, 12);
mkdirSync(run, { recursive: true });
writeFileSync(join(run, "full-run.json"), JSON.stringify({ mode: label, commit }, null, 2) + "\n");
console.log(`  ${label} full run of ${short} (${git(["log", "-1", "--format=%s", commit])})`);
console.log(`  steps: ${steps.join(" ")}`);
console.log(`  logs: ${run}`);

const gated = spawnSync("flock", ["-n", "-E", String(BUSY), landLock, "sh", join(ROOT, "tooling/gate/pinned.sh"), commit], {
  cwd: ROOT,
  stdio: "inherit",
  env: {
    // Keep the default tree literal discoverable by lane cleanup. The plan
    // overrides it for candidates; neither candidate tree nor target is shared
    // with the main full-run history.
    ...process.env,
    NTS_GATE_TREE: join(HOME, "tree"),
    NTS_GATE_TARGET: join(HOME, "target"),
    ...fullEnvironment(plan, steps, process.env),
  },
});

if (gated.status === BUSY) {
  rmSync(run, { recursive: true, force: true });
  console.log("  NOT RUN: a landing is gating -- start the full run when the queue is quiet (`lane status`)");
  process.exit(2);
}
const summary = join(run, "summary.json");
if (!existsSync(summary)) {
  console.log(`  the run wrote no summary (exit ${gated.status}); see ${run}`);
  process.exit(1);
}
const report = JSON.parse(readFileSync(summary, "utf8"));
report.full_run = { mode: label, commit };
writeFileSync(summary, JSON.stringify(report, null, 2) + "\n");
const verdicts = (report.steps ?? []) as { name: string; verdict: string }[];
const red = verdicts.filter((s) => s.verdict !== "PASS" && s.verdict !== "SKIPPED");
const green = report.verdict === "green" && gated.status === 0;
console.log(green ? `  ${label} full run of ${short}: green` : `  ${label} full run of ${short}: RED -- ${red.map((s) => `${s.name} ${s.verdict}`).join(", ")}; ${candidate ? "fix the candidate before landing" : "bisect over the landings since the last green full run"}`);
process.exit(green ? 0 : 1);
