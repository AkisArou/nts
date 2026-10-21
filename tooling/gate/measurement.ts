// Admission to a timed run depends on the reserved physical core, not on
// load average or other cores. The measurement mutex is owned by with-lock.sh.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { MEASUREMENT_CPUS } from "./affinity.ts";

type Ticks = Map<number, { total: number; idle: number; program: number }>;

export function coreTicks(stat: string): Ticks {
  const result: Ticks = new Map();
  for (const line of stat.split("\n")) {
    const match = /^cpu(\d+)\s+(.+)$/.exec(line);
    if (!match || !MEASUREMENT_CPUS.includes(Number(match[1]))) continue;
    const ticks = match[2].trim().split(/\s+/).map(Number);
    if (ticks.length < 8 || ticks.some((n) => !Number.isFinite(n) || n < 0)) throw new Error("invalid /proc/stat CPU counters");
    result.set(Number(match[1]), {
      total: ticks.slice(0, 8).reduce((a, b) => a + b, 0),
      idle: ticks[3] + ticks[4],
      // `user` and `nice`: time a program ran there. The rest of the busy
      // time -- system, irq, softirq -- is the kernel's.
      program: ticks[0] + ticks[1],
    });
  }
  if (result.size !== MEASUREMENT_CPUS.length) throw new Error("/proc/stat does not name reserved CPUs 4-5");
  return result;
}

/** At most this share of one sample may be a program's before the pair counts as shared. */
const PROGRAM_SHARE = 0.02;
/** At most this share of the whole window may be busy at all. */
const BUSY_SHARE = 0.1;

/**
 * Whether a program ran on either sibling between two samples. A missing or
 * reset counter counts as one: what cannot be read is not known to be quiet.
 */
export function programRan(before: Ticks, after: Ticks): boolean {
  return MEASUREMENT_CPUS.some((cpu) => {
    const a = before.get(cpu)!;
    const b = after.get(cpu)!;
    const total = b.total - a.total;
    const program = b.program - a.program;
    return !(total > 0 && program >= 0 && program <= total) || program / total > PROGRAM_SHARE;
  });
}

/** Whether both siblings were at most 10% busy, averaged from one sample to another. */
export function coreIsQuiet(before: Ticks, after: Ticks): boolean {
  return MEASUREMENT_CPUS.every((cpu) => {
    const a = before.get(cpu)!;
    const b = after.get(cpu)!;
    const total = b.total - a.total;
    const idle = b.idle - a.idle;
    return total > 0 && idle >= 0 && idle <= total && 1 - idle / total <= BUSY_SHARE;
  });
}

/**
 * Wait until the reserved pair has run no other program, and been at most 10%
 * busy on average, for `quietMs`.
 *
 * **A program is what a timed run must not share the core with**, so one in
 * any sample restarts the window. The kernel's own time is judged over the
 * window instead: with every session pinned off the pair, what is left on it
 * is reclaim and compaction (`kswapd0`, `kcompactd0`), the journal and an NVMe
 * queue's interrupts, in bursts. A test that asked every second to be 90% idle
 * let one such second restart 45 of them, and while gates kept memory under
 * pressure the wait timed out, three times in a row with nothing but the
 * kernel there. Averaged, those bursts were 4-6%.
 */
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
  let window: { at: number; ticks: Ticks }[] = [{ at: started, ticks: read() }];
  while (now() - started < timeoutMs) {
    await sleep(Math.min(sampleMs, timeoutMs - (now() - started)));
    const current = { at: now(), ticks: read() };
    if (programRan(window[window.length - 1].ticks, current.ticks)) {
      window = [current];
      continue;
    }
    window.push(current);
    // The oldest samples go while the window is still long enough without
    // them, so the average is over the last `quietMs` and not since the start.
    while (window.length > 2 && current.at - window[1].at >= quietMs) window.shift();
    if (current.at - window[0].at >= quietMs && coreIsQuiet(window[0].ticks, current.ticks)) return true;
  }
  return false;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.platform !== "linux") {
    console.error("with-lock: reserved-core quiet admission applies on Linux; use the host's measurement affinity");
  } else {
    try {
      console.error("with-lock: waiting for CPUs 4-5 to run no other program and stay at least 90% idle on average for 45 s (limit 180 s)");
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
