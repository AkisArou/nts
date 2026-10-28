// One in-flight case per kernel-bounded worker, preserving survivor verdicts.
// A dead worker's persistent slice retains its oom_kill count until this run
// closes. A restart starts a fresh scope and takes a new baseline per case.
import { PressureError } from "../gate/step-result.ts";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Admission, createFeed } from "../gate/admission.ts";
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
  admission?: Admission;
};

type Dispatch = { path: string; ordinal: number };
type Pressure = { dispatch?: Dispatch; cause: "aggregate-pressure" | "system-pressure"; kills: number };

async function round({ jobs, memory, workerBytes, command = process.execPath, args, onRow, report = () => {}, admission = new Admission({ report }) }: ResidentPoolOptions,
  work: Dispatch[], isolated: boolean, indexOffset = 0): Promise<Pressure[]> {
  const exclusive = isolated || Math.min(jobs, work.length) === 1;
  const queue = createFeed(work.map((_, index) => String(index)), admission);
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
        const child = spawn("systemd-run", scope.argv, { stdio: ["pipe", "pipe", "inherit"], env: scope.env });
        let exited = false;
        let restarting = false;
        let active: Dispatch | undefined;
        const finish = (row?: any) => {
          if (!active) throw new Error(`worker ${index} answered without an in-flight case`);
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
            pressure.push({ dispatch, cause, kills: after.kills - dispatchedBefore.kills });
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
          try { bound.stop(scope); } catch {}
          reject(error);
        };
        const feed = () => queue.feed({
          write: (token) => {
            if (active !== undefined) throw new Error(`worker ${index} already owns ${active}`);
            before = bound.counters();
            aggregateBefore = memory.aggregateOoms();
            active = work[Number(token)];
            child.stdin.write(`${active.path}\n`);
          },
          end: () => child.stdin.end(),
          exited: () => exited || restarting,
        }).catch(fail);
        child.on("error", fail);
        child.stdin.on("error", (error) => { if (!exited && !restarting) fail(error); });
        createInterface({ input: child.stdout }).on("line", (line) => {
          try {
            const row = JSON.parse(line);
            if (row.path !== active?.path) throw new Error(`worker ${index} answered ${row.path}, expected ${active?.path}`);
            const restart = finish(row);
            // Stop the entire scope before reuse, including any compiler child
            // left by a timed-out command. Only this worker is replaced.
            if (restart) {
              restarting = true;
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
  const { paths, jobs, memory, report = () => {} } = options;
  let budgetBytes: number;
  try { budgetBytes = memory.effectiveBudgetBytes(); }
  catch (error) { memory.close(); throw error; }
  const pressure = await round(options, paths.map((path, ordinal) => ({ path, ordinal })), false);
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
    await round({ ...options, memory: isolated, jobs: 1, admission: options.admission ?? new Admission({ report }) }, [dispatch], true, jobs + summary.isolatedReplays);
    summary.isolatedReplays++;
  }
  report(`resident pressure requeues: ${summary.pressureRequeues}; idle restarts ${summary.idlePressureRestarts}; aggregate kills ${summary.aggregatePressureKills}; system-wide kills ${summary.systemPressureKills}; isolated replays ${summary.isolatedReplays}`);
  if (paths.length > 0 && summary.pressureRequeues / paths.length > 0.05) report("resident pressure advisory: over 5% of cases needed isolated replay; review the aggregate reservation");
  return summary;
}
