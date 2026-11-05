// Scheduling history is an optimization. Missing or corrupt timings use the
// committed baseline; they never change which checks run or their verdicts.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const nameOrder = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const measured = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

export function readStepWallHistory(file: string): ReadonlyMap<string, number> {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return new Map();
    const row = value as Record<string, unknown>;
    if (Object.keys(row).sort().join(",") !== "steps,version" || row.version !== 1 ||
        !row.steps || typeof row.steps !== "object" || Array.isArray(row.steps)) return new Map();
    const entries = Object.entries(row.steps);
    if (entries.some(([name, wall]) => !/^[a-z][a-z0-9-]*$/.test(name) || !measured(wall))) return new Map();
    return new Map(entries as [string, number][]);
  } catch { return new Map(); }
}

/** Bootstrap from the runner's last completed summary when this cache did
 * not yet exist. A small later train must not erase timings already retained. */
export function readPreviousStepWalls(file: string): ReadonlyMap<string, number> {
  try {
    const row = JSON.parse(readFileSync(file, "utf8")) as {
      schema?: number; environment?: { canonical?: boolean }; steps?: { name: string; verdict: string; wall?: number }[];
    };
    if (row.schema !== 1 || row.environment?.canonical !== true || !Array.isArray(row.steps)) return new Map();
    const seen = new Set<string>(), result = new Map<string, number>();
    for (const step of row.steps) {
      if (!step || typeof step.name !== "string" || !/^[a-z][a-z0-9-]*$/.test(step.name) || seen.has(step.name)) return new Map();
      seen.add(step.name);
      if (step.verdict === "PASS" && measured(step.wall)) result.set(step.name, step.wall);
    }
    return result;
  } catch { return new Map(); }
}

/** Equal and absent estimates use the same name ordering on every Node. */
export function orderStepStarts(names: readonly string[], history: ReadonlyMap<string, number>, baseline: (name: string) => number): string[] {
  const wall = (name: string): number => {
    const saved = history.get(name); if (measured(saved)) return saved;
    const fallback = baseline(name); return measured(fallback) ? fallback : 60;
  };
  return [...names].sort((a, b) => wall(b) - wall(a) || nameOrder(a, b));
}

/** Publish one merged snapshot atomically. Cache failure is observation-only. */
export function writeStepWallHistory(file: string, rows: Iterable<{ name: string; verdict: string; wall?: number }>,
  initial: ReadonlyMap<string, number> = new Map()): string | undefined {
  const pending = `${file}.${process.pid}.${randomUUID()}`;
  try {
    const timings = new Map([...initial, ...readStepWallHistory(file)]);
    for (const row of rows) if (row.verdict === "PASS" && measured(row.wall)) timings.set(row.name, row.wall);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(pending, JSON.stringify({ version: 1, steps: Object.fromEntries([...timings].sort(([a], [b]) => nameOrder(a, b))) }) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(pending, file);
    return;
  } catch (error) { return error instanceof Error ? error.message : String(error); }
  finally { try { rmSync(pending, { force: true }); } catch { /* no verdict depends on this cache */ } }
}
