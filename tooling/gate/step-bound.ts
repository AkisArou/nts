// How long a gate step may execute (tooling/gate/run.mjs). A step past its bound is
// stopped through its own scope and held: its log is kept, and it is never a
// pass and never a red verdict about the change. On 2026-11-07 the `dex` step
// compiled one benchmark port for 4.6 hours at full CPU, nothing bounded it,
// and every landing waited behind it.
//
// **A stated bound** is a row's `bound` in step-table.mjs, in seconds, for a
// step whose recorded cost does not predict its next run (a cargo step costs
// what its build cache lacks) or that has no committed baseline yet.
//
// **A derived bound** is three times the time the step would take if it waited
// for every other step of its run: its own CPU seconds over the slots it can
// use, plus the run's CPU seconds over the run's slots. The CPU seconds are its
// recorded cost: the tree's step CPU history, else its share of a removed
// predecessor's, else the committed baseline (step-scheduling.ts, times.tsv).
//
// **The floor is twice one command's CPU budget** (active-command.ts), so a
// case its own supervisor stops at that budget is recorded as a timeout before
// its step's bound comes, even on half a core. A tree check runs no case: it
// reads the tree and takes seconds, and its floor is ten minutes.
//
// **A landing check's ceiling caps every bound**: three times the change's
// estimate, at least fifteen minutes (tooling/landing/selection.ts). The
// landing check passes it to the runner as NTS_GATE_STEP_CEILING_S, so a stuck
// step holds the queue for minutes, not the hour the full check allows.
//
// **The clock that spends a bound** is `ProgressBound`, the same owner the
// full check's run bound uses (tooling/full-check/measure-command.ts). A
// declared admission wait spends nothing, and neither does CPU that other
// work took from the step: run.mjs samples the step slice's cpu.stat and its
// cpu.pressure `full` every 500 ms. `full` is time some of the step's tasks
// were runnable and none of them ran; `some` would also excuse a step that
// competes only with its own threads, as an oversubscribed build does. The
// excuse is a lower bound on the CPU taken, in the safe direction: the kernel
// averages a cgroup's stall over the CPUs it was busy on, so a step spread
// over N CPUs reports roughly 1/N of its real wait, and only a step on one CPU
// is excused exactly. The step's launch -- `systemd-run --scope` in the
// runner's cgroup, then its entry check and shell spread over the gate CPUs --
// is not in its slice or is diluted, so an outranked launch spends its bound
// (seconds at a landing's 100:1, against bounds of minutes; #1014's record).
// Each sample is one HostObservations observation, the counters with the
// moment they describe (cgroupCpuSample). A sleeping or hung step stalls and
// spends its bound at wall rate.
//
// **A CPU bound backs the execution bound**: the step's bound times its width,
// as if it ran at every slot it may hold for its whole bound. A step whose
// threads outrun its width reaches it first; nothing a healthy step records
// comes near it.
import { COMMAND_CPU_BUDGET_SECONDS } from "./active-command.ts";

export const STEP_BOUND_FACTOR = 3;
export const STEP_BOUND_FLOOR_S = 2 * COMMAND_CPU_BUDGET_SECONDS;
export const TREE_CHECK_FLOOR_S = 10 * 60;
export const LANDING_CEILING_FACTOR = 3;
export const LANDING_CEILING_FLOOR_S = 15 * 60;

export type StepBound = { seconds: number; basis: "stated" | "derived" | "ceiling" };
export type BoundRow = { name: string; bound?: number; treeOnly?: boolean };

export type BoundWait = "memory" | "priority" | "slots" | "frontends";

/** A gate-owned admission wait, with no case executing, consumes no execution
 * budget. A script without a pending request still consumes it, as does a
 * case holding a token, even when other workers wait. */
export function stepBoundWait(state: {
  elastic: boolean; held: number; outranked: boolean; requests: readonly number[];
  freeSlots: number; freeFrontends: number; freeBytes: number;
}): BoundWait | undefined {
  if (!state.elastic || state.held > 0) return;
  if (state.outranked) return "priority";
  if (!state.requests.length) return;
  if (state.freeSlots <= 0) return "slots";
  if (state.freeFrontends <= 0) return "frontends";
  if (state.requests.every(bytes => bytes > state.freeBytes)) return "memory";
}

/** A cgroup's CPU counters at one moment: what it ran (cpu.stat usage_usec)
 * and how long it was runnable while the CPUs ran other work, by the
 * cpu.pressure total its owner reads (`some` for a full-check run, `full` for
 * a step), both in microseconds since the cgroup began. */
export type CpuSample = { usageUsec: number; waitingUsec: number };

/** A run's steps as its runner reports them (run-lifecycle.ts): how many
 * step events (a start or a finish) it has had, and how many steps run now. */
export type StepLifecycle = { events: number; running: number };

/** The limits a bound holds work to, in seconds (cpu: CPU seconds). */
export type ProgressLimits = { execution_s?: number; wall_s?: number; stall_s?: number; lifecycle_s?: number; cpu_s?: number };
export type ProgressLimit = keyof ProgressLimits;

/** What a bound has measured so far, and the limit that expired, if one has. */
export type ProgressState = {
  wall_s: number;
  /** Time outside declared waits and outside CPU lost to other work. */
  used_s: number;
  /** Of `used_s`, the time the work neither ran nor waited for a CPU. */
  stalled_s: number;
  /** CPU the work ran, waits included. */
  cpu_s: number;
  /** Time some of the work was runnable while the CPUs ran other work. */
  cpu_lost_s: number;
  /** Given step lifecycles: used time with no step running, since the last step event. */
  outside_s: number;
  waited_s: Partial<Record<BoundWait, number>>;
  expired: ProgressLimit | undefined;
};

const LIMIT_ORDER: readonly ProgressLimit[] = ["execution_s", "stall_s", "lifecycle_s", "cpu_s", "wall_s"];

/**
 * **The one bound owner** of gate work: a step's execution budget
 * (run.mjs) and the full check's run bound (full-check/measure-command.ts).
 * Each interval between observations is the state the previous observation
 * named. A declared wait (the ledger's memory or priority, the runner's slots
 * or frontends) spends nothing. Otherwise, given CPU samples of the work's
 * cgroup, the time it was runnable but given no CPU is CPU lost to other
 * work, which a higher rank takes by design (ranks.ts), and spends nothing
 * either; the rest is used, and what of it the work did not run is stalled.
 * Once a bound has a sample, an observation without one only marks where a
 * declared wait begins or ends: the undeclared time since the last sample is
 * divided at the next one, so waits stay exact to the millisecond while the
 * counters are read at the sampler's pace. Without any sample every
 * undeclared second is used. IO and memory pressure are not progress: a hung IO wait would
 * excuse itself for ever. Given the run's step lifecycle, used time with no
 * step running counts towards `lifecycle_s` until the next step event: work
 * no step bounds -- setup, the release build, the time after the last step --
 * cannot spin unseen, and a build slowed by higher ranks is not held for it.
 * cpu.pressure `some` also counts contention among the work's own tasks: a
 * multi-threaded spinner outside steps that oversubscribes the CPUs it may
 * use loses as much as it runs, accrues neither stall nor lifecycle time, and
 * only a CPU bound holds it; a run whose CPU bound has no basis has none. `wall_s` alone counts everything.
 */
export class ProgressBound {
  #start: number;
  #last: number;
  #wait: BoundWait | undefined;
  #cpu: CpuSample | undefined;
  #steps: StepLifecycle | undefined;
  #pending = 0;
  #state: Omit<ProgressState, "expired" | "waited_s"> = { wall_s: 0, used_s: 0, stalled_s: 0, cpu_s: 0, cpu_lost_s: 0, outside_s: 0 };
  #waited: Partial<Record<BoundWait, number>> = {};
  readonly limits: Readonly<ProgressLimits>;

  constructor(limits: ProgressLimits, startedMs: number) {
    for (const [name, value] of Object.entries(limits)) {
      if (value !== undefined && !positive(value)) throw new Error(`a progress bound's ${name} of ${String(value)} is not a positive number`);
    }
    this.limits = { ...limits }; this.#start = this.#last = startedMs;
  }

  /** The interval since the last observation, then what holds from `nowMs` on. */
  observe(nowMs: number, waiting?: BoundWait, cpu?: CpuSample, steps?: StepLifecycle): ProgressState {
    const elapsed = Math.max(0, nowMs - this.#last) / 1000, state = this.#state, before = this.#cpu, earlier = this.#steps;
    let active = 0;
    if (this.#wait) this.#waited[this.#wait] = (this.#waited[this.#wait] ?? 0) + elapsed;
    // Sampled, undeclared time waits for the next sample to divide it.
    else if (before) this.#pending += elapsed;
    else { active = elapsed; state.used_s += elapsed; }
    if (cpu && before) {
      const ran = Math.max(0, cpu.usageUsec - before.usageUsec) / 1e6, pending = this.#pending;
      const lost = Math.min(pending, Math.max(0, cpu.waitingUsec - before.waitingUsec) / 1e6);
      active = pending - lost; this.#pending = 0;
      state.cpu_s += ran; state.cpu_lost_s += lost; state.used_s += active; state.stalled_s += active - Math.min(active, ran);
    }
    if (steps) {
      if ((earlier?.running ?? 0) === 0) state.outside_s += active;
      if (earlier && steps.events !== earlier.events) state.outside_s = 0;
      this.#steps = steps;
    }
    if (cpu) this.#cpu = cpu;
    this.#last = nowMs; this.#wait = waiting;
    state.wall_s = Math.max(0, nowMs - this.#start) / 1000;
    const measured: Record<ProgressLimit, number> = { execution_s: state.used_s, stall_s: state.stalled_s, lifecycle_s: state.outside_s, cpu_s: state.cpu_s, wall_s: state.wall_s };
    const expired = LIMIT_ORDER.find(limit => this.limits[limit] !== undefined && measured[limit] >= this.limits[limit]!);
    return { ...state, waited_s: { ...this.#waited }, expired };
  }
}

const seconds = (value: number) => Math.round(value);
/** What a bound measured, in words: the progress a held reason names. */
export function progressSummary(state: ProgressState): string {
  const waits = Object.entries(state.waited_s).filter(([, value]) => value > 0)
    .map(([kind, value]) => `${seconds(value)} s ${kind === "priority" ? "behind higher-ranked work" : `for ${kind}`}`);
  return `in ${seconds(state.wall_s)} s it ran ${state.cpu_s.toFixed(1)} cpu-s, lost ${seconds(state.cpu_lost_s)} s to higher-ranked CPU work`
    + `${waits.length ? `, waited ${waits.join(", ")}` : ""} and stalled ${seconds(state.stalled_s)} s`;
}

const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
/** A cost can be nothing: a check that takes no measurable time measured 0. */
const cost = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** What is wrong with a row's stated bound, or null. */
export function statedBoundProblem(row: BoundRow): string | null {
  if (row.bound === undefined || positive(row.bound)) return null;
  return `${row.name} states a bound of ${String(row.bound)}, which is not a positive number of seconds`;
}

/**
 * A step's bound: the one its row states, else the one its recorded cost
 * derives, and never above `ceiling` when a landing check gives one. `work` is
 * the step's CPU seconds, `width` the slots it can use, and `run` the CPU
 * seconds of every step in the run and the run's slots.
 */
export function stepBound(row: BoundRow, work: number, width: number, run: { cost: number; slots: number }, ceiling?: number): StepBound {
  const problem = statedBoundProblem(row);
  if (problem) throw new Error(problem);
  if (ceiling !== undefined && !positive(ceiling)) throw new Error(`a step ceiling of ${String(ceiling)} is not a positive number of seconds`);
  const capped = (bound: StepBound): StepBound => ceiling !== undefined && ceiling < bound.seconds ? { seconds: ceiling, basis: "ceiling" } : bound;
  if (row.bound !== undefined) return capped({ seconds: row.bound, basis: "stated" });
  for (const [what, value, valid] of [["cost", work, cost], ["width", width, positive], ["run cost", run.cost, cost], ["run slots", run.slots, positive]] as const) {
    if (!valid(value)) throw new Error(`the bound of ${row.name} needs a ${valid === cost ? "measured" : "positive"} ${what}, not ${String(value)}`);
  }
  const floor = row.treeOnly ? TREE_CHECK_FLOOR_S : STEP_BOUND_FLOOR_S;
  return capped({ seconds: Math.ceil(Math.max(floor, STEP_BOUND_FACTOR * (work / width + run.cost / run.slots))), basis: "derived" });
}

/** The ceiling a landing check gives every step: three times its estimate, at least fifteen minutes. */
export function landingCeiling(estimateSeconds: number): number {
  if (!cost(estimateSeconds)) throw new Error(`a landing estimate of ${String(estimateSeconds)} is not a measured number of seconds`);
  return Math.ceil(Math.max(LANDING_CEILING_FLOOR_S, LANDING_CEILING_FACTOR * estimateSeconds));
}

/** The reason a step stopped at its bound records. */
export const stepBoundReason = (seconds: number): string => `step exceeded its bound of ${seconds} s`;

/** A step's CPU bound: its bound at every slot it may hold (run.mjs's `width`, step-scheduling.ts's usableWidth). */
export function stepCpuBound(bound: StepBound, width: number): number {
  if (!positive(width)) throw new Error(`a step's CPU bound needs a positive width, not ${String(width)}`);
  return bound.seconds * width;
}

/** The reason a step stopped at its CPU bound records. */
export const stepCpuBoundReason = (cpuSeconds: number): string => `step exceeded its CPU bound of ${cpuSeconds} cpu-s`;

/**
 * The steps whose bound nothing measured derives: no committed baseline and no
 * stated bound. A tree check needs neither: it is costed at seconds.
 */
export function unmeasuredSteps(rows: readonly BoundRow[], baseline: ReadonlyMap<string, unknown>): string[] {
  return rows.filter(row => row.bound === undefined && !row.treeOnly && !baseline.has(row.name)).map(row => row.name);
}
