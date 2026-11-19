// What a peak-RSS row's cells mean, and the checks every record reader holds
// them to (tooling/bench/README.md, "Peak-RSS rows"). Pure: a peak-RSS cell
// is a launch cell (launch-cell.ts) whose launches also rank it by memory,
// and its value is derived only here, from the same launches that time it.
import type { Cell } from "./run-record.ts";
import { checkLaunchCell, launchSummary, readLaunch, type Launch } from "./launch-cell.ts";

/** The row kind whose cells rank by the peak resident set of their launches. */
export const PEAK_RSS_KIND = "peak-rss";

/** A cell's peak resident set: the median of its timed launches' ru_maxrss, in bytes, and their interquartile ratio. */
export type PeakRss = { bytes: number; spread: number };

/** Which case's workload a peak-RSS row calls once, and at what input. */
export type Sized = { case: string; function: string; input: number };

/**
 * Whether a column's work grows with its input across one case's rows in a
 * run: GROWS when it ran at two or more sizes and its time rises strictly at
 * every larger size; FLAT when it ran at two or more and its time did not;
 * UNESTABLISHED when it ran at fewer than two. Only a column that GROWS is
 * ranked: a literal input could let a compiler fold the work away, and time
 * that does not rise with the work has not shown it ran it. Memory is the
 * ranked value and takes no part here: doing the work in constant memory is
 * the best peak-RSS outcome, not a sign the work was skipped.
 */
export type Growth = "GROWS" | "FLAT" | "UNESTABLISHED";
export const GROWTHS: readonly Growth[] = ["GROWS", "FLAT", "UNESTABLISHED"];

function fail(at: string, message: string): never {
  throw new Error(`${at}: ${message}`);
}

/** The peak RSS of a column's timed launches; a launch with no resident set is an instrument error. */
export function peakRssOf(launches: readonly Launch[], at: string): PeakRss {
  if (launches.some(launch => !(launch.maxRssKib > 0))) fail(at, "a launch recorded no peak resident set");
  const { median, spread } = launchSummary(launches.map(launch => launch.maxRssKib));
  return { bytes: median * 1024, spread };
}

/** A launch cell made a peak-RSS cell: OK cells gain the peak RSS of their launches, absent ones null. */
export function peakRssCell(cell: Cell, at: string): Cell {
  if (cell.status !== "OK") return { ...cell, peakRss: null };
  return { ...cell, peakRss: peakRssOf(launchesOf(cell, at), at) };
}

function launchesOf(cell: Cell, at: string): Launch[] {
  const details = cell.details as { launch?: { launches?: unknown } } | null;
  const launches = details?.launch?.launches;
  if (!Array.isArray(launches)) fail(at, "a peak-RSS cell holds no launches");
  return launches.map((value, index) => readLaunch(value, `${at}.launches[${index}]`));
}

/**
 * The decoder's check of one cell in a peak-RSS row: an OK cell is a whole
 * launch cell whose peak RSS is what its launches derive; an absent one has
 * none. A record cannot carry a memory number its launches do not support.
 */
export function checkPeakRssCell(cell: Cell, at: string): void {
  if (!Object.hasOwn(cell, "peakRss")) fail(at, "a peak-RSS row's cell has no peakRss");
  if (cell.status !== "OK") {
    if (cell.peakRss !== null) fail(at, "an absent cell carries a peak RSS");
    return;
  }
  checkLaunchCell(cell, at);
  const derived = peakRssOf(launchesOf(cell, at), at), recorded = cell.peakRss;
  if (!recorded || recorded.bytes !== derived.bytes) fail(at, "peak RSS is not the median of its launches");
  if (recorded.spread !== derived.spread) fail(at, "peak RSS spread is not the interquartile ratio of its launches");
}

/**
 * Each peak-RSS row's growth per column, over the rows of one run: rows of
 * one case and function compared by input. Two rows of one case at the same
 * input are an error, not two observations.
 */
export function peakRssGrowth(rows: readonly { name: string; sized: Sized; cells: Record<string, Cell> }[],
  columns: readonly string[]): Map<string, Record<string, Growth>> {
  const groups = new Map<string, typeof rows[number][]>();
  for (const row of rows) {
    const key = JSON.stringify([row.sized.case, row.sized.function]);
    const group = groups.get(key) ?? [];
    if (group.some(other => other.sized.input === row.sized.input)) fail(row.name, `two peak-RSS rows of ${row.sized.case} at input ${row.sized.input}`);
    group.push(row);
    groups.set(key, group);
  }
  const growth = new Map<string, Record<string, Growth>>();
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.sized.input - b.sized.input);
    const byColumn = Object.fromEntries(columns.map(column => {
      const ran = sorted.map(row => row.cells[column]!).filter(cell => cell.status === "OK");
      if (ran.length < 2) return [column, "UNESTABLISHED" as Growth];
      const grows = ran.every((cell, index) => index === 0 || cell.nanoseconds! > ran[index - 1]!.nanoseconds!);
      return [column, (grows ? "GROWS" : "FLAT") as Growth];
    }));
    for (const row of group) growth.set(row.name, byColumn);
  }
  return growth;
}
