// A worker service stops by message. Termination is only a named failed drain.
import type {Worker} from 'node:worker_threads';
import {ToolingInstrumentError} from './step-result.ts';
import {hostObservations} from './host-observations.ts';

// Importing and scheduling a worker can take seconds on a loaded host. This is
// a wedged-service bound, never a command's execution or inactivity allowance.
export const WORKER_DRAIN_MS=60_000;
export type WorkerTransport=Pick<Worker,'on'|'postMessage'|'unref'|'terminate'>;
export type WorkerDrainClock={arm:(callback:()=>void,milliseconds:number)=>()=>void;wallNow:()=>number};
export function workerDrainClock(env:NodeJS.ProcessEnv):WorkerDrainClock{
  const host=hostObservations(env);
  return {wallNow:()=>host.wallNow(),arm:(callback,milliseconds)=>{const timer=setTimeout(callback,milliseconds);return()=>clearTimeout(timer);}};
}
export function newWorkerTerminal():BigInt64Array{
  const cell=new BigInt64Array(new SharedArrayBuffer(8));Atomics.store(cell,0,-1n);return cell;
}
/** The worker writes its own exit-hook wall time without a parent event-loop
 * turn. This is a terminal hook, not the kernel's exact thread-death time. */
export function recordWorkerTerminal(cell:BigInt64Array,wallNow:()=>number):void{
  if(cell.length!==1||!(cell.buffer instanceof SharedArrayBuffer))throw new TypeError('worker terminal cell is incomplete');
  process.once('exit',()=>{
    const at=wallNow();if(!Number.isSafeInteger(at)||at<0)throw new TypeError('worker terminal clock is invalid');
    Atomics.store(cell,0,BigInt(at));
  });
}
export function workerLifecycle(worker:WorkerTransport,label:string,report:(line:string)=>void,clock:WorkerDrainClock,terminal?:BigInt64Array){
  const timer=clock;
  if(!timer||typeof timer.arm!=='function'||typeof timer.wallNow!=='function')throw new TypeError('worker drain clock is incomplete');
  let stopping=false,exited=false,replied=false,cancel=()=>{},problem:Error|undefined;
  let resolve!:()=>void,reject!:(error:Error)=>void;
  const closed=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
  const fail=(why:string)=>{if(!problem){problem=new ToolingInstrumentError('tooling-setup',`${label} ${why}`);try{report(problem.message);}catch(error){problem=new ToolingInstrumentError('tooling-setup',`${problem.message}; reporting failed: ${String(error)}`,{cause:error});}}};
  let stopRequestedAt:number|null=null,replyObservedAt:number|null=null,exitObservedAt:number|null=null;
  const now=()=>{try{const at=timer.wallNow();if(!Number.isSafeInteger(at)||at<0)throw Error('invalid wall timestamp');return at;}catch(error){fail('drain clock failed: '+String(error));return null;}};
  const diagnostic=(stage:'guard'|'exit',code:number|null)=>{
    const value=terminal?Atomics.load(terminal,0):-1n;
    try{report('worker drain: '+JSON.stringify({version:1,label,stage,stopRequestedAt,replyObservedAt,workerTerminalHookAt:value<0n?null:Number(value),exitObservedAt,code,problem:problem?.message??null}));}
    catch(error){fail('drain diagnostics failed: '+String(error));}
  };
  // A caller may use only the synchronous release. Reporting still names a
  // failed service, while a lifecycle owner can await and observe the failure.
  void closed.catch(()=>{});
  worker.on('message',(message:unknown)=>{
    const row=message as {kind?:unknown;peak?:unknown}|null;
    if(row&&row.kind==='stopped'&&typeof row.peak==='number'&&Number.isSafeInteger(row.peak)&&row.peak>=0){replied=true;replyObservedAt=now();}
    else fail('sent an invalid final reply');
  });
  worker.on('error',(error:Error)=>{fail(`failed: ${error.message}`);});
  worker.on('exit',(code:number)=>{
    exited=true;cancel();exitObservedAt=now();
    // The watched reservation can end by handover before its handle stops.
    // A final reply certifies that natural completion just as an explicit stop.
    if(!replied)fail(`exited without its final reply (status ${code})`);
    else if(code!==0)fail(`exited with status ${code}`);
    diagnostic('exit',code);
    if(problem)reject(problem);else resolve();
  });
  worker.unref();
  return {closed,stop(){
    if(stopping||exited)return;stopping=true;stopRequestedAt=now();
    cancel=timer.arm(()=>{
      if(exited)return;
      fail(`did not stop within ${WORKER_DRAIN_MS} ms; terminating the unresponsive worker`);
      diagnostic('guard',null);
      void worker.terminate().catch(error=>fail(`termination failed: ${String(error)}`));
    },WORKER_DRAIN_MS);
    try{worker.postMessage({kind:'stop'});}catch(error){fail(`stop message failed: ${String(error)}`);}
  }};
}
