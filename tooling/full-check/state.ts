import {assertStateVersion} from '../gate/state-version.ts';
import {withStateWrite} from '../gate/state-file.ts';
import {durableRecord} from '../gate/durable-record.ts';
import {createHash} from 'node:crypto';
// Where the full check keeps its trees, target, runs and state, and the state
// itself: one JSON file, written whole and renamed into place, so a stopped
// service resumes from the last complete write and never from half of one.
// The controller owns progress; the answer command changes only task answers.
// Both use one state flock, and progress writes merge persisted answers. The
// hourly count keeps its own file.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
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
    state: join(home, "state-v2.json"),
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
export type Doing = { doing: Part | "probe" | "records" | "benchmarks" | "restarting"; commit: string; since: string };

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
  version: 2;
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
  /** Open tasks and retained answers, newest last. Only answered rows expire. */
  tasks: TaskRecord[];
  /** Published report sequence, retained even after its answered row expires. */
  task_sequence: number;
  /** Monotonic retention boundary; a stale writer cannot restore expired history. */
  task_history_since?: string;
  now?: Doing;
};

export function emptyState(): State {
  return { version: 2, core: {}, wide: {}, culprits: [], probes: [], tasks: [], task_sequence: 0 };
}

export function readState(file: string): State {
  // Import the old controller's last publication only before the new path exists.
  // Older controllers/candidates keep their own file and never overwrite v2.
  const legacy = basename(file) === 'state-v2.json' ? join(dirname(file), 'state.json') : file;
  const source = existsSync(file) ? file : legacy;
  if (!existsSync(source)) return emptyState();
  const value = JSON.parse(readFileSync(source, "utf8")) as Omit<State,'version'|'tasks'|'task_sequence'> & { version: number; records?: RecordsRun; task_sequence?: number; tasks?: Array<TaskRecord | Omit<TaskRecord,'id'|'sequence'>> };
  assertStateVersion(value,2,source);
  if (value.version !== 1 && value.version !== 2) throw new Error(`${source}: unknown state version ${String(value.version)}`);
  // One records run for both parts, from before each part kept its own: it was the core's.
  const { records, ...rest } = value;
  if (records && !rest.core?.records) rest.core = { ...rest.core, records };
  // Fixed daytime slots no longer decide wide eligibility.
  if (rest.wide) delete (rest.wide as PartState & { slot?: string }).slot;
  // The count the cycle kept, from before the count had a timer and a file of its own.
  delete (rest as { count?: unknown }).count;
  const migrated = emptyState(), tasks = migrated.tasks;
  for (const row of rest.tasks ?? []) {
    if (value.version === 1) tasks.push(newTask(migrated,row.at,row.line));
    else {
      tasks.push(row as TaskRecord);
    }
  }
  validateTasks(tasks,value.version === 1 ? migrated.task_sequence : rest.task_sequence!,source);
  return { ...emptyState(), ...rest, version: 2, tasks, task_sequence: value.version === 1 ? migrated.task_sequence : rest.task_sequence! };
}

export type TaskAnswer = { issue: number; reason?: never } | { reason: string; issue?: never };
export type TaskRecord = { id: string; sequence: number; at: string; line: string; answer?: TaskAnswer & { at: string } };
/** Human acknowledgement history; unanswered work has no age or count ceiling. */
export const ANSWER_RETENTION_MS = 30 * 24 * 60 * 60_000;

const taskId = (at: string, line: string, sequence: number) => createHash('sha256').update(JSON.stringify([at,line,sequence])).digest('hex').slice(0,16);
const validAnswer = (answer: TaskAnswer) => (answer.issue !== undefined) !== (answer.reason !== undefined)
  && (answer.issue !== undefined ? Number.isSafeInteger(answer.issue) && answer.issue > 0 : typeof answer.reason === 'string' && !!answer.reason.trim());
function validateTasks(tasks: readonly TaskRecord[], sequence: number, file: string): void {
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw Error(`${file}: invalid task sequence`);
  const ids = new Set<string>(), sequences = new Set<number>();
  for (const task of tasks) {
    if (!task || typeof task.at !== 'string' || !Number.isFinite(Date.parse(task.at)) || typeof task.line !== 'string' || !task.line.trim()
      || !Number.isSafeInteger(task.sequence) || task.sequence <= 0 || task.sequence > sequence || task.id !== taskId(task.at,task.line,task.sequence)
      || ids.has(task.id) || sequences.has(task.sequence)) throw Error(`${file}: invalid task immutable identity`);
    if (task.answer !== undefined && (!task.answer || !validAnswer(task.answer) || typeof task.answer.at !== 'string' || !Number.isFinite(Date.parse(task.answer.at)))) throw Error(`${file}: invalid task answer`);
    ids.add(task.id); sequences.add(task.sequence);
  }
}

export function newTask(state: State, at: string, line: string): TaskRecord {
  if (!Number.isFinite(Date.parse(at)) || !line.trim()) throw Error('invalid task timestamp or text');
  const sequence = state.task_sequence + 1;
  if (!Number.isSafeInteger(sequence)) throw Error('task sequence is exhausted');
  const id = taskId(at,line,sequence);
  if (state.tasks.some(task => task.id === id)) throw Error('task identity collision');
  state.task_sequence = sequence;
  return { id, sequence, at, line };
}

/** Pure retention decision from the cycle's supplied wall clock. */
export function retainTaskHistory(state: State, now: Date): void {
  const since = new Date(now.getTime() - ANSWER_RETENTION_MS).toISOString();
  state.task_history_since = state.task_history_since && state.task_history_since > since ? state.task_history_since : since;
  state.tasks = state.tasks.filter(task => !task.answer || task.answer.at >= state.task_history_since!);
}

export function writeState(file: string, state: State): void {
  withStateWrite(file,2,() => {
    assertStateVersion(state,2,file);
    if (state.version !== 2) throw Error(`${file}: refusing a non-v2 controller publication`);
    validateTasks(state.tasks,state.task_sequence,file);
    const current = existsSync(file) ? readState(file) : emptyState();
    const persisted = new Map(current.tasks.map(task => [task.id, task]));
    const proposed = new Map(state.tasks.map(task => [task.id, task]));
    // Progress publication cannot delete reports. Only the supplied retention
    // boundary may remove an answered row, and unanswered rows always remain.
    for (const task of current.tasks) if (!proposed.has(task.id)) proposed.set(task.id,task);
    const retained: TaskRecord[] = [];
    for (const task of proposed.values()) {
      const previous = persisted.get(task.id);
      // Every published sequence at or below the high-water was already seen.
      // Missing now means its answered history expired, even if this snapshot
      // predates its answer. Only genuinely new reports can pass that boundary.
      if (!previous && task.sequence <= current.task_sequence) continue;
      if (previous && (previous.at !== task.at || previous.line !== task.line || previous.sequence !== task.sequence)) throw Error(`${file}: task ${task.id} changed its immutable identity`);
      if (previous?.answer) {
        if (task.answer && (task.answer.at !== previous.answer.at || task.answer.issue !== previous.answer.issue || task.answer.reason !== previous.answer.reason)) throw Error(`${file}: task ${task.id} has conflicting answers`);
        task.answer = previous.answer;
      }
      retained.push(task);
    }
    state.tasks = retained.sort((a,b)=>a.sequence-b.sequence);
    state.task_sequence = Math.max(state.task_sequence,current.task_sequence);
    if (current.task_history_since && (!state.task_history_since || current.task_history_since > state.task_history_since)) state.task_history_since = current.task_history_since;
    if (state.task_history_since) state.tasks = state.tasks.filter(task => !task.answer || task.answer.at >= state.task_history_since!);
    durableRecord(file,state);
  });
}

/** A narrow writer shares the state flock, never the controller's lifetime lock. */
export function answerTask(file: string, id: string, answer: TaskAnswer, now: Date): TaskRecord {
  if (!/^[0-9a-f]{16}$/.test(id)) throw Error(`invalid task id ${JSON.stringify(id)}`);
  if (!validAnswer(answer)) throw Error('a task answer needs a positive issue or a nonempty reason');
  return withStateWrite(file,2,() => {
    if (!existsSync(file) || (JSON.parse(readFileSync(file,'utf8')) as {version?:number}).version !== 2) throw Error('task answers wait for the controller to adopt state-v2.json');
    const state = readState(file), task = state.tasks.find(task => task.id === id);
    if (!task) throw Error(`unknown task ${id}`);
    if (task.answer) {
      if (task.answer.issue !== answer.issue || task.answer.reason !== answer.reason) throw Error(`task ${id} was already answered`);
      return task;
    }
    task.answer = {...answer, at: now.toISOString()};
    retainTaskHistory(state,now);
    writeState(file,state);
    return task;
  });
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
