// Where the full check keeps its tree, target, runs and state, and the state
// itself: one JSON file, written whole and renamed into place, so a stopped
// service resumes from the last complete write and never from half of one.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ProbeVerdict } from "./culprit.ts";

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
};

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

/** A part's runs; `slot` is when the wide steps last answered their schedule. */
export type PartState = { last_run?: RunRecord; last_green?: RunRecord; slot?: string };

export type State = {
  version: 1;
  core: PartState;
  wide: PartState;
  culprits: Culprit[];
  probes: ProbeRecord[];
  /** The last verified commit whose pending and improved records were written and submitted. */
  records?: { commit: string; at: string; submitted: string | null; result: string };
  /** The last nightly benchmark attempt; `measured` when nts-bench ran on `commit`. */
  bench?: { commit: string; at: string; run: string; result: string; submitted: string | null; measured: boolean };
  /** The nightly benchmarks still waiting for a quiet machine, from their slot until the window closes. */
  benchmarks_due?: { since: string; until: string };
  /** The last commit `verified` was pushed at, and when a push last failed. */
  pushed?: string;
  push_failed_at?: string;
  count?: { at: string; verdict: string; lines: string[] };
  /** Task lines printed for the coordinator, newest last. */
  tasks: { at: string; line: string }[];
};

export function emptyState(): State {
  return { version: 1, core: {}, wide: {}, culprits: [], probes: [], tasks: [] };
}

export function readState(file: string): State {
  if (!existsSync(file)) return emptyState();
  const value = JSON.parse(readFileSync(file, "utf8")) as State;
  if (value.version !== 1) throw new Error(`${file}: unknown state version ${String(value.version)}`);
  return { ...emptyState(), ...value };
}

export function writeState(file: string, state: State): void {
  mkdirSync(dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.partial`;
  writeFileSync(partial, JSON.stringify(state, null, 2) + "\n");
  renameSync(partial, file);
}

/** A composition's cache key: the base commit and the culprits taken out of it. */
export const probeKey = (base: string, reverts: readonly string[]): string => [base, ...reverts].join("-");
