// The watcher of a job's memory peak (memory-ledger.ts's `reserveJob` and
// `watchPeak`). Every WATCH_MS it reads what the reservation's measure holds --
// the job's own cgroup, or its process tree, as the ledger's decisions count
// it -- and keeps the most; the first time that passes what the job reserved,
// it says so in a fixed reservation's entry (`over`). A live job publishes
// its observed peak instead, without claiming to have exceeded a forecast.
// It runs beside the job's own work, so a job that blocks in a child
// process for minutes is sampled all the same. It writes no verdict, sends no
// signal, and ends with the reservation.
//
// Two ways in:
//
//   - On a thread of the job's own process (reserveJob): it keeps the peak
//     in the shared cell it is handed, and the job adds it to the history
//     when it releases the reservation.
//   - As a process of its own, for a job that `admit.ts` has become:
//
//       node tooling/gate/memory-watch.ts <ledger> <reservation> <history> <key> <workers>
//
//     It does not count itself, and once the reservation has ended (released,
//     dropped, or its owner gone) it adds the most it saw, per worker, to the
//     scheduling history under the job's key (step-scheduling.ts) and exits.
import { resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { isMainThread, workerData } from "node:worker_threads";
import { admittedEntry, entryUsage, noteOver, noteSampledPeak, WATCH_MS } from "./memory-ledger.ts";
import { KEY, writeCostHistory } from "./step-scheduling.ts";

/**
 * Samples reservation `id` in `ledger` until it ends, and returns the most it
 * held; `seen` is told each new most. `exclude` is a process in the measure
 * that is not the job's.
 */
export async function watchReservation(ledger: string, id: string, key: string, options: { exclude?: number; seen?: (bytes: number) => void; signal?: AbortSignal } = {}): Promise<number> {
  let peak = 0, over = false;
  for (;;) {
    const entry = admittedEntry(ledger, id);
    if (entry === null) return peak;
    try {
      const held = entryUsage(entry, { exclude: options.exclude });
      if (held > peak) {
        peak = held; options.seen?.(peak);
        if (entry.liveUse) await noteSampledPeak(ledger, id, peak);
      }
    } catch { /* one sample missed: a process or cgroup went as it was read */ }
    if (!entry.liveUse && !over && peak > entry.bytes) {
      over = true;
      try { await noteOver(ledger, id, key); } catch { /* the entry says less; the history still learns the peak */ }
    }
    try { await pause(WATCH_MS, undefined, { signal: options.signal }); }
    catch (error) { if (options.signal?.aborted) return peak; throw error; }
  }
}

if (!isMainThread) {
  const { ledger, id, key, peak } = workerData as { ledger: string; id: string; key: string; peak: SharedArrayBuffer };
  const cell = new BigInt64Array(peak);
  await watchReservation(ledger, id, key, { seen: bytes => Atomics.store(cell, 0, BigInt(bytes)) });
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [ledger, id, history, key, workers] = process.argv.slice(2);
  const units = Number(workers);
  if (!ledger || !id || !history || !key || !KEY.test(key) || !Number.isSafeInteger(units) || units < 1) {
    process.stderr.write("usage: node tooling/gate/memory-watch.ts <ledger> <reservation> <history> <key> <workers>\n");
    process.exit(2);
  }
  // A unit may terminate its remaining processes when the command exits.
  // Keep the last observed peak in that path too, before closing its output.
  const ending = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => ending.abort());
  const most = await watchReservation(ledger, id, key, { exclude: process.pid, signal: ending.signal });
  if (most > 0) writeCostHistory(history, { jobs: [{ key, peak: Math.ceil(most / units) }] });
}
