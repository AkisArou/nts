import {runAsCommand} from "../differential/command-entry/main.ts";
// The full check owns its run bound even when it measures an old runner.
//
// **The run is held when it stops progressing, never because it was slowed.**
// The bound (step-bound.ts's ProgressBound) samples the run's slice every
// second: its CPU (cpu.stat), the time its tasks were runnable while higher
// ranks had the CPUs (cpu.pressure), its waits in the machine's memory ledger
// (memory-ledger.ts's ledgerWait), and its runner's step lifecycle
// (run-lifecycle.ts). Its ledger waits and CPU lost to other work spend
// nothing. A wait is its own request, one that could fit were every admitted
// job to end, or a yield to higher-ranked requests the ledger's decision
// would not admit even were the run gone, which wait on other work's memory;
// a yield to one that waits on the run's own memory is no wait, nor is a
// request that waits for memory nobody reserved. The run is held when it has
// stalled -- neither run, been runnable nor waited -- for its stall bound;
// when no step has run, started or finished for its lifecycle bound, outside
// its waits and lost CPU, which catches a spinner no step bounds; or when it has used its
// CPU bound, the backstop a slowed run cannot reach. There is no wall bound:
// every wait it excuses ends when the admitted work it waits on ends, and
// that work has its own bound.
//
// **A disk wait is named, never excused.** A temporary request of the run's
// that waits for disk (admission.ts's TemporaryAdmission.acquire) is recorded
// in the disk capacity's waits; the bound reads the record whose owner runs in
// the run's slice, keeps it in the receipt, and a held reason says how much of
// the stall it took and who holds the disk. What holds it, a pool tree's build
// promise, may never end on its own, so the wait spends the stall bound.
//
// **The bound starts when the run's command is in its slice.** The run's
// scope says so with a byte on READY_FD, written just before it execs the
// command; the measurement's own setup (its slice, and the scope it asks the
// user manager for) is not the run's. That setup has its own hang bound
// (MEASUREMENT_SETUP_HANG_MS on the host's clock), and a setup that ends
// without the run holds it with the stage it reached.
//
// **The run competes at the rank its controller names** (ranks.ts): the full
// check's own, or a culprit search's for a probe. Its slice takes that rank's
// CPU weight, its processes that rank's OOM score (`placeForOom`: a probe
// starts inside the full check's unit, at its score), and its ledger waits
// are read at that rank. What it measured is kept
// in the run folder while it runs (MEASUREMENT_PROGRESS), for
// `service.ts --status`.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { Readable, Writable } from "node:stream";

import { requireOwnUnit, startBoundSlice } from "../gate/scopes/bound-slice.ts";
import { populated, waitForEmptyCgroup } from "../gate/scopes/step-scope.ts";
import { stopToolingSlice, toolingSlice } from "../gate/tooling-slice.ts";
import { hostObservations } from "../gate/host-observations.ts";
import { HostStateError } from "../gate/host-state.ts";
import { ToolingInstrumentError } from "../gate/step-result.ts";
import { LEDGER_DIR, LEDGER_ENV, ledgerWait, placeForOom, PRIORITIES, processIdentity, type LedgerWait, type Priority, type ProcessIdentity } from "../gate/memory-ledger.ts";
import { ProgressBound, progressSummary, type CpuSample, type ProgressState, type StepLifecycle } from "../gate/step-bound.ts";
import { readRunLifecycle } from "../gate/run-lifecycle.ts";
import { DiskCapacity, describeDiskWait, type TemporaryDiskWait } from "../gate/disk-capacity.ts";


export const MEASUREMENT_HOLD = "measurement-hold.txt";
export const MEASUREMENT_PROGRESS = "measurement-progress.json";
const SAMPLE_MS = 1000;
const RECEIPT_MS = 5000;
/** How long the user manager may take to start the run's scope once asked. */
export const MEASUREMENT_SETUP_HANG_MS = 30_000;
/** The scope's descriptor for its readiness byte, closed before the command runs. */
const READY_FD = 9;

/** A run's bounds: stalled seconds; seconds with no step progress, or null for
 * a runner that publishes no lifecycle; and CPU seconds, or null when no
 * measured run gives its CPU a basis. */
export type RunBounds = { stall_s: number; lifecycle_s: number | null; cpu_s: number | null };

/** What a measurement has measured, kept up to date while it runs. */
export type MeasurementProgress = Omit<ProgressState, "expired"> & {
  version: 1; writer: ProcessIdentity; live: boolean; updated_at: string; bounds: RunBounds;
  /** The rank the run competes at; absent from a receipt an older measurement wrote. */
  rank?: Priority;
  /** The run slice's cgroup. */
  group: string;
  /** The run's ledger wait: its own request and what is queued ahead of it, or the request it yields to; and since when this observer has seen it. */
  waiting: (LedgerWait & { observed_since: string }) | null;
  /** The run's disk wait (disk-capacity.ts) and since when this observer has seen it, and the stall it has taken; absent from an older receipt. */
  disk?: (TemporaryDiskWait & { observed_since: string }) | null;
  disk_stalled_s?: number;
  held: string | null;
};

const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** A run's progress receipt, or null when it has none or it is not one. */
export function readMeasurementProgress(run: string): MeasurementProgress | null {
  let value: MeasurementProgress;
  try { value = JSON.parse(readFileSync(join(run, MEASUREMENT_PROGRESS), "utf8")) as MeasurementProgress; }
  catch { return null; }
  const optional = (bound: unknown) => bound === null || finite(bound);
  return value?.version === 1 && typeof value.live === "boolean" && [value.wall_s, value.cpu_s, value.stalled_s, value.cpu_lost_s, value.used_s, value.outside_s].every(finite)
    && finite(value.bounds?.stall_s) && optional(value.bounds.lifecycle_s) && optional(value.bounds.cpu_s) && typeof value.writer?.pid === "number" ? value : null;
}

/** Whether the measurement that wrote `progress` is still running. */
export function measuring(progress: MeasurementProgress): boolean {
  if (!progress.live) return false;
  const now = processIdentity(progress.writer.pid);
  return now !== null && now.boot === progress.writer.boot && now.start === progress.writer.start;
}

/** The reason a run stopped at a bound records; with the disk wait that took `disk.stalled_s` of its stall, the holders that disk wait named. */
export function runBoundReason(state: ProgressState, bounds: RunBounds, disk?: { wait: TemporaryDiskWait; stalled_s: number }): string {
  const why = state.expired === "cpu_s" ? `used its CPU bound of ${bounds.cpu_s} cpu-s`
    : state.expired === "lifecycle_s" ? `made no step progress for its lifecycle bound of ${bounds.lifecycle_s} s: no step ran, started or finished for ${Math.round(state.outside_s)} s of its own time`
    : `made no progress outside waits for its stall bound of ${bounds.stall_s} s`;
  const named = disk && disk.stalled_s > 0 ? `; ${Math.round(disk.stalled_s)} s of its stall waiting for disk: ${describeDiskWait(disk.wait)}` : "";
  return `full check run ${why}: ${progressSummary(state)}${named}`;
}

const positive = (value: number) => Number.isFinite(value) && value > 0;
const validBounds = (bounds: RunBounds) => positive(bounds.stall_s) && [bounds.lifecycle_s, bounds.cpu_s].every(bound => bound === null || positive(bound));

async function measure(bounds: RunBounds, run: string, slice: string, rank: Priority, command: string[]): Promise<number> {
  if (!toolingSlice({ NTS_TOOLING_SLICE: slice }) || !isAbsolute(run) || !validBounds(bounds) || !PRIORITIES.includes(rank) || !command.length) {
    throw new Error("a full-check measurement needs a run, its own slice, positive bounds and a rank");
  }
  const unit = `nts-full-check-measure-${randomUUID()}`;
  const env = process.env, host = hostObservations(env), ledger = env[LEDGER_ENV] ?? LEDGER_DIR;
  const writer = processIdentity(process.pid)!;
  const hold = (reason: string) => {
    console.error(reason);
    try { writeFileSync(join(run, MEASUREMENT_HOLD), reason + "\n"); }
    catch (error) { console.error("full check measurement receipt:", error); }
  };
  let expired = false, held: string | null = null;
  const expire = (reason: string) => {
    if (expired) return;
    expired = true; held = reason;
    hold(reason);
    try { stopToolingSlice(slice); }
    catch (error) { console.error("full check run bound could not stop its slice:", error); }
  };
  let group = "", state: ProgressState | undefined, waiting: MeasurementProgress["waiting"] = null, written = -Infinity;
  // The run's disk wait now, the last one seen, and the stall taken while one was seen.
  let disk: NonNullable<MeasurementProgress["disk"]> | null = null, lastDisk: TemporaryDiskWait | null = null, diskStalled = 0;
  const limits = { stall_s: bounds.stall_s, ...(bounds.lifecycle_s === null ? {} : { lifecycle_s: bounds.lifecycle_s }),
    ...(bounds.cpu_s === null ? {} : { cpu_s: bounds.cpu_s }) };
  // Made when the run's command is in its slice: until then nothing of the run exists to measure.
  let bound: ProgressBound | undefined;
  const receipt = (live: boolean) => {
    if (!state) return;
    const { wall_s, used_s, stalled_s, cpu_s, cpu_lost_s, outside_s, waited_s } = state;
    const progress: MeasurementProgress = { version: 1, writer, live, updated_at: new Date(host.wallNow()).toISOString(), bounds, rank, group,
      wall_s, used_s, stalled_s, cpu_s, cpu_lost_s, outside_s, waited_s, waiting, disk, disk_stalled_s: diskStalled, held };
    try {
      const file = join(run, MEASUREMENT_PROGRESS);
      writeFileSync(`${file}.next`, JSON.stringify(progress) + "\n");
      renameSync(`${file}.next`, file);
    } catch (error) { console.error("full check progress receipt:", error); }
  };
  const cpu = (): CpuSample => ({ usageUsec: host.cgroupCpu(group).usageUsec, waitingUsec: host.cgroupPressure(group).resources.cpu.some.totalUsec });
  let ledgerFailure: string | undefined;
  // The wait named now holds until the next sample. A ledger that cannot be
  // read excuses nothing.
  const wait = (): LedgerWait | null => {
    try { const found = ledgerWait(ledger, group, rank, env); ledgerFailure = undefined; return found; }
    catch (error) {
      const failure = `full check run bound cannot read the memory ledger: ${String(error)}`;
      if (failure !== ledgerFailure) console.error(failure);
      ledgerFailure = failure;
      return null;
    }
  };
  let capacity: DiskCapacity | undefined, diskFailure: string | undefined;
  // The waiting disk request whose owner runs in the run's slice. Unreadable
  // waits name nothing, and excuse nothing either way.
  const diskWait = (): TemporaryDiskWait | null => {
    try {
      capacity ??= new DiskCapacity({ env, host });
      const found = capacity.diskWaits().find(row => row.cgroup === group || row.cgroup.startsWith(`${group}/`)) ?? null;
      diskFailure = undefined; return found;
    } catch (error) {
      const failure = `full check run bound cannot read the disk waits: ${String(error)}`;
      if (failure !== diskFailure) console.error(failure);
      diskFailure = failure;
      return null;
    }
  };
  // Before its runner publishes a lifecycle, no step has run: setup counts.
  const steps = (): StepLifecycle | undefined => {
    if (bounds.lifecycle_s === null) return undefined;
    const published = readRunLifecycle(run);
    return { events: published?.events ?? 0, running: published?.running.length ?? 0 };
  };
  const sample = () => {
    if (!bound) return;
    const now = host.now(), found = wait(), stalledBefore = state?.stalled_s ?? 0;
    state = bound.observe(now, found?.kind, cpu(), steps());
    // Like a ledger wait, the interval belongs to the disk wait seen at its start.
    if (disk) diskStalled += state.stalled_s - stalledBefore;
    waiting = found === null ? null
      : waiting?.kind === found.kind && waiting.id === found.id && waiting.behind?.id === found.behind?.id ? waiting : { ...found, observed_since: new Date(host.wallNow()).toISOString() };
    const short = diskWait();
    disk = short === null ? null : { ...short, observed_since: disk?.id === short.id ? disk.observed_since : new Date(host.wallNow()).toISOString() };
    if (short) lastDisk = short;
    if (state.expired) expire(runBoundReason(state, bounds, lastDisk ? { wait: lastDisk, stalled_s: diskStalled } : undefined));
    if (expired || now - written >= RECEIPT_MS) { receipt(!expired); written = now; }
  };
  let timer:NodeJS.Timeout|undefined,acquired=false;
  let status = 124;
  let cleanupFailed = false;
  // The setup stage reached, which a setup that ends without the run names.
  let stage = "finding its own unit";
  try {
    const owner = requireOwnUnit();
    // The measurement competes for CPU at its rank, and the scope's processes,
    // this one's children, are killed in that rank's turn (ranks.ts).
    stage = `starting its slice ${slice}`;
    group = startBoundSlice(slice,owner,{rank});acquired=true;
    stage = "placing its OOM score";
    placeForOom(rank, line => console.error(line));
    stage = `starting the run's scope ${unit}`;
    // Preserve the candidate's receipt and its open description of the tree lock.
    const inherited: (number | "inherit" | null)[] = process.env.NTS_GATE_LOCK_FD === "8"
      ? ["inherit", "inherit", "inherit", 3, null, null, null, null, 8] : ["inherit", "inherit", "inherit"];
    const stdio: (number | "inherit" | "pipe" | null)[] = [...inherited, ...Array<null>(READY_FD - inherited.length).fill(null), "pipe"];
    // The scope's process says it is in the slice, then becomes the command,
    // whose exit status and signals are its own.
    // The setup bound counts from asking, the spawn itself included.
    const asked = host.now();
    const child = spawn("systemd-run", ["--user", "--scope", "--collect", "--quiet", "--expand-environment=no",
      `--unit=${unit}`, `--slice=${slice}`, "--property=TimeoutStopSec=5s",
      `--property=BindsTo=${owner}`, `--property=After=${owner}`,
      "--", "sh", "-c", `printf r >&${READY_FD}; exec ${READY_FD}>&-; exec "$@"`, "sh", ...command], { stdio });
    status = await new Promise<number>((resolve, reject) => {
      const ready = (child.stdio as readonly (Readable | Writable | null | undefined)[])[READY_FD] as Readable;
      ready.once("data", () => {
        bound = new ProgressBound(limits, host.now()); stage = "running";
        try { sample(); }
        catch (error) { expire(`full check run bound cannot observe its slice: ${String(error)}`); }
      });
      ready.resume();
      timer = setInterval(() => {
        if (expired) return;
        if (!bound) {
          if (host.now() - asked < MEASUREMENT_SETUP_HANG_MS) return;
          clearInterval(timer); timer = undefined;
          child.kill("SIGKILL");
          reject(new HostStateError("tooling-setup", `the run's command did not reach its slice within ${MEASUREMENT_SETUP_HANG_MS / 1000} s of asking the user manager for its scope`));
          return;
        }
        try { sample(); }
        catch (error) { expire(`full check run bound cannot observe its slice: ${String(error)}`); }
      }, SAMPLE_MS);
      child.once("error", reject);
      // Every descriptor has closed, the readiness byte's included.
      child.once("close", (code, signal) => bound ? resolve(code ?? 1)
        : reject(new ToolingInstrumentError("tooling-setup", `systemd-run ended (${signal ?? `exit ${code}`}) before the run's command reached its slice`)));
    });
    clearInterval(timer); timer = undefined;
    if (!expired) sample();
    // The candidate process owns resolution services. Give them time to
    // observe its exit and publish their cleanup before removing the slice.
    if (!expired) await waitForEmptyCgroup(() => expired ? 0 : populated(group));
    if (status === 124) status = 1;
  } catch (error) {
    cleanupFailed = true;
    if (!expired) hold(`full check measurement ${stage === "running" ? "scope" : `setup, ${stage}`}: ${String(error)}`);
  } finally {
    clearInterval(timer);
    receipt(false);
    try { if(acquired)stopToolingSlice(slice); }
    catch (error) {
      cleanupFailed = true;
      if (!expired) hold(`full check measurement cleanup: ${String(error)}`);
    }
  }
  // 124 is reserved for a held measurement if its receipt could not be written.
  if (expired || cleanupFailed) return 124;
  return status;
}

runAsCommand(import.meta.url,async()=>{
  const [, , stall, lifecycle, cpu, run, slice, rank, ...command] = process.argv;
  const optional = (value: string | undefined) => value === "none" ? null : Number(value);
  try { process.exitCode = await measure({ stall_s: Number(stall), lifecycle_s: optional(lifecycle), cpu_s: optional(cpu) }, run!, slice!, rank as Priority, command); }
  catch (error) { console.error(error); process.exitCode = 1; }
});
