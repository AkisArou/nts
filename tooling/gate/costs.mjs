// Longest first: the order a pool of workers should take projects in.
//
// A tool that hands N projects to W workers in name order finishes when its
// last worker does, and if the most expensive project is drawn last the whole
// step waits for it alone: `integrity --runtime` drew `runtime/web-platform`
// last of 29, after `runtime/node/zlib`. Starting the expensive ones first is
// the classic longest-processing-time rule, and it is the difference between
// the step taking (total / W) and (total / W + the largest project).
//
// The cost of a project is what it took the last time this tool ran it,
// recorded per tool in `$NTS_GATE_COSTS_DIR/<tool>.json` (the runner sets it
// to <target>/gate-costs). The first run, and any project never timed, falls
// back to the size of its TypeScript, which ranks the large runtime modules
// first. Order only: no verdict, count or printed line depends on it, which is
// what makes a stale or missing cost file harmless.

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = process.env.NTS_GATE_COSTS_DIR ?? join(ROOT, "target", "gate-costs");

function tsBytes(dir) {
  let total = 0;
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts")) { try { total += statSync(p).size; } catch {} }
    }
  };
  walk(dir);
  return total;
}

function read(tool) {
  try {
    return JSON.parse(readFileSync(join(DIR, `${tool}.json`), "utf8"));
  } catch {
    return {};
  }
}

/**
 * `projects`, most expensive first. A project is its own cost key; `where`
 * maps it to the directory whose TypeScript sizes it when it was never timed.
 */
export function longestFirst(tool, projects, where = (p) => p) {
  const seen = read(tool);
  const cost = new Map();
  for (const p of projects) {
    // Seconds when timed; bytes / 10,000 otherwise, which puts a 2 MB corpus
    // at 200 "seconds" -- only the ranking among the untimed matters.
    cost.set(p, typeof seen[p] === "number" ? seen[p] : tsBytes(resolve(ROOT, where(p))) / 10_000);
  }
  return [...projects].sort((a, b) => cost.get(b) - cost.get(a));
}

/** Remember what each project took, for the next run's order. */
export function recordCosts(tool, seconds) {
  try {
    mkdirSync(DIR, { recursive: true });
    const merged = { ...read(tool), ...seconds };
    writeFileSync(join(DIR, `${tool}.json`), JSON.stringify(merged, null, 1) + "\n");
  } catch {
    // Order is an optimisation; failing to remember it must not fail a step.
  }
}

/** A counting semaphore: at most `n` holders of `run` at once. */
export function limiter(n) {
  let active = 0;
  const queue = [];
  // A released slot passes straight to the next waiter, so nobody can take it
  // in between and the count never exceeds `n`.
  const release = () => {
    const next = queue.shift();
    if (next) next();
    else active -= 1;
  };
  return async (fn) => {
    if (active < n) active += 1;
    else await new Promise((r) => queue.push(r));
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
