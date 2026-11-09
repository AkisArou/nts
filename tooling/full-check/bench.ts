// The nightly benchmarks (docs/workflow.md, Benchmarks): after the nightly
// wide steps, nts-bench measures `verified`, on CPU 4 with its sibling idle,
// through the measurement lock -- the entry point a person runs, asked
// without --wait:
//
//   tooling/gate/with-lock.sh target/release/nts-bench --root <tree>
//
// A measurement waits for the reserved core and nothing else (AGENTS.md, The
// machine): gates, landing checks and agents' work run on the other CPUs, and
// nts-bench records the machine's load and free memory beside every row.
// with-lock.sh admits the run once CPUs 4-5 are quiet, and nts-bench asks
// again before it starts. The session's memory is reserved first, once, at
// the full check's priority (admit.ts --key bench-session), so a wait in the
// memory ledger never holds the measurement lock, and every case's host
// columns run inside that reservation. A run either did not start -- the lock held by
// another measurement, or the pair busy -- which is exit 75 from either and
// leaves the benchmarks due for a later cycle, so the full check never waits
// behind another measurement; or it ran.
//
// The run is background work (background.ts): the benchmarks unit measures in
// the bench tree, a tree of its own at verified, on that tree's own code --
// admit.ts, and with-lock.sh, a shell script read as it runs -- which nothing
// changes while it measures, with the nts-bench the controller's build step
// made at verified copied into the run's folder. nts-bench keeps every run
// itself: it writes one immutable record under results/benchmarks/runs/,
// renders full.md and commits the two as a results-only commit on the tree's
// HEAD, verified. That commit does not land: main's renderer and results move
// on while a run measures, and a commit on verified is refused once they have.
// The unit keeps the run's record in its run's folder (measureJob), and the
// controller publishes it on the newest main with main's own renderer
// (run-record.ts publish, publishAt), submits that results-only commit, and
// follows it as it follows records.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nodePin } from "../bootstrap/node.ts";
import { nodeToolchain } from "../gate/toolchain.ts";
import { candidateCommand } from "../landing/candidate-environment.ts";
import { launcherEnvironment } from "../landing/run.ts";
import { writeOutcome } from "./background.ts";
import { Git } from "./git.ts";

const ADMIT = fileURLToPath(new URL("../gate/admit.ts", import.meta.url));

/**
 * with-lock.sh's exit for a run it does not start (EX_TEMPFAIL), and
 * nts-bench's when the reserved core is busy as it starts: nothing ran.
 */
export const NOT_ADMITTED_EXIT = 75;

/** One attempt at the benchmarks: not admitted, and why; or admitted, with the run's exit status. */
export type BenchAttempt = { admitted: false; reason: string } | { admitted: true; status: number };
/** Measure in `tree`, keeping the output in `run`. */
export type Bench = (tree: string, run: string) => BenchAttempt;

export const RESULTS_SUBJECT = "results: retain benchmark run ";
/** The page nts-bench renders from the newest complete run. */
export const FULL_MD = "results/benchmarks/full.md";
/** Where a tree keeps its run records. */
export const RUNS = "results/benchmarks/runs";

/**
 * The production benchmark, in a tree with that tree's own tools: the
 * session's memory, reserved in the ledger at the full check's priority by
 * what earlier sessions held, in the scheduling history `history`; then
 * with-lock.sh, which admits the run on the reserved core; then `binary`
 * (nts-bench) --root <tree>. admit.ts becomes with-lock.sh, so the exit is
 * the lock's or nts-bench's.
 */
export function benchWithLock(binary: string, history: string): Bench {
  return (tree, run) => {
    const log = join(run, "bench.log");
    const out = openSync(log, "a");
    let status: number;
    try {
      status = spawnSync(process.execPath, [ADMIT, "--key", "bench-session", "--what", `nightly benchmarks in ${tree}`, "--", "sh", join(tree, "tooling/gate/with-lock.sh"), binary, "--root", tree],
        { cwd: tree, stdio: ["ignore", out, out], env: { ...process.env, NTS_MEMORY_PRIORITY: "full-check", NTS_GATE_COSTS_DIR: history } }).status ?? 1;
    } finally { closeSync(out); }
    return status === NOT_ADMITTED_EXIT ? { admitted: false, reason: admission(readFileSync(log, "utf8")) } : { admitted: true, status };
  };
}

/** Why a run was not admitted, from its log: the last line with-lock.sh or nts-bench gave for it. */
export function admission(log: string): string {
  return log.split("\n").filter(line => /^(with-lock|not admitted): /.test(line)).at(-1) ?? `exit ${NOT_ADMITTED_EXIT}, and the log says no more`;
}

/**
 * The results-only commit on `base` at the tree's HEAD -- nts-bench's on
 * verified, or run-record.ts publish's on main -- or why there is none.
 * Anything but run records and full.md is refused.
 */
export function resultsCommit(tree: Git, base: string): { commit: string } | { none: string } {
  const head = tree.run(["rev-parse", "HEAD"]);
  if (head === base) return { none: "nts-bench committed no run record" };
  if (tree.commit(`${head}^`) !== base || !tree.subject(head).startsWith(RESULTS_SUBJECT)) {
    return { none: `the tree's HEAD ${head.slice(0, 12)} is not a results commit on ${base.slice(0, 12)}` };
  }
  const paths = tree.run(["diff", "--name-only", base, head]).split("\n").filter(Boolean);
  const stray = paths.filter(path => path !== FULL_MD && !(path.startsWith(`${RUNS}/`) && /^[^/]+\.json$/.test(path.slice(RUNS.length + 1))));
  return stray.length ? { none: `the results commit also changes ${stray.join(", ")}` } : { commit: head };
}

/** The rows full.md marks slower than their own best, by case. */
export function slowerRows(fullMd: string): string[] {
  return fullMd.split("\n").filter(line => line.startsWith("|") && line.includes("**SLOWER THAN BEST**"))
    .map(line => line.split("|")[1]!.trim()).filter(Boolean);
}

/** The benchmarks unit's work, as its command line gives it (service.ts's parseOptions, --benchmarks). */
export type MeasureJob = {
  /** The commit it measures: verified, where its tree is. */
  commit: string;
  /** Its run's folder: its logs, its nts-bench, the run's record and its outcome. */
  run: string;
  /** nts-bench, built at that commit. */
  bench: string;
  /** The scheduling history the session's memory is reserved by, and its peak added to. */
  history: string;
  outcome: string;
};

/** What the benchmarks unit's outcome says beside nts-bench's exit status: whether the lock admitted the run, and the record it kept, or why none. */
export type MeasureOutcome = { admitted: boolean; reason?: string; record?: string; none?: string };

/**
 * The benchmarks unit's work, in its own tree at the commit it measures: the
 * attempt (`bench`), and then, as its last act, its outcome. A run that kept
 * a record leaves a copy of it, the bytes nts-bench committed, in the run's
 * folder, which the controller publishes from once the tree is at main.
 */
export function measureJob(tree: string, job: MeasureJob, bench: Bench): void {
  const attempt = bench(tree, job.run);
  if (!attempt.admitted) { writeOutcome<MeasureOutcome>(job.outcome, { status: NOT_ADMITTED_EXIT, admitted: false, reason: attempt.reason }); return; }
  const git = new Git(tree), found = resultsCommit(git, job.commit);
  if ("none" in found) { writeOutcome<MeasureOutcome>(job.outcome, { status: attempt.status, admitted: true, none: found.none }); return; }
  const records = git.run(["diff", "--name-only", job.commit, found.commit, "--", RUNS]).split("\n").filter(Boolean);
  if (records.length !== 1) {
    writeOutcome<MeasureOutcome>(job.outcome, { status: attempt.status, admitted: true, none: `the results commit ${found.commit.slice(0, 12)} holds ${records.length} run records, not one` });
    return;
  }
  const record = join(job.run, basename(records[0]!));
  writeFileSync(record, git.output(["show", `${found.commit}:${records[0]}`]));
  writeOutcome<MeasureOutcome>(job.outcome, { status: attempt.status, admitted: true, record });
}

/** main's own run-record.ts publish of `record` in `tree`, which is at main; its output goes to `log`. */
export type Publisher = (tree: string, record: string, log: string) => { status: number; output: string };

/**
 * main's own tooling/bench/run-record.ts publish <tree> <record> commit, in
 * the gate's canonical environment with main's own Node, as main's own
 * record-pending.ts --apply runs (records.ts's applyRecords): it renders
 * full.md with main's renderer from main's runs and this one, and commits the
 * two on main. Its output goes to `log`, whose folder also holds its run's
 * temporary folder while it runs.
 */
export function publishRecord(tree: string, record: string, log: string, options: { nodeInstallations?: string; env?: NodeJS.ProcessEnv } = {}): { status: number; output: string } {
  const script = join(tree, "tooling/bench/run-record.ts");
  if (!existsSync(script)) return { status: 2, output: "no tooling/bench/run-record.ts at main" };
  const selected = nodeToolchain(nodePin(tree), launcherEnvironment(options.env ?? process.env), options.nodeInstallations);
  const out = openSync(log, "w");
  let r: ReturnType<typeof candidateCommand>;
  try {
    r = candidateCommand(selected.node, {
      tree, run: join(dirname(log), "publish"), owned: {}, command: [selected.node, script, "publish", tree, record, "commit"], discardTemporary: true,
    }, selected.env, { output: out });
  } finally { closeSync(out); }
  const output = readFileSync(log, "utf8");
  return { status: r.status ?? 1, output: r.error ? `${output}\n${r.error.message}\n` : output };
}

export type Published =
  | { kind: "committed"; commit: string }
  | { kind: "none" }
  | { kind: "failed"; why: string };

/**
 * A run's record published on `main`, the newest: `git`'s tree set up there
 * by `checkout`, `publish` run in it, and what it committed held to a
 * results-only commit on main. `none` when it committed nothing: main has the
 * record and its page already.
 */
export function publishAt(git: Git, main: string, checkout: (commit: string) => void, publish: (tree: string) => { status: number; output: string }): Published {
  checkout(main);
  const head = git.run(["rev-parse", "HEAD"]);
  if (head !== main) throw new Error(`the bench tree is at ${head.slice(0, 12)}, not main's ${main.slice(0, 12)}`);
  const { status } = publish(git.cwd);
  if (status !== 0) return { kind: "failed", why: `exited ${status}` };
  if (git.run(["rev-parse", "HEAD"]) === main) return { kind: "none" };
  const found = resultsCommit(git, main);
  return "none" in found ? { kind: "failed", why: found.none } : { kind: "committed", commit: found.commit };
}
