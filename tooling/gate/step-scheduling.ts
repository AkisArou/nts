// Scheduling history is an optimization. Missing or corrupt timings use the
// committed baseline; they never change which checks run or their verdicts.
//
// **Steps start by their work, not by their last wall time.** A step's work is
// the CPU seconds its checks took; divided by the slots it can use, it is the
// time the step needs once it has them. Wall time is the wrong measure to rank
// by, because it records when a step started and what ran beside it: a step
// started late meets less contention, measures short, and is started late
// again. On 2026-11-06 the three TypeScript steps that replaced
// typescript-cases started 15 to 23 minutes into a 33-minute gate that way,
// where the one step had started at 37 s.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const nameOrder = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const measured = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const stepName = /^[a-z][a-z0-9-]*$/;

/** A removed step's checks, moved to the steps that now run them (owed.mjs). */
export type StepSuccessors = Readonly<Record<string, { readonly steps: readonly string[] }>>;

/** The CPU seconds each step's checks took when they last passed. */
export function readStepCpuHistory(file: string): ReadonlyMap<string, number> {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return new Map();
    const row = value as Record<string, unknown>;
    if (Object.keys(row).sort().join(",") !== "steps,version" || row.version !== 2 ||
        !row.steps || typeof row.steps !== "object" || Array.isArray(row.steps)) return new Map();
    const entries = Object.entries(row.steps);
    if (entries.some(([name, cpu]) => !stepName.test(name) || !measured(cpu))) return new Map();
    return new Map(entries as [string, number][]);
  } catch { return new Map(); }
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
      if (!step || typeof step.name !== "string" || !stepName.test(step.name) || seen.has(step.name)) return new Map();
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

/** Publish one merged snapshot atomically. Cache failure is observation-only. */
export function writeStepCpuHistory(file: string, rows: Iterable<{ name: string; verdict: string; cpu?: number }>,
  initial: ReadonlyMap<string, number> = new Map()): string | undefined {
  const pending = `${file}.${process.pid}.${randomUUID()}`;
  try {
    const timings = new Map([...initial, ...readStepCpuHistory(file)]);
    for (const row of rows) if (row.verdict === "PASS" && measured(row.cpu)) timings.set(row.name, row.cpu);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(pending, JSON.stringify({ version: 2, steps: Object.fromEntries([...timings].sort(([a], [b]) => nameOrder(a, b))) }) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(pending, file);
    return;
  } catch (error) { return error instanceof Error ? error.message : String(error); }
  finally { try { rmSync(pending, { force: true }); } catch { /* no verdict depends on this cache */ } }
}
