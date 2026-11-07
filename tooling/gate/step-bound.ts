// How long a gate step may run (tooling/gate/run.mjs). A step past its bound is
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
import { COMMAND_CPU_BUDGET_SECONDS } from "./active-command.ts";

export const STEP_BOUND_FACTOR = 3;
export const STEP_BOUND_FLOOR_S = 2 * COMMAND_CPU_BUDGET_SECONDS;
export const TREE_CHECK_FLOOR_S = 10 * 60;

export type StepBound = { seconds: number; basis: "stated" | "derived" };
export type BoundRow = { name: string; bound?: number; treeOnly?: boolean };

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
 * derives. `work` is the step's CPU seconds, `width` the slots it can use, and
 * `run` the CPU seconds of every step in the run and the run's slots.
 */
export function stepBound(row: BoundRow, work: number, width: number, run: { cost: number; slots: number }): StepBound {
  const problem = statedBoundProblem(row);
  if (problem) throw new Error(problem);
  if (row.bound !== undefined) return { seconds: row.bound, basis: "stated" };
  for (const [what, value, valid] of [["cost", work, cost], ["width", width, positive], ["run cost", run.cost, cost], ["run slots", run.slots, positive]] as const) {
    if (!valid(value)) throw new Error(`the bound of ${row.name} needs a ${valid === cost ? "measured" : "positive"} ${what}, not ${String(value)}`);
  }
  const floor = row.treeOnly ? TREE_CHECK_FLOOR_S : STEP_BOUND_FLOOR_S;
  return { seconds: Math.ceil(Math.max(floor, STEP_BOUND_FACTOR * (work / width + run.cost / run.slots))), basis: "derived" };
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
