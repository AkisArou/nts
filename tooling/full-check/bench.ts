// The nightly benchmarks (docs/workflow.md, Benchmarks): after the nightly
// wide steps, nts-bench measures `verified`, on CPU 4 with its sibling idle,
// through the measurement lock -- the same entry point a person runs:
//
//   tooling/gate/with-lock.sh --wait target/release/nts-bench --root <tree>
//
// nts-bench refuses to start while any other `nts` runs, and a landing check
// may be running one, so the machine is waited for rather than fought, and
// the wait never holds the full check: the nightly slot makes the benchmarks
// due for a window, and each cycle with nothing else to do asks
// tooling/gate/wait-idle.sh, for a short while only and holding nothing
// anyone else needs, whether the machine is quiet. A busy machine gives way
// to the core and is asked again on a later cycle. Once it was quiet, the
// measurement waits for it again inside the lock, briefly, as wait-idle.sh
// says the order must be. nts-bench keeps every run itself: it writes one
// immutable record under results/benchmarks/runs/, renders full.md and
// commits the two as a results-only commit on the tree's HEAD, `verified`.
// The service submits that commit the way it submits records.
import { spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import type { Git } from "./git.ts";

/** Whether the machine was quiet, by wait-idle.sh, at some point within `seconds`. */
export type Quiet = (seconds: number) => boolean;
/** Measure in `tree`, keeping the output in `run`. */
export type Bench = (tree: string, run: string) => { status: number };

export const RESULTS_SUBJECT = "results: retain benchmark run ";
/** The page nts-bench renders from the newest complete run. */
export const FULL_MD = "results/benchmarks/full.md";

/** How long the nightly benchmarks stay due after their slot before the night is given up. */
export const DEFAULT_QUIET_WAIT_MINUTES = 240;
/** How long one cycle asks whether the machine is quiet before it gives way. */
export const QUIET_ASK_SECONDS = 120;

/** wait-idle.sh for at most `seconds`: 45 quiet seconds within them. */
export function quietWithin(controller: string): Quiet {
  const waitIdle = join(controller, "tooling/gate/wait-idle.sh");
  return seconds => spawnSync("timeout", [String(seconds), "sh", waitIdle, "45"], { stdio: "ignore" }).status === 0;
}

/** The production benchmark: with-lock.sh --wait, wait-idle.sh inside the lock, then nts-bench --root <tree>. */
export function benchWithLock(controller: string, target: string): Bench {
  const waitIdle = join(controller, "tooling/gate/wait-idle.sh");
  const withLock = join(controller, "tooling/gate/with-lock.sh");
  const bench = join(target, "release/nts-bench");
  return (tree, run) => {
    const out = openSync(join(run, "bench.log"), "a");
    try {
      const io = { cwd: tree, stdio: ["ignore", out, out] as ["ignore", number, number] };
      const measured = spawnSync("sh", [withLock, "--wait", "sh", "-c", 'timeout 600 sh "$0" 45 && exec "$1" --root "$2"', waitIdle, bench, tree], io);
      return { status: measured.status ?? 1 };
    } finally { closeSync(out); }
  };
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
