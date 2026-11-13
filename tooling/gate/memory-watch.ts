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
//       node tooling/gate/memory-watch.ts <ledger> <reservation> <history> <key> <job|worker> <workers> <scope>
//
//     It does not count itself, and once the reservation has ended (released,
//     dropped, or its owner gone) it adds the most it saw, per worker, to the
//     scheduling history under the job's key (step-scheduling.ts) and exits.
import { setTimeout as pause } from "node:timers/promises";
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { admittedEntry, entryUsage, noteOver, noteSampledPeak, WATCH_MS } from "./memory-ledger.ts";
import {HostObservationError} from "./host-observations.ts";
import { KEY, writeCostHistory } from "./step-scheduling.ts";
import {enterWatcherFlush} from "./memory-watch-scope.ts";
import {ToolingInstrumentError} from "./step-result.ts";
import {registerCommandCloser,runAsCommand} from '../differential/command-entry/main.ts';

/**
 * Samples reservation `id` in `ledger` until it ends, and returns the most it
 * held; `seen` is told each new most. `exclude` is a process in the measure
 * that is not the job's.
 */
export async function watchReservation(ledger: string, id: string, key: string, options: { exclude?: number; seen?: (bytes: number) => void; signal?: AbortSignal; env?:NodeJS.ProcessEnv } = {}): Promise<number> {
  let peak = 0, over = false;
  for (;;) {
    const entry = admittedEntry(ledger, id);
    if (entry === null) return peak;
    try {
      const held = entryUsage(entry, { exclude: options.exclude,env:options.env });
      if (held > peak) {
        peak = held; options.seen?.(peak);
        if (entry.liveUse) await noteSampledPeak(ledger, id, peak);
      }
    } catch(error) { if(error instanceof HostObservationError)throw error; /* one sample missed: a process or cgroup went as it was read */ }
    if (!entry.liveUse && !over && peak > entry.bytes) {
      over = true;
      try { await noteOver(ledger, id, key); } catch { /* the entry says less; the history still learns the peak */ }
    }
    try { await pause(WATCH_MS, undefined, { signal: options.signal }); }
    catch (error) { if (options.signal?.aborted) return peak; throw error; }
  }
}

// Register the service before accepting work. A stop queued during module
// loading is handled normally, after the synchronous module graph evaluates.
function startThread():void {
  const port=parentPort;
  if(!port)throw new Error('memory sampler has no parent port');
  const {ledger,id,key,peak,observations}=workerData as {ledger:string;id:string;key:string;peak:SharedArrayBuffer;observations:NodeJS.ProcessEnv};
  const cell=new BigInt64Array(peak),ending=new AbortController();
  let started=false;
  port.on('message',(message:{kind:string})=>{
    if(message.kind==='stop')ending.abort();
    else if(message.kind==='start'){
      if(started)throw new Error('memory sampler started twice');started=true;
      void watchReservation(ledger,id,key,{env:observations,signal:ending.signal,seen:bytes=>Atomics.store(cell,0,BigInt(bytes))}).then(most=>{
        port.postMessage({kind:'stopped',peak:most});port.close();
      },error=>{port.close();throw error;});
    }else throw new Error('memory sampler received an unknown message');
  });
}
async function main():Promise<void> {
  const [ledger,id,history,key,basis,workers,scope]=process.argv.slice(2),units=Number(workers);
  if(!ledger||!id||!history||!scope||!key||!KEY.test(key)||(basis!=="job"&&basis!=="worker")||!Number.isSafeInteger(units)||units<1||(basis==="job"&&units!==1))
    throw new Error('usage: node tooling/gate/memory-watch.ts <ledger> <reservation> <history> <key> <job|worker> <workers> <scope>');
  const ending=new AbortController();
  const watch=watchReservation(ledger,id,key,{exclude:process.pid,signal:ending.signal});
  const unregister=registerCommandCloser('memory watcher '+key,{cancel:()=>ending.abort(),close:()=>ending.abort(),closed:async()=>{await watch;}});
  try{
  const most=await watch;
  if(most>0)try{
    enterWatcherFlush(scope,process.env);
    const warning=writeCostHistory(history,{jobs:[{key,peak:most,basis,width:units}]});
    if(warning)throw Error(warning);
  }catch(error){throw new ToolingInstrumentError('tooling-setup',`memory: ${key}'s peak is not in its history: ${String(error)}`,{cause:error});}
  }finally{unregister();}
}
if(!isMainThread)startThread();
else runAsCommand(import.meta.url,async()=>{try{await main();return undefined;}catch(error){console.error(String(error));return 2;}});
