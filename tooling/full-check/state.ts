// Where the full check keeps its tree, target, runs and state, and the state
// itself: one JSON file, written whole and renamed into place, so a stopped
// service resumes from the last complete write and never from half of one.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ProbeVerdict } from "./culprit.ts";
import type { LandingAnswer } from "./queue.ts";

export type Layout = {
  /** ~/.cache/nts-full-check: everything the full check owns. */
  home: string;
  /** The gate tree pinned.sh checks each measured commit out in. */
  tree: string;
  /** Its cargo target. */
  target: string;
  /** The worktree the service's own code runs from, at `verified`. */
  controller: string;
  runs: string;
  state: string;
  lock: string;
};

export function layout(cache = join(homedir(), ".cache")): Layout {
  const home = join(cache, "nts-full-check");
  return {
    home,
    tree: join(home, "tree"),
    target: join(home, "target"),
    controller: join(home, "controller"),
    runs: join(home, "runs"),
    state: join(home, "state.json"),
    lock: join(home, "service.lock"),
  };
}

/** The core runs on the newest main; the wide steps on the newest verified. */
export type Part = "core" | "wide";
export const PARTS: readonly Part[] = ["core", "wide"];

export type RunRecord = {
  commit: string;
  run: string;
  verdict: "green" | "red" | "held";
  at: string;
  failed: string[];
  reason?: string;
  /** What the culprit search made of a red run, and when; "held" is searched again. */
  search?: { result: string; at: string };
  /** A green run's pending cases and accepted changes, as its checks listed them (tooling/records/pending.ts's listedIn). */
  listed?: { pending: number; accepted: number };
};

/** What the controller is doing now, written before it starts and removed when it ends. */
export type Doing = { doing: Part | "probe" | "records" | "benchmarks"; commit: string; since: string };

/** A commit the culprit search found, and what the service did about it. */
export type Culprit = {
  commit: string;
  part: Part;
  steps: string[];
  /** The red run the search started from. */
  run: string;
  found_at: string;
  /** The revert commit submitted to the landing queue, or null when none could be made. */
  revert: string | null;
  reason?: string;
};

/** One step's verdict at one composition, kept so a later search does not measure it again. */
export type ProbeRecord = {
  key: string;
  step: string;
  verdict: ProbeVerdict;
  run: string;
  at: string;
};

/**
 * A part's last records run, and what came of it. Its rows are in its `delta`,
 * which is applied on main and submitted as a records commit; the full check
 * follows that commit until the landing check lands it, and applies the delta
 * again on the newest main after a refusal, a few times at most (service.ts's
 * followRecords). `settled` is when it stopped following it.
 */
export type RecordsRun = {
  /** The commit the rows were recorded at. */
  commit: string;
  at: string;
  /** The records commit in the landing queue, or null while none is. */
  submitted: string | null;
  result: string;
  /** The recorder's delta (tooling/records/delta.ts), in the run's folder; absent when it recorded nothing. */
  delta?: string;
  /** The compiler the rows were measured with. */
  pin?: string;
  /** How many times the delta was applied on main, the first time included. */
  attempts?: number;
  /** The main the last attempt applied it on. */
  base?: string;
  /** The landing check's last answer to a submission. */
  answer?: LandingAnswer;
  /** When the full check stopped following it: landed, withdrawn, nothing to apply, or given up. */
  settled?: string;
};

/**
 * A part's runs, and its records: each part records the kinds its own checks
 * hold, after its own green run. `slot` is when the wide steps last answered
 * their schedule.
 */
export type PartState = { last_run?: RunRecord; last_green?: RunRecord; records?: RecordsRun; slot?: string };

export type State = {
  version: 1;
  core: PartState;
  wide: PartState;
  culprits: Culprit[];
  probes: ProbeRecord[];
  /**
   * The last nightly benchmark attempt; `measured` when nts-bench ran on
   * `commit`, and `slower` its rows slower than their own best (bench.ts).
   */
  bench?: { commit: string; at: string; run: string; result: string; submitted: string | null; measured: boolean; slower?: string[] };
  /** The nightly benchmarks still waiting for a quiet machine, from their slot until the window closes. */
  benchmarks_due?: { since: string; until: string };
  /** The last commit `verified` was pushed at, and when a push last failed. */
  pushed?: string;
  push_failed_at?: string;
  count?: { at: string; verdict: string; lines: string[] };
  /** Task lines printed for the coordinator, newest last. */
  tasks: { at: string; line: string }[];
  now?: Doing;
};

export function emptyState(): State {
  return { version: 1, core: {}, wide: {}, culprits: [], probes: [], tasks: [] };
}

export function readState(file: string): State {
  if (!existsSync(file)) return emptyState();
  const value = JSON.parse(readFileSync(file, "utf8")) as State & { records?: RecordsRun };
  if (value.version !== 1) throw new Error(`${file}: unknown state version ${String(value.version)}`);
  // One records run for both parts, from before each part kept its own: it was the core's.
  const { records, ...rest } = value;
  if (records && !rest.core?.records) rest.core = { ...rest.core, records };
  return { ...emptyState(), ...rest };
}

export function writeState(file: string, state: State): void {
  mkdirSync(dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.partial`;
  writeFileSync(partial, JSON.stringify(state, null, 2) + "\n");
  renameSync(partial, file);
}

/** A composition's cache key: the base commit and the culprits taken out of it. */
export const probeKey = (base: string, reverts: readonly string[]): string => [base, ...reverts].join("-");
