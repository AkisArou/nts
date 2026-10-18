// Admission to a timed run depends on the reserved physical core, not on
// load average or other cores. The measurement mutex is owned by with-lock.sh.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { MEASUREMENT_CPUS } from "./affinity.ts";

type Ticks = Map<number, { total: number; idle: number }>;

export function coreTicks(stat: string): Ticks {
  const result: Ticks = new Map();
  for (const line of stat.split("\n")) {
    const match = /^cpu(\d+)\s+(.+)$/.exec(line);
    if (!match || !MEASUREMENT_CPUS.includes(Number(match[1]))) continue;
    const ticks = match[2].trim().split(/\s+/).map(Number);
    if (ticks.length < 8 || ticks.some((n) => !Number.isFinite(n) || n < 0)) throw new Error("invalid /proc/stat CPU counters");
    result.set(Number(match[1]), { total: ticks.slice(0, 8).reduce((a, b) => a + b, 0), idle: ticks[3] + ticks[4] });
  }
  if (result.size !== MEASUREMENT_CPUS.length) throw new Error("/proc/stat does not name reserved CPUs 4-5");
  return result;
}

export function coreIsQuiet(before: Ticks, after: Ticks): boolean {
  return MEASUREMENT_CPUS.every((cpu) => {
    const a = before.get(cpu)!;
    const b = after.get(cpu)!;
    const total = b.total - a.total;
    const idle = b.idle - a.idle;
    // At most 10% busy on either sibling; a missing/reset sample is not idle.
    return total > 0 && idle >= 0 && idle <= total && 1 - idle / total <= 0.1;
  });
}

export async function waitForQuiet(options: {
  read: () => Ticks;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  quietMs?: number;
  timeoutMs?: number;
  sampleMs?: number;
}): Promise<boolean> {
  const { read, now, sleep, quietMs = 45000, timeoutMs = 180000, sampleMs = 1000 } = options;
  const started = now();
  let since = started;
  let previous = read();
  while (now() - started < timeoutMs) {
    await sleep(Math.min(sampleMs, timeoutMs - (now() - started)));
    const current = read();
    if (!coreIsQuiet(previous, current)) since = now();
    if (now() - since >= quietMs) return true;
    previous = current;
  }
  return false;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.platform !== "linux") {
    console.error("with-lock: reserved-core quiet admission applies on Linux; use the host's measurement affinity");
  } else {
    try {
      console.error("with-lock: waiting for CPUs 4-5 to stay at least 90% idle for 45 s (limit 180 s)");
      const quiet = await waitForQuiet({
        read: () => coreTicks(readFileSync("/proc/stat", "utf8")),
        now: () => performance.now(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      });
      if (!quiet) {
        console.error("with-lock: CPUs 4-5 did not become quiet; releasing the measurement lock without starting a run");
        process.exitCode = 75;
      }
    } catch (error) {
      console.error(`with-lock: cannot establish reserved-core quiet: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 75;
    }
  }
}
