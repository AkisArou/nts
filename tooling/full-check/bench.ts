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
// behind another measurement; or it ran. nts-bench keeps every run itself: it
// writes one immutable record under results/benchmarks/runs/, renders full.md
// and commits the two as a results-only commit on the tree's HEAD,
// `verified`. The service submits that commit the way it submits records.
import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Git } from "./git.ts";

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

/**
 * The production benchmark: the session's memory, reserved in the ledger at
 * the full check's priority by what earlier sessions in `target` held; then
 * with-lock.sh, which admits the run on the reserved core; then nts-bench
 * --root <tree>. admit.ts becomes with-lock.sh, so the exit is the lock's or
 * nts-bench's.
 */
export function benchWithLock(controller: string, target: string): Bench {
  const withLock = join(controller, "tooling/gate/with-lock.sh");
  const bench = join(target, "release/nts-bench");
  return (tree, run) => {
    const log = join(run, "bench.log");
    const out = openSync(log, "a");
    let status: number;
    try {
      status = spawnSync(process.execPath, [ADMIT, "--key", "bench-session", "--what", `nightly benchmarks in ${tree}`, "--", "sh", withLock, bench, "--root", tree],
        { cwd: tree, stdio: ["ignore", out, out], env: { ...process.env, NTS_MEMORY_PRIORITY: "full-check", NTS_GATE_COSTS_DIR: join(target, "gate-costs") } }).status ?? 1;
    } finally { closeSync(out); }
    return status === NOT_ADMITTED_EXIT ? { admitted: false, reason: admission(readFileSync(log, "utf8")) } : { admitted: true, status };
  };
}

/** Why a run was not admitted, from its log: the last line with-lock.sh or nts-bench gave for it. */
export function admission(log: string): string {
  return log.split("\n").filter(line => /^(with-lock|not admitted): /.test(line)).at(-1) ?? `exit ${NOT_ADMITTED_EXIT}, and the log says no more`;
}

/**
 * The results-only commit nts-bench made on `verified` in the tree, or why
 * there is none to submit. Anything but a run record and full.md is refused.
 */
export function resultsCommit(tree: Git, verified: string): { commit: string } | { none: string } {
  const head = tree.run(["rev-parse", "HEAD"]);
  if (head === verified) return { none: "nts-bench committed no run record" };
  if (tree.commit(`${head}^`) !== verified || !tree.subject(head).startsWith(RESULTS_SUBJECT)) {
    return { none: `the tree's HEAD ${head.slice(0, 12)} is not a results commit on ${verified.slice(0, 12)}` };
  }
  const paths = tree.run(["diff", "--name-only", verified, head]).split("\n").filter(Boolean);
  const stray = paths.filter(path => path !== FULL_MD && !/^results\/benchmarks\/runs\/[^/]+\.json$/.test(path));
  return stray.length ? { none: `the results commit also changes ${stray.join(", ")}` } : { commit: head };
}

/** The rows full.md marks slower than their own best, by case. */
export function slowerRows(fullMd: string): string[] {
  return fullMd.split("\n").filter(line => line.startsWith("|") && line.includes("**SLOWER THAN BEST**"))
    .map(line => line.split("|")[1]!.trim()).filter(Boolean);
}
