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

/** The step's execution budget, with an independent wall ceiling for a
 * landing. Only the runner's admission decisions can suspend this clock;
 * individual command supervisors keep their own clocks throughout. */
export class StepBoundClock {
  #start: number;
  #last: number;
  #wait: BoundWait | undefined;
  #used = 0;
  #waited: Partial<Record<BoundWait, number>> = {};
  #seconds: number;
  #ceiling: number | undefined;

  constructor(seconds: number, startedMs: number, ceilingSeconds?: number) {
    this.#seconds = seconds; this.#start = this.#last = startedMs; this.#ceiling = ceilingSeconds;
  }

  observe(nowMs: number, waiting?: BoundWait) {
    const elapsed = Math.max(0, nowMs - this.#last) / 1000;
    if (this.#wait) this.#waited[this.#wait] = (this.#waited[this.#wait] ?? 0) + elapsed;
    else this.#used += elapsed;
    this.#last = nowMs; this.#wait = waiting;
    return { used_s: this.#used, waited_s: { ...this.#waited },
      expired: this.#used >= this.#seconds || this.#ceiling !== undefined && (nowMs - this.#start) / 1000 >= this.#ceiling };
  }
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

/**
 * The steps whose bound nothing measured derives: no committed baseline and no
 * stated bound. A tree check needs neither: it is costed at seconds.
 */
export function unmeasuredSteps(rows: readonly BoundRow[], baseline: ReadonlyMap<string, unknown>): string[] {
  return rows.filter(row => row.bound === undefined && !row.treeOnly && !baseline.has(row.name)).map(row => row.name);
}
