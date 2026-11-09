// One in-flight case per kernel-bounded worker, preserving survivor verdicts.
// A dead worker's persistent slice retains its oom_kill count until this run
// closes. A restart starts a fresh scope and takes a new baseline per case.
//
// Each in-flight case holds one gate token (`token`, via the feed) from its
// dispatch until it is answered, requeued or lost, or its worker fails; a
// worker that stops while it waits for one cancels the wait. The workers
// themselves never ask: what they run is already counted.
//
// The pool's memory is the job's reservation in the machine's memory ledger
// (memory-ledger.ts's `reserveJob`): inside a gate step, the run's; alone, its
// own, of the resident run's aggregate budget, which the kernel enforces
// anyway. No case asks for memory of its own, and while the reservation is
// outranked no new case starts.
import { PressureError, ToolingInstrumentError } from "../gate/step-result.ts";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createFeed, type CaseToken } from "../gate/admission.ts";
import { reserveJob, type Reservation } from "../gate/memory-ledger.ts";
import { MemoryRun, memoryCause, memoryDisposition, caseBudgetMessage, type MemoryCounters } from "./worker-memory.ts";

export type ResidentPoolOptions = {
  paths: string[];
  jobs: number;
  memory: MemoryRun;
  workerBytes: number;
  command?: string;
  args: (index: number) => string[];
  onRow: (row: any) => void;
  report?: (message: string) => void;
  token: CaseToken;
  /** What the job's memory reservation is for, when the pool has to make one. */
  what?: string;
  /** Reclaim a warm producer's heaps after this many completed cases. */
  recycleAfterCases?: number;
};

type Dispatch = { path: string; ordinal: number };
type Pressure = { dispatch?: Dispatch; cause: "aggregate-pressure" | "system-pressure"; kills: number };

async function round({ jobs, memory, workerBytes, command = process.execPath, args, onRow, report = () => {}, token, recycleAfterCases }: ResidentPoolOptions,
  work: Dispatch[], isolated: boolean, reservation: Reservation, indexOffset = 0): Promise<Pressure[]> {
  const exclusive = isolated || Math.min(jobs, work.length) === 1;
  // Asked before each case, which takes far longer than the ledger's answer.
  const queue = createFeed(work.map((_, index) => String(index)), {
    token: (entry, signal) => token(work[Number(entry)]!.path, signal), outranked: () => reservation.outranked(),
  });
  const pressure: Pressure[] = [];
  const tasks: Promise<void>[] = [];
  let idleRestarts = 0;
  const worker = async (index: number) => {
    const bound = memory.worker(index, workerBytes);
    let again = true;
    while (again) {
      again = await new Promise<boolean>((resolve, reject) => {
        // Include startup and waits between dispatches: an idle scope can be
        // collateral damage from the same aggregate or system-wide killer.
        let before: MemoryCounters = bound.counters();
        let aggregateBefore = memory.aggregateOoms();
        const scope = bound.scope(command, args(index + indexOffset));
        scope.env.NTS_CENSUS_POOL_WORKER = "1";
        scope.env.NTS_CENSUS_CASE_CONCURRENCY = exclusive ? "exclusive" : "parallel";
        scope.env.NTS_GATE_TOKEN_HELD = "1";
        const child = spawn("systemd-run", scope.argv, { stdio: ["pipe", "pipe", "inherit"], env: scope.env });
        const stopped = new AbortController();
        let exited = false;
        let restarting = false;
        let completedCases = 0;
        let active: Dispatch | undefined;
        let release: (() => void) | undefined;
        const returnToken = () => {
          const held = release;
          release = undefined;
          held?.();
        };
        const finish = (row?: any) => {
          if (!active) throw new Error(`worker ${index} answered without an in-flight case`);
          returnToken();
          const dispatch = active;
          const dispatchedBefore = before;
          const after = bound.counters();
          const aggregateAfter = memory.aggregateOoms();
          const cause = memoryCause(before, after, aggregateBefore, aggregateAfter);
          active = undefined;
          before = after;
          aggregateBefore = aggregateAfter;
          if (memoryDisposition(cause, exclusive ? "exclusive" : "parallel") === "budget") {
            onRow({ path: dispatch.path, bucket: "memory-cap", why: cause === "own-limit" ? "worker's own resident limit fired" : caseBudgetMessage(dispatch.path, memory.budgetBytes),
              residentWorkerBytes: bound.bytes, residentRunBytes: memory.budgetBytes, residentPressureRetries: Number(isolated) });
            return true;
          }
          if (cause) {
            if (isolated) throw new PressureError(`resident instrument failure: isolated replay of ${dispatch.path} was killed by ${cause}, without an own-limit OOM`);
            pressure.push({ dispatch, cause: cause as Pressure["cause"], kills: after.kills - dispatchedBefore.kills });
            report(`resident pressure: requeued ${dispatch.path} after ${cause}; no verdict recorded`);
            return true;
          }
          if (!row) throw new Error(`worker ${index} lost ${dispatch.path}; no OOM kill recorded`);
          if (row.bucket === "memory-cap") throw new Error(`resident instrument failure: ${dispatch.path} reported memory-cap without an own-limit OOM`);
          onRow({ ...row, residentPressureRetries: Number(isolated) });
          return row.bucket === "timeout";
        };
        const fail = (error: unknown) => {
          exited = true;
          stopped.abort();
          returnToken();
          try { bound.stop(scope); } catch {}
          reject(error);
        };
        const feed = () => queue.feed({
          write: (entry, granted) => {
            if (active !== undefined) {
              granted();
              throw new Error(`worker ${index} already owns ${active.path}`);
            }
            // Owned before anything here can throw, so a failure returns it.
            release = granted;
            before = bound.counters();
            aggregateBefore = memory.aggregateOoms();
            active = work[Number(entry)]!;
            child.stdin.write(`${active.path}\n`);
          },
          end: () => child.stdin.end(),
          exited: () => exited || restarting,
          signal: stopped.signal,
        }).catch(fail);
        child.on("error", fail);
        child.stdin.on("error", (error) => { if (!exited && !restarting) fail(error); });
        createInterface({ input: child.stdout }).on("line", (line) => {
          try {
            const row = JSON.parse(line);
            if (row.path !== active?.path) throw new Error(`worker ${index} answered ${row.path}, expected ${active?.path}`);
            const failed = finish(row);
            const recycled = recycleAfterCases !== undefined && ++completedCases >= recycleAfterCases;
            const restart = failed || recycled;
            // Stop the entire scope before reuse, including any compiler child
            // left by a timed-out command. Only this worker is replaced.
            if (restart) {
              restarting = true;
              if(recycled&&!failed)report(`resident worker ${index}: recycling after ${completedCases} completed cases`);
              bound.stop(scope);
            } else {
              void feed();
            }
          } catch (error) { fail(error); }
        });
        child.on("exit", () => { exited = true; });
        // 'close' follows all stdout lines, unlike 'exit'. A final valid answer
        // must be consumed before deciding whether the process lost a case.
        child.on("close", (code, signal) => {
          exited = true;
          stopped.abort();
          try {
            const entered = bound.ready(scope);
            bound.stop(scope);
            if (active !== undefined) {
              restarting = finish();
            } else if (!restarting) {
              const after = bound.counters();
              const cause = memoryCause(before, after, aggregateBefore, memory.aggregateOoms());
              if (cause === "own-limit") throw new Error(`resident instrument failure: idle worker ${index} reached its own limit without an in-flight case`);
              if (cause) {
                if (isolated) throw new PressureError(`resident instrument failure: idle worker ${index} was killed by ${cause} in isolated replay`);
                if (++idleRestarts > work.length + jobs) throw new PressureError(`resident pressure prevented worker startup or idle admission after ${idleRestarts} restarts`);
                pressure.push({ cause, kills: after.kills - before.kills });
                report(`resident pressure: idle worker ${index} killed by ${cause}; restarting without a case replay`);
                restarting = true;
              } else if (code !== 0 || !entered) {
                throw new Error(`worker ${index} exited ${signal ?? code} without an in-flight case; no OOM kill recorded`);
              }
            }
            resolve(restarting && queue.dispatched < work.length);
          } catch (error) { reject(error); }
          // Its process is gone, so no case of this worker runs any more,
          // whichever way the classification above ended.
          finally { returnToken(); }
        });
        const start = async () => {
          const deadline = Date.now() + 15_000;
          while (!bound.ready(scope)) {
            if (exited) return; // close classifies startup pressure or setup failure.
            if (Date.now() >= deadline) throw new Error(`resident cap: worker ${index} scope did not become ready`);
            await new Promise((resume) => setTimeout(resume, 10));
          }
          await feed();
        };
        void start().catch(fail);
      });
    }
  };
  try {
    for (let index = 0; index < Math.min(jobs, work.length); index++) tasks.push(worker(index));
    await Promise.all(tasks);
    return pressure;
  } catch (error) {
    memory.close();
    await Promise.allSettled(tasks);
    throw error;
  } finally {
    memory.close();
  }
}


export type ResidentPoolSummary = {
  pressureRequeues: number; idlePressureRestarts: number; aggregatePressureKills: number; systemPressureKills: number; isolatedReplays: number;
};

/** Each input has one final row. Parallel pressure is retried once, alone in
 * fresh cgroups after every parallel scope and its charges have been removed. */
export async function runMemoryWorkers(options: ResidentPoolOptions): Promise<ResidentPoolSummary> {
  if(options.recycleAfterCases!==undefined&&(!Number.isSafeInteger(options.recycleAfterCases)||options.recycleAfterCases<1)){
    options.memory.close();
    throw new ToolingInstrumentError('tooling-setup','resident worker recycling requires a positive completed-case count');
  }
  if (typeof options.token !== "function") {
    options.memory.close();
    throw new ToolingInstrumentError("tooling-setup", "resident workers require an explicit token policy");
  }
  const { paths, memory, report = () => {} } = options;
  let budgetBytes: number;
  try { budgetBytes = memory.effectiveBudgetBytes(); }
  catch (error) { memory.close(); throw error; }
  let reservation: Reservation;
  try { reservation = await reserveJob({ bytes: budgetBytes, what: options.what ?? `resident workers for ${paths.length} case(s)` }, { report }); }
  catch (error) { memory.close(); throw error; }
  try { return await rounds(options, budgetBytes, reservation); }
  // A reservation this pool made ends with it; one it ran inside is its job's.
  finally { if (!reservation.inherited) reservation.release(); }
}

async function rounds(options: ResidentPoolOptions, budgetBytes: number, reservation: Reservation): Promise<ResidentPoolSummary> {
  const { paths, jobs, report = () => {} } = options;
  const pressure = await round(options, paths.map((path, ordinal) => ({ path, ordinal })), false, reservation);
  const replays = pressure.filter((p): p is Pressure & { dispatch: Dispatch } => p.dispatch !== undefined);
  const summary: ResidentPoolSummary = {
    pressureRequeues: replays.length,
    idlePressureRestarts: pressure.length - replays.length,
    aggregatePressureKills: pressure.filter(p => p.cause === "aggregate-pressure").reduce((n, p) => n + p.kills, 0),
    systemPressureKills: pressure.filter(p => p.cause === "system-pressure").reduce((n, p) => n + p.kills, 0),
    isolatedReplays: 0,
  };
  for (const { dispatch } of replays.sort((a, b) => a.dispatch.ordinal - b.dispatch.ordinal)) {
    const isolated = new MemoryRun({ budgetBytes });
    await round({ ...options, memory: isolated, jobs: 1 }, [dispatch], true, reservation, jobs + summary.isolatedReplays);
    summary.isolatedReplays++;
  }
  report(`resident pressure requeues: ${summary.pressureRequeues}; idle restarts ${summary.idlePressureRestarts}; aggregate kills ${summary.aggregatePressureKills}; system-wide kills ${summary.systemPressureKills}; isolated replays ${summary.isolatedReplays}`);
  if (paths.length > 0 && summary.pressureRequeues / paths.length > 0.05) report("resident pressure advisory: over 5% of cases needed isolated replay; review the aggregate reservation");
  return summary;
}
