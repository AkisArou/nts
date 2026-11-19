// What a launch-to-exit observation means as a benchmark cell, and the one
// check every record reader holds it to (tooling/bench/README.md, "Launch
// rows"). Pure: launcher.ts produces observations, run-record.ts decodes them,
// and both derive a cell's value, spread and checksum only here.
import type { Cell, Json } from "./run-record.ts";

/** The protocol a launch observation was taken under; older cold-startup details carry none. */
export const LAUNCH_PROTOCOL = "launch-to-exit-v1";
/** Untimed for the verdict: page cache only. Every column gets the same. */
export const LAUNCH_WARMUPS = 3;
/** Timed launches per column; odd, so the median is one observation. */
export const LAUNCH_COUNT = 21;
/** The row kind whose cells are launch-to-exit observations. */
export const LAUNCH_KIND = "launch";

/** One child, from just before posix_spawn to just after wait4 reaped it. */
export type Launch = {
  wallNanoseconds: number;
  /** Exit status, or null when a signal ended it. */
  status: number | null;
  signal: number | null;
  timedOut: boolean;
  userMicroseconds: number;
  systemMicroseconds: number;
  /** wait4's own ru_maxrss for this child: an observation only, not a row. */
  maxRssKib: number;
  /** User and nice ticks on the timed CPU's sibling around this launch; null when none was named. */
  siblingTicks: number | null;
  stdoutSha256: string;
};

/** Median and interquartile ratio, quartiles by linear interpolation. */
export function launchSummary(walls: readonly number[]): { median: number; spread: number } {
  if (walls.length === 0) throw new Error("launch summary of no launches");
  const sorted = [...walls].sort((a, b) => a - b);
  const at = (q: number) => {
    const position = (sorted.length - 1) * q, low = Math.floor(position), high = Math.ceil(position);
    return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
  };
  const q1 = at(0.25), q3 = at(0.75);
  if (!(q1 > 0)) throw new Error("launch quartile is not positive");
  return { median: at(0.5), spread: q3 / q1 };
}

function fail(at: string, message: string): never {
  throw new Error(`${at}: ${message}`);
}
function objectAt(value: unknown, at: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(at, "expected object");
  return value as Record<string, unknown>;
}
function count(value: unknown, at: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(at, "expected a whole number");
  return value;
}
const LAUNCH_KEYS = ["wallNanoseconds", "status", "signal", "timedOut", "userMicroseconds", "systemMicroseconds", "maxRssKib", "siblingTicks", "stdoutSha256"];

/** One launch as recorded, strictly: a missing or malformed field is an instrument error. */
export function readLaunch(value: unknown, at: string): Launch {
  const o = objectAt(value, at);
  if (Object.keys(o).length !== LAUNCH_KEYS.length || !LAUNCH_KEYS.every(key => Object.hasOwn(o, key))) fail(at, "missing or unknown launch field");
  const wallNanoseconds = count(o.wallNanoseconds, at + ".wallNanoseconds");
  if (wallNanoseconds === 0) fail(at, "a launch took no time");
  const status = o.status === null ? null : count(o.status, at + ".status");
  const signal = o.signal === null ? null : count(o.signal, at + ".signal");
  if ((status === null) === (signal === null)) fail(at, "a launch ends by exactly one of a status or a signal");
  if (typeof o.timedOut !== "boolean") fail(at, "timedOut is not a boolean");
  if (typeof o.stdoutSha256 !== "string" || !/^[0-9a-f]{64}$/.test(o.stdoutSha256)) fail(at, "invalid stdout digest");
  return {
    wallNanoseconds, status, signal, timedOut: o.timedOut,
    userMicroseconds: count(o.userMicroseconds, at + ".userMicroseconds"),
    systemMicroseconds: count(o.systemMicroseconds, at + ".systemMicroseconds"),
    maxRssKib: count(o.maxRssKib, at + ".maxRssKib"),
    siblingTicks: o.siblingTicks === null ? null : count(o.siblingTicks, at + ".siblingTicks"), stdoutSha256: o.stdoutSha256,
  };
}

/** What every launch cell's details hold under `launch`. */
export type LaunchDetails = {
  protocol: typeof LAUNCH_PROTOCOL;
  warmups: Launch[];
  launches: Launch[];
  stdoutSha256: string;
  environmentSha256: string;
};

/**
 * The cell a column's launches make. Every timed launch exited 0 within its
 * bound and printed the same stdout: OK, its median and interquartile ratio,
 * its stdout digest as the checksum. A launch that timed out, was killed or
 * exited non-zero makes the cell TIMED_OUT or ABORTED with no timing. A
 * column whose launches disagree with each other is INVALID.
 */
export function launchCell(details: LaunchDetails, extra: Record<string, Json>, stderr: string): Cell {
  const all = [...details.warmups, ...details.launches];
  const keep = { launch: details as unknown as Json, ...extra };
  const failed = (status: Cell["status"], reason: string): Cell =>
    ({ status, nanoseconds: null, spread: null, checksum: null, verified: false, reason, details: keep });
  if (all.some(launch => launch.timedOut)) return failed("TIMED_OUT", "A launch passed its wall or CPU bound");
  const bad = all.find(launch => launch.status !== 0);
  if (bad) return failed("ABORTED", (bad.signal !== null ? `Killed by signal ${bad.signal}` : `Exited ${bad.status}`) + (stderr.trim() ? `: ${stderr.trim()}` : ""));
  if (all.some(launch => launch.stdoutSha256 !== details.stdoutSha256)) return failed("INVALID", "Launches of one column printed different output");
  const { median, spread } = launchSummary(details.launches.map(launch => launch.wallNanoseconds));
  return { status: "OK", nanoseconds: median, spread, checksum: details.stdoutSha256.slice(0, 16), verified: true, reason: null, details: keep };
}

/**
 * The decoder's check of one cell in a launch row. An OK cell must carry the
 * whole protocol, and its value, spread and checksum must be what its
 * launches derive: a record cannot carry a launch number its launches do not
 * support.
 */
export function checkLaunchCell(cell: Pick<Cell, "status" | "nanoseconds" | "spread" | "checksum" | "verified" | "details">, at: string): void {
  if (cell.status !== "OK") return;
  const launch = objectAt(objectAt(cell.details, at + ".details").launch, at + ".details.launch");
  if (launch.protocol !== LAUNCH_PROTOCOL) fail(at, "unknown launch protocol");
  if (!Array.isArray(launch.warmups) || launch.warmups.length !== LAUNCH_WARMUPS) fail(at, `expected ${LAUNCH_WARMUPS} warm-up launches`);
  if (!Array.isArray(launch.launches) || launch.launches.length !== LAUNCH_COUNT) fail(at, `expected ${LAUNCH_COUNT} timed launches`);
  if (typeof launch.environmentSha256 !== "string" || !/^[0-9a-f]{64}$/.test(launch.environmentSha256)) fail(at, "launch environment digest missing");
  const digest = launch.stdoutSha256;
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) fail(at, "launch stdout digest missing");
  const warmups = launch.warmups.map((value, index) => readLaunch(value, `${at}.warmups[${index}]`));
  const launches = launch.launches.map((value, index) => readLaunch(value, `${at}.launches[${index}]`));
  for (const one of [...warmups, ...launches]) {
    if (one.status !== 0 || one.timedOut) fail(at, "an OK launch cell holds a failed launch");
    if (one.stdoutSha256 !== digest) fail(at, "an OK launch cell holds launches with different output");
  }
  const { median, spread } = launchSummary(launches.map(one => one.wallNanoseconds));
  if (cell.nanoseconds !== median) fail(at, "launch value is not the median of its launches");
  if (cell.spread !== spread) fail(at, "launch spread is not the interquartile ratio of its launches");
  if (!cell.verified || cell.checksum !== digest.slice(0, 16)) fail(at, "launch checksum is not its stdout digest");
}

/**
 * The protocol a cold-startup observation in a throughput cell's details was
 * taken under. Details written before the launch timer carry none, and two
 * observations compare only under one named protocol.
 */
export function coldStartupProtocol(details: Json): string | null {
  if (details === null || typeof details !== "object" || Array.isArray(details)) return null;
  const cold = details.coldStartup;
  if (cold === null || typeof cold !== "object" || Array.isArray(cold)) return null;
  return typeof cold.protocol === "string" ? cold.protocol : null;
}
export function comparableColdStartups(a: Json, b: Json): boolean {
  const left = coldStartupProtocol(a);
  return left !== null && left === coldStartupProtocol(b);
}
