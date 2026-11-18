// One in-flight case per kernel-bounded worker, preserving survivor verdicts.
// A dead worker's persistent slice retains its oom_kill count until this run
// closes. A restart starts a fresh scope and takes a new baseline per case.
//
// Each in-flight case holds one gate token (`token`, via the feed) from its
// dispatch until it is answered, requeued or lost, or its worker fails; a
// worker that stops while it waits for one withdraws the wait, and a grant
// that won that race comes back as a returned offer (the summary's
// `returnedOffers`). The workers themselves never ask: what they run is
// already counted.
//
// The pool's memory is the job's reservation in the machine's memory ledger
// (memory-ledger.ts's `reserveJob`): inside a gate step, the run's; alone, its
// own, sized by what the pool's earlier runs under its key held per worker,
// never more than the resident run's aggregate budget, which the kernel
// enforces anyway. No case asks for memory of its own, and while the
// reservation is outranked no new case starts.
import { PressureError, ToolingInstrumentError } from "../gate/step-result.ts";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createFeed, type CaseToken,type FeedOffer } from "../gate/admission.ts";
import { cgroupCharge, reserveJob, type Reservation } from "../gate/memory-ledger.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRun, memoryCause, memoryDisposition, caseBudgetMessage, memoryEvents, type MemoryCounters, type MemoryCause } from "./worker-memory.ts";
import {caseCohort} from '../gate/case-cohort.ts';
import {registerCommandCloser} from '../differential/command-entry/main.ts';
import {registerCaseScope,releaseToken,type TokenRelease} from '../gate/case-context.ts';

import {workerRoleValues} from './worker-identity.ts';

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
  /** Its key in the scheduling history, when the pool has to make one: its earlier runs' peaks size it. */
  key?: string;
  /** Reclaim a warm producer's heaps after this many completed cases. */
  recycleAfterCases?: number;
  /**
   * Reclaim them at once after a case that leaves its worker holding more
   * than this, on the memory ledger's basis (cgroupCharge): a heavy case's
   * heaps are then neither held through the cases after it nor measured as
   * theirs. `charge` reads a worker slice's charge (its group).
   */
  recycleAboveBytes?: number;
  charge?: (group: string) => number;
};

/** Supplied counter decisions: a descendant's cap is not this worker's cap.
 * Only a completed producer report can account for a descendant-only event. */
export function workerMemoryCause(before:MemoryCounters,after:MemoryCounters,localBefore:number,localAfter:number,
  aggregateBefore:number,aggregateAfter:number,completed:boolean):MemoryCause|undefined {
  if(after.oom<before.oom||localAfter<localBefore)throw Error('resident cap: memory counters went backwards');
  const cause=memoryCause({...before,oom:localBefore},{...after,oom:localAfter},aggregateBefore,aggregateAfter);
  if(completed&&cause==='system-pressure'&&after.oom>before.oom)return undefined;
  return cause;
}

const sliceCharge = (group: string) => cgroupCharge(readFileSync(join("/sys/fs/cgroup", group, "memory.current"), "utf8"), readFileSync(join("/sys/fs/cgroup", group, "memory.stat"), "utf8"));

type Dispatch = { path: string; ordinal: number };
type Pressure = { dispatch?: Dispatch; cause: "aggregate-pressure" | "system-pressure"; kills: number };

async function round({ jobs, memory, workerBytes, command = process.execPath, args, onRow, report = () => {}, token, recycleAfterCases, recycleAboveBytes, charge = sliceCharge }: ResidentPoolOptions,
  work: Dispatch[], isolated: boolean, reservation: Reservation, accounting:{returnedOffers:number}, indexOffset = 0): Promise<Pressure[]> {
  const exclusive = isolated || Math.min(jobs, work.length) === 1;
  // Asked before each case, which takes far longer than the ledger's answer.
  const stop=new AbortController(),cohort=caseCohort(reservation,process.env,stop.signal,report);
  const queue = createFeed(work.map((_, index) => String(index)), {
    token: (entry, signal) => token(work[Number(entry)]!.path, signal), outranked: () => reservation.outranked(),pause:cohort.pause,resume:cohort.resume,
  });
  const pressure: Pressure[] = [];
  const tasks: Promise<void>[] = [];
  let idleRestarts = 0;
  const unregister=registerCommandCloser('resident case feed',{close:()=>{stop.abort();memory.close();},closed:async()=>{await Promise.allSettled(tasks);await memory.closed;}});
  const worker = async (index: number) => {
    let again = true;
    let returned=Promise.resolve();
    while (again) {
      await returned;
      const offered=await queue.reserve({signal:stop.signal,exited:()=>stop.signal.aborted,end:()=>{}});
      if(!offered)break;
      const leave=cohort.tryEnter();
      if(!leave){await offered.return();continue;}
      let bound:ReturnType<MemoryRun['worker']>|undefined;
      let childClosed:Promise<void>=Promise.resolve(),draining:Promise<void>|undefined,feedFlight:Promise<unknown>=Promise.resolve();
      const drain=()=>draining??=Promise.resolve().then(async()=>{
        const failures:unknown[]=[];
        try{await childClosed;}catch(error){failures.push(error);}
        try{await returned;}catch(error){failures.push(error);}
        let scopeDrained=true;
        if(bound){try{bound.close();await bound.closed;}catch(error){scopeDrained=false;failures.push(error);}}
        if(!offered.committed){try{await offered.return();}catch(error){scopeDrained=false;failures.push(error);}}
        if(scopeDrained)leave();
        if(failures.length)throw new AggregateError(failures,'resident worker generation failed to drain');
      });
      try{
      bound=memory.worker(index,workerBytes);
      const current=bound;
      again = await new Promise<boolean>((resolve, reject) => {
        // Include startup and waits between dispatches: an idle scope can be
        // collateral damage from the same aggregate or system-wide killer.
        let before: MemoryCounters = current.counters();
        let localBefore=memoryEvents(current.group,true).oom;
        let aggregateBefore = memory.aggregateOoms();
        const scope = current.scope(command, args(index + indexOffset));
        assignOwnedValues(scope.env,{...workerRoleValues({pool:'1',
          concurrency:exclusive?'exclusive':'parallel'}),NTS_GATE_TOKEN_HELD:'1'});
        const child = spawn("systemd-run", scope.argv, { stdio: ["pipe", "pipe", "inherit"], env: scope.env });
        const stopped = new AbortController();
        let exited = false;
        let restarting = false,priorityYield=false;
        let resolveClosed!:()=>void;childClosed=new Promise<void>(resolve=>{resolveClosed=resolve;});
        let completedCases = 0;
        let active: Dispatch | undefined;
        let release: (() => void) | undefined=offered.release;
        const returnToken = () => {
          const held = release;
          release = undefined;
          if(held){returned=releaseToken(held);void returned.catch(fail);}
        };
        const finish = (row?: any,lostReason?:string) => {
          if (!active) throw new Error(`worker ${index} answered without an in-flight case`);
          returnToken();
          const dispatch = active;
          const delivered=row!==undefined;
          // A later observation failure must not erase completed assertions.
          if(delivered)onRow({...row,residentPressureRetries:Number(isolated)});
          const dispatchedBefore = before;
          const after = current.counters();
          const aggregateAfter = memory.aggregateOoms();
          const localAfter=memoryEvents(current.group,true).oom;
          const cause=workerMemoryCause(before,after,localBefore,localAfter,aggregateBefore,aggregateAfter,delivered);
          localBefore=localAfter;
          active = undefined;
          before = after;
          aggregateBefore = aggregateAfter;
          if(delivered){
            if(cause==='own-limit')throw new ToolingInstrumentError('tooling-setup',`resident worker for ${dispatch.path} exceeded its own ${current.bytes} byte cap beside its completed report`);
            if(cause)throw new PressureError(`resident case ${dispatch.path} completed beside ${cause}; its enclosing memory observation holds the run`);
            return row.bucket==='timeout';
          }
          if (memoryDisposition(cause, exclusive ? "exclusive" : "parallel") === "budget") {
            onRow({ path: dispatch.path, bucket: "memory-cap", why: cause === "own-limit" ? "worker's own resident limit fired" : caseBudgetMessage(dispatch.path, memory.budgetBytes),
              residentWorkerBytes: current.bytes, residentRunBytes: memory.budgetBytes, residentPressureRetries: Number(isolated) });
            return true;
          }
          if (cause) {
            if (isolated) throw new PressureError(`resident instrument failure: isolated replay of ${dispatch.path} was killed by ${cause}, without an own-limit OOM`);
            pressure.push({ dispatch, cause: cause as Pressure["cause"], kills: after.kills - dispatchedBefore.kills });
            report(`resident pressure: requeued ${dispatch.path} after ${cause}; no verdict recorded`);
            return true;
          }
          throw new Error(`worker ${index} lost ${dispatch.path}; ${lostReason??'no completed report'}; no OOM kill recorded`);
        };
        const fail = (error: unknown) => {
          exited = true;
          stopped.abort();
          returnToken();
          try { current.stop(scope); } catch {}
          reject(error);
        };
        const dispatch=async(offer:FeedOffer)=>{
            const entry=offer.path,granted=offer.release;
            if (active !== undefined) {
              await releaseToken(granted);
              throw new Error(`worker ${index} already owns ${active.path}`);
            }
            // Owned before anything here can throw, so a failure returns it.
            release = granted;
            const group=readFileSync(scope.ready,'utf8').trim().replace(/^0::/,'');
            await registerCaseScope((granted as TokenRelease).case,current.group,current.bytes,group);
            if(exited||restarting){returnToken();await offer.return();return;}
            // An OOM counted in this worker's own slice since its idle
            // baseline: the case never runs there. Stop the scope, so its
            // close always arrives (an `oom` the kernel counted without
            // choosing a victim leaves the process alive), and return the
            // case. That close classifies the move against the kept
            // baseline: an idle pressure restart for a kill, an instrument
            // failure for its own limit. A fresh baseline here would erase
            // the kill and report the case lost. Another worker's
            // aggregate OOM leaves these counters unchanged.
            const idle = current.counters();
            if(idle.oom!==before.oom||idle.kills!==before.kills){current.stop(scope);returnToken();await offer.return();return;}
            before = idle;
            localBefore=memoryEvents(current.group,true).oom;
            aggregateBefore = memory.aggregateOoms();
            active = work[Number(entry)]!;
            child.stdin.write(`${active.path}\n`);
            offer.commit();
          };
        const feed = () => {
          feedFlight=returned.then(async()=>{
            const offer=await queue.reserve({
              end:()=>child.stdin.end(),exited:()=>exited||restarting,
              signal:AbortSignal.any([stopped.signal,stop.signal]),
              yield:async()=>{priorityYield=true;restarting=true;current.stop(scope);await drain();},
            });
            if(!offer)return;
            try{await dispatch(offer);}
            catch(error){
              if(!offer.committed){try{await offer.return();}catch(cleanup){throw new AggregateError([error,cleanup],'resident dispatch and offer return failed',{cause:error});}}
              throw error;
            }
          }).catch(fail);
          return feedFlight;
        };
        child.on("error", fail);
        child.stdin.on("error", (error) => { if (!exited && !restarting) fail(error); });
        createInterface({ input: child.stdout }).on("line", (line) => {
          try {
            const row = JSON.parse(line);
            if (row.path !== active?.path) throw new Error(`worker ${index} answered ${row.path}, expected ${active?.path}`);
            const answered = row.path;
            const failed = finish(row);
            const recycled = recycleAfterCases !== undefined && ++completedCases >= recycleAfterCases;
            const held = recycleAboveBytes === undefined || failed || recycled ? 0 : charge(current.group);
            const heavy = held > recycleAboveBytes!;
            const restart = failed || recycled || heavy;
            // Stop the entire scope before reuse, including any compiler child
            // left by a timed-out command. Only this worker is replaced.
            if (restart) {
              restarting = true;
              if(recycled&&!failed)report(`resident worker ${index}: recycling after ${completedCases} completed cases`);
              if(heavy)report(`resident worker ${index}: recycling after ${answered} left it holding ${Math.round(held/2**20)} MiB`);
              current.stop(scope);
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
            const entered = current.ready(scope);
            current.stop(scope);
            if(priorityYield){if(active!==undefined)throw Error('priority yield attempted to stop an active case');restarting=true;}
            else if (active !== undefined) {
              restarting = finish(undefined,`controller exited ${signal??code}`);
            } else if (!restarting) {
              const after = current.counters();
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
          finally { returnToken();resolveClosed(); }
        });
        const start = async () => {
          const deadline = Date.now() + 15_000;
          while (!current.ready(scope)) {
            if (exited) return; // close classifies startup pressure or setup failure.
            if (Date.now() >= deadline) throw new Error(`resident cap: worker ${index} scope did not become ready`);
            await new Promise((resume) => setTimeout(resume, 10));
          }
          await dispatch(offered);
        };
        void start().catch(fail);
      });
      await drain();await feedFlight;
      }catch(error){
        try{await drain();}catch(cleanup){throw new AggregateError([error,cleanup],'resident worker failed and did not drain',{cause:error});}
        throw error;
      }
    }
    await returned;
  };
  try {
    for (let index = 0; index < Math.min(jobs, work.length); index++) tasks.push(worker(index));
    await Promise.all(tasks);
    accounting.returnedOffers+=queue.returnedOffers;
    return pressure;
  } catch (error) {
    stop.abort();memory.close();
    await memory.closed;
    await Promise.allSettled(tasks);
    throw error;
  } finally {
    stop.abort();memory.close();
    await memory.closed;unregister();
  }
}


export type ResidentPoolSummary = {
  pressureRequeues: number; idlePressureRestarts: number; aggregatePressureKills: number; systemPressureKills: number; isolatedReplays: number;
  returnedOffers:number;
};

/** Each input has one final row. Parallel pressure is retried once, alone in
 * fresh cgroups after every parallel scope and its charges have been removed. */
export async function runMemoryWorkers(options: ResidentPoolOptions): Promise<ResidentPoolSummary> {
  if(options.recycleAfterCases!==undefined&&(!Number.isSafeInteger(options.recycleAfterCases)||options.recycleAfterCases<1)){
    options.memory.close();
    await options.memory.closed;
    throw new ToolingInstrumentError('tooling-setup','resident worker recycling requires a positive completed-case count');
  }
  if(options.recycleAboveBytes!==undefined&&(!Number.isSafeInteger(options.recycleAboveBytes)||options.recycleAboveBytes<1)){
    options.memory.close();
    await options.memory.closed;
    throw new ToolingInstrumentError('tooling-setup','resident worker recycling requires a positive byte bound');
  }
  if (typeof options.token !== "function") {
    options.memory.close();
    await options.memory.closed;
    throw new ToolingInstrumentError("tooling-setup", "resident workers require an explicit token policy");
  }
  const { paths, memory, report = () => {} } = options;
  let budgetBytes: number;
  try { budgetBytes = memory.effectiveBudgetBytes(); }
  catch (error) { memory.close();await memory.closed; throw error; }
  let reservation: Reservation;
  try {
    reservation = await reserveJob({ key: options.key ?? "resident-workers", units: Math.max(1, options.jobs), atMostBytes: budgetBytes,
      what: options.what ?? `resident workers for ${paths.length} case(s)` }, { report });
  }
  catch (error) { memory.close();await memory.closed; throw error; }
  try { return await rounds(options, budgetBytes, reservation); }
  // A reservation this pool made ends with it; one it ran inside is its job's.
  finally { if (!reservation.inherited) { reservation.release(); await reservation.closed; } }
}

async function rounds(options: ResidentPoolOptions, budgetBytes: number, reservation: Reservation): Promise<ResidentPoolSummary> {
  const { paths, jobs, report = () => {} } = options;
  const accounting={returnedOffers:0};
  const pressure = await round(options, paths.map((path, ordinal) => ({ path, ordinal })), false, reservation,accounting);
  const replays = pressure.filter((p): p is Pressure & { dispatch: Dispatch } => p.dispatch !== undefined);
  const summary: ResidentPoolSummary = {
    pressureRequeues: replays.length,
    idlePressureRestarts: pressure.length - replays.length,
    aggregatePressureKills: pressure.filter(p => p.cause === "aggregate-pressure").reduce((n, p) => n + p.kills, 0),
    systemPressureKills: pressure.filter(p => p.cause === "system-pressure").reduce((n, p) => n + p.kills, 0),
    isolatedReplays: 0,
    returnedOffers:0,
  };
  for (const { dispatch } of replays.sort((a, b) => a.dispatch.ordinal - b.dispatch.ordinal)) {
    const isolated = new MemoryRun({ budgetBytes });
    await round({ ...options, memory: isolated, jobs: 1 }, [dispatch], true, reservation,accounting, jobs + summary.isolatedReplays);
    summary.isolatedReplays++;
  }
  summary.returnedOffers=accounting.returnedOffers;
  report(`resident pressure requeues: ${summary.pressureRequeues}; idle restarts ${summary.idlePressureRestarts}; aggregate kills ${summary.aggregatePressureKills}; system-wide kills ${summary.systemPressureKills}; isolated replays ${summary.isolatedReplays}; returned offers ${summary.returnedOffers}`);
  if (paths.length > 0 && summary.pressureRequeues / paths.length > 0.05) report("resident pressure advisory: over 5% of cases needed isolated replay; review the aggregate reservation");
  return summary;
}
import {assignOwnedValues} from '../gate/environment-values.ts';
