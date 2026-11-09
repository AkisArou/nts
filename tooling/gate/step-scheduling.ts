// Scheduling history is an optimization. Missing or corrupt history uses the
// committed baseline and the machine's shares; it never changes which checks
// run or their verdicts.
//
// **One history of what each step costs, per target**: `steps.json` in
// <target>/gate-costs (NTS_GATE_COSTS_DIR, where a test's code names its own).
// For each step, the CPU seconds its checks took when they last passed, and
// the memory its last few runs held at most; beside the steps, by key, the
// jobs that reserve memory outside any step (memory-ledger.ts's `reserveJob`,
// `admit.ts --key`): an agent's build, a census run by hand. Every canonical
// gate run writes it, every job writes its own, and every run reads it. It is
// per target because a step's costs depend on its tree's build cache: a warm
// build takes seconds and little memory, a cold one forty minutes and
// gigabytes.
//
// **Steps start by their work, not by their last wall time.** A step's work is
// the CPU seconds its checks took; divided by the slots it can use, it is the
// time the step needs once it has them. Wall time is the wrong measure to rank
// by, because it records when a step started and what ran beside it: a step
// started late meets less contention, measures short, and is started late
// again. On 2026-11-06 the three TypeScript steps that replaced
// typescript-cases started 15 to 23 minutes into a 33-minute gate that way,
// where the one step had started at 37 s.
//
// **Memory is reserved by what was measured.** A peak is the most a step's
// slice held, sampled on the memory ledger's own basis (cgroupCharge: what no
// other job can have, without the page cache the kernel gives back first), per
// unit of the step: the whole step for a fixed step, one token for an elastic
// one, one worker for a job. The last KEPT_PEAKS peaks are kept, and a unit
// reserves 1.25 times the largest, so one small run never shrinks a
// reservation. A key never measured in this history reserves the largest
// reservation of its kind here; with none, its share of the machine: of what
// the ledger can ever give (MemTotal less the system's floor), its width over
// the slots, so a run whose every slot is busy fits. There is no declared
// number anywhere: the step table names none.
//
// **A reservation decides when work starts, never its verdict.** The kernel
// cap a step's census runs under (censusCapBytes) is never below one census
// worker's own cap, so a case replayed alone meets only its own limit in a
// fresh tree as in a warm one.
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nameOrder = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const measured = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const bytes = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
/** A step's name, and a job's key: lower-case words joined by hyphens. */
export const KEY = /^[a-z][a-z0-9-]*$/;
const TOOLING_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** A removed step's checks, moved to the steps that now run them (owed.mjs). */
export type StepSuccessors = Readonly<Record<string, { readonly steps: readonly string[] }>>;

/** What a memory peak was measured over: a fixed step, one token of an elastic step, one worker of a job. */
export type MemoryUnit = "step" | "token" | "worker";
/** A key's last few measured peaks, oldest first, in bytes per unit. */
export type Peaks = { readonly unit: MemoryUnit; readonly peaks: readonly number[] };
export type StepCosts = { readonly cpu?: number; readonly memory?: Peaks };
export type CostHistory = { readonly steps: ReadonlyMap<string, StepCosts>; readonly jobs: ReadonlyMap<string, Peaks> };

/** Peaks kept per key: one small run among them does not shrink a reservation. */
export const KEPT_PEAKS = 5;
const MIB = 2 ** 20;
/** The least a measured unit reserves. */
export const LEAST_RESERVATION_BYTES = 128 * MIB;

const empty = (): CostHistory => ({ steps: new Map(), jobs: new Map() });

function parsePeaks(value: unknown, units: readonly MemoryUnit[]): Peaks | null {
  if (!record(value) || !keys(value, ["unit", "peaks"]) || !units.includes(value.unit as MemoryUnit)) return null;
  const peaks = value.peaks;
  if (!Array.isArray(peaks) || peaks.length === 0 || peaks.length > KEPT_PEAKS || !peaks.every(bytes)) return null;
  return { unit: value.unit as MemoryUnit, peaks };
}

/**
 * The history in `file`: version 3, or version 2's CPU seconds alone. A file
 * that is missing, corrupt or of another version is an empty history.
 */
export function readCostHistory(file: string): CostHistory {
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, "utf8")); } catch { return empty(); }
  if (!record(value)) return empty();
  if (value.version === 2) {
    if (!keys(value, ["version", "steps"]) || !record(value.steps)) return empty();
    const entries = Object.entries(value.steps);
    if (entries.some(([name, cpu]) => !KEY.test(name) || !measured(cpu))) return empty();
    return { steps: new Map(entries.map(([name, cpu]) => [name, { cpu: cpu as number }])), jobs: new Map() };
  }
  if (value.version !== 3 || !keys(value, ["version", "steps", "jobs"]) || !record(value.steps) || !record(value.jobs)) return empty();
  const steps = new Map<string, StepCosts>(), jobs = new Map<string, Peaks>();
  for (const [name, row] of Object.entries(value.steps)) {
    if (!KEY.test(name) || !record(row) || !keys(row, ["cpu", "memory"])) return empty();
    if (row.cpu !== undefined && !measured(row.cpu)) return empty();
    const memory = row.memory === undefined ? undefined : parsePeaks(row.memory, ["step", "token"]);
    if (memory === null || (row.cpu === undefined && memory === undefined)) return empty();
    steps.set(name, { ...(row.cpu !== undefined ? { cpu: row.cpu as number } : {}), ...(memory ? { memory } : {}) });
  }
  for (const [key, row] of Object.entries(value.jobs)) {
    const memory = KEY.test(key) ? parsePeaks(row, ["worker"]) : null;
    if (memory === null) return empty();
    jobs.set(key, memory);
  }
  return { steps, jobs };
}

/** The CPU seconds each step's checks took when they last passed. */
export function stepCpu(history: CostHistory): ReadonlyMap<string, number> {
  return new Map([...history.steps].flatMap(([name, row]) => row.cpu === undefined ? [] : [[name, row.cpu] as [string, number]]));
}

/** Bootstrap from the runner's last completed summary when this cache did
 * not yet exist. A later run of a few steps must not erase timings already retained. */
export function readPreviousStepCpu(file: string): ReadonlyMap<string, number> {
  try {
    const row = JSON.parse(readFileSync(file, "utf8")) as {
      schema?: number; environment?: { canonical?: boolean }; steps?: { name: string; verdict: string; cpu?: number }[];
    };
    if (row.schema !== 1 || row.environment?.canonical !== true || !Array.isArray(row.steps)) return new Map();
    const seen = new Set<string>(), result = new Map<string, number>();
    for (const step of row.steps) {
      if (!step || typeof step.name !== "string" || !KEY.test(step.name) || seen.has(step.name)) return new Map();
      seen.add(step.name);
      if (step.verdict === "PASS" && measured(step.cpu)) result.set(step.name, step.cpu);
    }
    return result;
  } catch { return new Map(); }
}

/**
 * A successor's share of its predecessor's measured work, for the successors
 * that have none of their own yet. The predecessor's total is conserved: it is
 * split by the successors' baseline CPU when every one of them has a baseline,
 * and equally otherwise. Giving each successor the whole total would multiply
 * the work a split step is estimated to bring. A retired check (no successors)
 * passes its work to nobody.
 *
 * **A successor named by two measured predecessors inherits nothing.** Two
 * removed steps may be distinct checks merged into one (their work adds) or
 * one check renamed twice (it does not), and the table does not say which; the
 * successor's baseline is the estimate until its own run is measured.
 */
export function inheritedStepWork(history: ReadonlyMap<string, number>, baseline: (name: string) => number | undefined,
  successors: StepSuccessors): ReadonlyMap<string, number> {
  const shares = new Map<string, number>(), ambiguous = new Set<string>();
  for (const [predecessor, { steps }] of Object.entries(successors)) {
    const total = history.get(predecessor);
    if (!measured(total) || steps.length === 0) continue;
    const weights = steps.map(baseline);
    const proportional = weights.every(measured);
    const sum = proportional ? weights.reduce((a, b) => a + (b as number), 0) : steps.length;
    steps.forEach((step, i) => {
      if (measured(history.get(step))) return;
      if (shares.has(step)) ambiguous.add(step);
      shares.set(step, total * (proportional ? (weights[i] as number) : 1) / sum);
    });
  }
  for (const step of ambiguous) shares.delete(step);
  return shares;
}

/** The slots a step can use at once: its own width, the run's slots, and the
 * run's frontends when its workers start frontends. */
export function usableWidth(step: { readonly slots?: number; readonly fe?: boolean }, budget: { readonly slots: number; readonly frontends: number }): number {
  return Math.max(1, Math.min(step.slots ?? 1, budget.slots, step.fe ? budget.frontends : Infinity));
}

/** Start the longest uncontended steps first. Equal and absent estimates use
 * the same name ordering on every Node. */
export function orderStepStarts(names: readonly string[], seconds: (name: string) => number): string[] {
  const estimate = (name: string): number => { const value = seconds(name); return measured(value) ? value : 0; };
  return [...names].sort((a, b) => estimate(b) - estimate(a) || nameOrder(a, b));
}

// ---------------------------------------------------------------------------
// Memory reservations.
// ---------------------------------------------------------------------------

/** One unit's reservation from its measured peaks: 1.25 times the largest, at least LEAST_RESERVATION_BYTES, in whole MiB. */
export function peakReservation(peaks: readonly number[]): number {
  return Math.max(LEAST_RESERVATION_BYTES, Math.ceil(1.25 * Math.max(...peaks) / MIB) * MIB);
}

/** A share of the machine: `width` of its `slots`, never more than all of it. */
export function machineShare(totalBytes: number, width: number, slots: number): number {
  return Math.floor(totalBytes * Math.min(width, slots) / slots);
}

export type MemorySizing = {
  /** Per unit. */
  bytes: number;
  /** Its own peaks; else the largest reservation of its kind in the history; else its share of the machine. */
  basis: "measured" | "largest" | "share";
};

/**
 * What one unit of a step or a job reserves: from its own measured peaks;
 * never measured in this history, the largest reservation of a unit of its
 * kind here (a fixed step's, a token's, a job worker's); with none, `share`.
 * A step whose peaks were measured over another unit (it was fixed, and is
 * elastic now) has none of its own.
 */
export function unitReservation(history: CostHistory, of: { step: string } | { job: string }, unit: MemoryUnit, share: number): MemorySizing {
  const rows: Peaks[] = "step" in of
    ? [...history.steps.values()].flatMap(row => row.memory?.unit === unit ? [row.memory] : [])
    : [...history.jobs.values()];
  const own = "step" in of ? history.steps.get(of.step)?.memory : history.jobs.get(of.job);
  if (own && own.unit === unit) return { bytes: peakReservation(own.peaks), basis: "measured" };
  if (rows.length) return { bytes: Math.max(...rows.map(row => peakReservation(row.peaks))), basis: "largest" };
  return { bytes: share, basis: "share" };
}

/**
 * The kernel cap a step's census aggregate runs under
 * (NTS_GATE_STEP_MEMORY_BYTES): twice the step's reservation, so a peak can
 * pass the reservation and be measured -- the step is then over, and its next
 * reservation covers the peak; never below its share of the machine, which an
 * empty history reserves; and never below one census worker's own cap, so a
 * case replayed alone meets only its own limit.
 */
export function censusCapBytes(reservedBytes: number, shareBytes: number, workerBytes: number): number {
  return Math.max(2 * reservedBytes, shareBytes, workerBytes);
}

// ---------------------------------------------------------------------------
// The file.
// ---------------------------------------------------------------------------

/**
 * The history of the target a tool runs against: NTS_GATE_COSTS_DIR's, as
 * the gate gives each step and a test names its own; else CARGO_TARGET_DIR's,
 * else the tooling tree's `target`.
 */
export function historyFile(env: NodeJS.ProcessEnv = process.env, root: string = TOOLING_ROOT): string {
  const target = env.CARGO_TARGET_DIR ? resolve(env.CARGO_TARGET_DIR) : join(root, "target");
  return join(resolve(env.NTS_GATE_COSTS_DIR ?? join(target, "gate-costs")), "steps.json");
}

export type StepObservation = {
  name: string; verdict?: string; cpu?: number;
  /** The most it held, per unit: present only for a step that ran to its own end. */
  memory?: { unit: "step" | "token"; peak: number };
};
export type JobObservation = { key: string; peak: number };

const LOCK_WAIT_SECONDS = 10;

/** The history's own lock, held across a read and its write so that no writer's observation is lost; null when none came within LOCK_WAIT_SECONDS. */
function lockHistory(file: string): (() => void) | null {
  const fd = openSync(`${file}.lock`, "a", 0o600);
  let locked: SpawnSyncReturns<string>;
  try {
    // flock(1) locks the open file description it is handed as fd 8, which
    // this process shares; the lock ends when `fd` closes.
    locked = spawnSync("flock", ["-w", String(LOCK_WAIT_SECONDS), "-E", "75", "8"], { stdio: ["ignore", "ignore", "pipe", null, null, null, null, null, fd], encoding: "utf8" });
  } catch (error) { closeSync(fd); throw error; }
  if (locked.status === 0) return () => closeSync(fd);
  closeSync(fd);
  if (locked.status === 75) return null;
  throw new Error(`cannot lock ${file}: ${locked.error?.message ?? (locked.stderr.trim() || `flock ended ${locked.status ?? locked.signal}`)}`);
}

const appended = (kept: Peaks | undefined, unit: MemoryUnit, peak: number): Peaks =>
  ({ unit, peaks: [...(kept?.unit === unit ? kept.peaks : []), peak].slice(-KEPT_PEAKS) });

/**
 * Adds what a run or a job measured to the history in `file`, under its lock,
 * and publishes the merged history atomically: a passing step's CPU seconds
 * replace its last, a peak joins its key's last few. `initialCpu` seeds CPU
 * seconds the file does not hold yet. The history's directory is made only
 * where its parent exists: a target, or a test's own directory that has not
 * been removed. A failure is observation-only, returned as a warning.
 */
export function writeCostHistory(file: string, observed: { steps?: Iterable<StepObservation>; jobs?: Iterable<JobObservation> },
  initialCpu: ReadonlyMap<string, number> = new Map()): string | undefined {
  const pending = `${file}.${process.pid}.${randomUUID()}`;
  let unlock: (() => void) | null = null;
  try {
    try { mkdirSync(dirname(file)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    unlock = lockHistory(file);
    if (unlock === null) return `${file} stayed locked for ${LOCK_WAIT_SECONDS} s`;
    const current = readCostHistory(file);
    const steps = new Map<string, { cpu?: number; memory?: Peaks }>();
    for (const [name, cpu] of initialCpu) if (KEY.test(name) && measured(cpu)) steps.set(name, { cpu });
    for (const [name, row] of current.steps) steps.set(name, { ...steps.get(name), ...row });
    const jobs = new Map(current.jobs);
    for (const row of observed.steps ?? []) {
      if (!KEY.test(row.name)) continue;
      const was = steps.get(row.name) ?? {};
      const cpu = row.verdict === "PASS" && measured(row.cpu) ? row.cpu : was.cpu;
      const memory = row.memory && bytes(row.memory.peak) ? appended(was.memory, row.memory.unit, row.memory.peak) : was.memory;
      if (cpu !== undefined || memory !== undefined) steps.set(row.name, { ...(cpu !== undefined ? { cpu } : {}), ...(memory ? { memory } : {}) });
    }
    for (const row of observed.jobs ?? []) if (KEY.test(row.key) && bytes(row.peak)) jobs.set(row.key, appended(jobs.get(row.key), "worker", row.peak));
    const sorted = <T>(map: ReadonlyMap<string, T>) => Object.fromEntries([...map].sort(([a], [b]) => nameOrder(a, b)));
    writeFileSync(pending, JSON.stringify({ version: 3, steps: sorted(steps), jobs: sorted(jobs) }) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(pending, file);
    return;
  } catch (error) { return error instanceof Error ? error.message : String(error); }
  finally {
    try { rmSync(pending, { force: true }); } catch { /* no verdict depends on this cache */ }
    unlock?.();
  }
}
