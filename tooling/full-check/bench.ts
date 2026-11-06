// The nightly benchmarks (docs/workflow.md, Benchmarks): after the nightly
// wide steps, nts-bench measures `verified`, on CPU 4 with its sibling idle,
// through the measurement lock -- the same entry point a person runs:
//
//   tooling/gate/with-lock.sh --wait target/release/nts-bench --root <tree>
//
// nts-bench refuses to start while any other `nts` runs, and a landing check
// may be running one, so the machine is waited for rather than fought: first
// outside the lock (tooling/gate/wait-idle.sh, up to a deadline, holding
// nothing anyone else needs), then inside it, briefly, as wait-idle.sh says
// the order must be. nts-bench keeps every run itself: it writes one
// immutable record under results/benchmarks/runs/, renders full.md and
// commits the two as a results-only commit on the tree's HEAD, `verified`.
// The service submits that commit the way it submits records.
import { spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import type { Git } from "./git.ts";

/** Measure in `tree`, keeping the output in `run`; `quiet` false when the machine never was. */
export type Bench = (tree: string, run: string) => { status: number; quiet: boolean };

export const RESULTS_SUBJECT = "results: retain benchmark run ";
/** The page nts-bench renders from the newest complete run. */
export const FULL_MD = "results/benchmarks/full.md";

/** Wait this long for a quiet machine before giving the night up. */
export const DEFAULT_QUIET_WAIT_MINUTES = 240;

/** The production benchmark: wait-idle.sh, then with-lock.sh --wait nts-bench --root <tree>. */
export function benchWithLock(controller: string, target: string, quietWaitMinutes: number): Bench {
  const waitIdle = join(controller, "tooling/gate/wait-idle.sh");
  const withLock = join(controller, "tooling/gate/with-lock.sh");
  const bench = join(target, "release/nts-bench");
  return (tree, run) => {
    const out = openSync(join(run, "bench.log"), "a");
    try {
      const io = { cwd: tree, stdio: ["ignore", out, out] as ["ignore", number, number] };
      const waited = spawnSync("timeout", [String(quietWaitMinutes * 60), "sh", waitIdle, "45"], io);
      if (waited.status !== 0) return { status: waited.status ?? 1, quiet: false };
      const measured = spawnSync("sh", [withLock, "--wait", "sh", "-c", 'timeout 600 sh "$0" 45 && exec "$1" --root "$2"', waitIdle, bench, tree], io);
      return { status: measured.status ?? 1, quiet: true };
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
