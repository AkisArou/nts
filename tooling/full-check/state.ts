// Where the full check keeps its trees, target, runs and state, and the state
// itself: one JSON file, written whole and renamed into place, so a stopped
// service resumes from the last complete write and never from half of one.
// The controller is its only writer; the hourly count keeps its own file.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Job } from "./background.ts";
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
  /**
   * Held shared by a process that reads the controller's tree while the
   * service runs (the hourly count), and alone by the service to move that
   * tree to `verified` (service.ts's followVerified).
   */
  controllerLock: string;
  /**
   * Each part's records tree: its records unit records there at the run's
   * commit, and the controller applies their delta there on main. Each builds
   * what it builds in its own `target/`.
   */
  records: Readonly<Record<Part, string>>;
  /**
   * The nightly benchmarks' tree: the benchmarks unit measures there at
   * verified, and the controller publishes the run's record there on main.
   */
  bench: string;
  runs: string;
  state: string;
  /** The hourly count's own result (service.ts --count). */
  count: string;
  lock: string;
};

export function layout(cache = join(homedir(), ".cache")): Layout {
  const home = join(cache, "nts-full-check");
  return {
    home,
    tree: join(home, "tree"),
    target: join(home, "target"),
    controller: join(home, "controller"),
    controllerLock: join(home, "controller.lock"),
    records: { core: join(home, "records", "core"), wide: join(home, "records", "wide") },
    bench: join(home, "bench"),
    runs: join(home, "runs"),
    state: join(home, "state.json"),
    count: join(home, "count.json"),
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
 * Where a commit the full check made on main and submitted stands -- a
 * part's records, a night's benchmark run (service.ts's followLanding):
 * `submitted`, in the landing queue; `failed`, its last attempt was refused,
 * held or lost, or could not be made, and it is made again on the newest main
 * a few times at most; `landed`; `withdrawn`; `nothing`, nothing was left to
 * land, main having it already; `given-up`, no longer followed, its attempts
 * spent or what it is made from gone. The state stores it at each transition,
 * beside the `result` that says the same in words.
 */
export type LandingOutcome = "submitted" | "failed" | "landed" | "nothing" | "given-up" | "withdrawn";

/**
 * Where a part's records run stands: `recording` while its unit records,
 * started or started once more; then as its records commit stands
 * (LandingOutcome). It is `nothing` too when the recorder recorded nothing,
 * `failed` when the recorder or its start went wrong past saving, and
 * `given-up` when its unit ended without an outcome as often as it is started.
 */
export type RecordsRunOutcome = "recording" | LandingOutcome;

/**
 * A part's last records run, and what came of it. It records in the part's
 * records unit (`job`), beside the core; its rows are then in its `delta`,
 * which is applied on main and submitted as a records commit; the full check
 * follows that commit until the landing check lands it, and applies the delta
 * again on the newest main after a refusal, a few times at most (service.ts's
 * followRecords). `settled` is when it stopped following it.
 */
export type RecordsRun = {
  /** The commit the rows were recorded at. */
  commit: string;
  at: string;
  /** The green run whose checks listed the rows: the recorder reads its logs, and leaves its log, delta and outcome beside them. */
  run?: string;
  /** The records unit that records them (background.ts), while it runs and after. */
  job?: Job;
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
  /** Where it stands, typed; `result` says the same in words. */
  outcome?: RecordsRunOutcome;
};

/**
 * How a night's benchmarks ended: `record`, nts-bench kept a run record;
 * `no-record`, it ran and kept none; `interrupted`, its unit ended without an
 * outcome, stopped, killed or past its hang guard, as often as it is started;
 * `not-run`, the night ended before a run, its build red at verified or the
 * next nightly slot replacing it. A night that kept a record goes on from
 * `record` as its results commit stands (LandingOutcome); `measured` says it
 * kept one, whatever it is now.
 */
export type BenchOutcome = "record" | "no-record" | "interrupted" | "not-run" | LandingOutcome;

/**
 * The last night's run, or the night that ended without one, and what came
 * of it. A run that kept a record (`record`, in its run's folder) is
 * published on the newest main as a results-only commit and followed until
 * the landing check lands it, published again on the newest main after a
 * refusal, a few times at most, as records are (service.ts's followLanding);
 * `settled` is when it stopped following it.
 */
export type BenchRun = {
  commit: string; at: string; run: string; result: string; submitted: string | null; measured: boolean; slower?: string[];
  outcome?: BenchOutcome;
  /** The run's record, kept in its run's folder. */
  record?: string;
  /** A terminal observation budget, retained while its partial record lands. */
  budget?: { milliseconds: number; unreached: string[] };
  /** How many times the record was published on main, the first time included. */
  attempts?: number;
  /** The main the last attempt published it on. */
  base?: string;
  /** The landing check's last answer to a submission. */
  answer?: LandingAnswer;
  /** When the full check stopped following it: landed, withdrawn, already on main, or given up. */
  settled?: string;
};

/** The attempt in flight: its commit, when it began, its run's folder, and the benchmarks unit that measures (background.ts). */
export type Measuring = { commit: string; at: string; run: string; job?: Job };

/**
 * The nightly benchmarks from their slot until they run on the newest
 * `verified`, or the next nightly slot (`until`) replaces them. `waiting` is
 * what holds them now, and `asked` when an attempt last did not start;
 * `measuring` is the attempt in flight, in its unit, which a controller that
 * restarts adopts by its name.
 */
export type BenchmarksDue = {
  since: string; until: string; waiting?: string; asked?: string;
  measuring?: Measuring;
};

/**
 * A part's runs, and its records: each part records the kinds its own checks
 * hold, after its own green run. `waiting` names what holds a wide start.
 */
export type PartState = { last_run?: RunRecord; last_green?: RunRecord; records?: RecordsRun; waiting?: string; since?: string };

export type State = {
  version: 1;
  core: PartState;
  wide: PartState;
  culprits: Culprit[];
  probes: ProbeRecord[];
  /**
   * The last nightly benchmark attempt that ran, or the night that ended
   * without one, and what came of it: `measured` only when nts-bench kept a
   * run record of `commit`, and `slower` its rows slower than their own best
   * (bench.ts).
   */
  bench?: BenchRun;
  /** The nightly benchmarks while they are due (service.ts's runBenchmarks). */
  benchmarks_due?: BenchmarksDue;
  /** When the benchmarks last answered the nightly slot (schedule.ts's dueNightly). */
  nightly?: string;
  /** The last commit `verified` was pushed at, and when a push last failed. */
  pushed?: string;
  push_failed_at?: string;
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
  // Fixed daytime slots no longer decide wide eligibility.
  if (rest.wide) delete (rest.wide as PartState & { slot?: string }).slot;
  // The count the cycle kept, from before the count had a timer and a file of its own.
  delete (rest as { count?: unknown }).count;
  return { ...emptyState(), ...rest };
}

export function writeState(file: string, state: State): void {
  mkdirSync(dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.partial`;
  writeFileSync(partial, JSON.stringify(state, null, 2) + "\n");
  renameSync(partial, file);
}

/** What the hourly count found, and when (service.ts --count). */
export type CountRecord = { at: string; verdict: string; lines: string[] };

/** The count's own file, as the last count wrote it; null before the first. */
export function readCount(file: string): CountRecord | null {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as CountRecord : null;
}

/** Written whole and renamed into place, as the state is. */
export function writeCount(file: string, count: CountRecord): void {
  mkdirSync(dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.partial`;
  writeFileSync(partial, JSON.stringify(count, null, 2) + "\n");
  renameSync(partial, file);
}

/** A composition's cache key: the base commit and the culprits taken out of it. */
export const probeKey = (base: string, reverts: readonly string[]): string => [base, ...reverts].join("-");
