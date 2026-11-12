// A worker service stops by message. Termination is only a named failed drain.
import type {Worker} from 'node:worker_threads';
import {ToolingInstrumentError} from './step-result.ts';

// Importing and scheduling a worker can take seconds on a loaded host. This is
// a wedged-service bound, never a command's execution or inactivity allowance.
export const WORKER_DRAIN_MS=60_000;
export type WorkerTransport=Pick<Worker,'on'|'postMessage'|'unref'|'terminate'>;
export type WorkerDrainClock={arm:(callback:()=>void,milliseconds:number)=>()=>void};
export function workerLifecycle(worker:WorkerTransport,label:string,report:(line:string)=>void,clock?:WorkerDrainClock){
  const timer:WorkerDrainClock=clock===undefined?{arm:(callback,milliseconds)=>{const timer=setTimeout(callback,milliseconds);return()=>clearTimeout(timer);}}:clock;
  if(!timer||typeof timer.arm!=='function')throw new TypeError('worker drain clock is incomplete');
  let stopping=false,exited=false,replied=false,cancel=()=>{},problem:Error|undefined;
  let resolve!:()=>void,reject!:(error:Error)=>void;
  const closed=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
  const fail=(why:string)=>{if(!problem){problem=new ToolingInstrumentError('tooling-setup',`${label} ${why}`);try{report(problem.message);}catch(error){problem=new ToolingInstrumentError('tooling-setup',`${problem.message}; reporting failed: ${String(error)}`,{cause:error});}}};
  // A caller may use only the synchronous release. Reporting still names a
  // failed service, while a lifecycle owner can await and observe the failure.
  void closed.catch(()=>{});
  worker.on('message',(message:unknown)=>{
    const row=message as {kind?:unknown;peak?:unknown}|null;
    if(row&&row.kind==='stopped'&&typeof row.peak==='number'&&Number.isSafeInteger(row.peak)&&row.peak>=0)replied=true;
    else fail('sent an invalid final reply');
  });
  worker.on('error',(error:Error)=>{fail(`failed: ${error.message}`);});
  worker.on('exit',(code:number)=>{
    exited=true;cancel();
    // The watched reservation can end by handover before its handle stops.
    // A final reply certifies that natural completion just as an explicit stop.
    if(!replied)fail(`exited without its final reply (status ${code})`);
    else if(code!==0)fail(`exited with status ${code}`);
    if(problem)reject(problem);else resolve();
  });
  worker.unref();
  return {closed,stop(){
    if(stopping||exited)return;stopping=true;
    cancel=timer.arm(()=>{
      if(exited)return;
      fail(`did not stop within ${WORKER_DRAIN_MS} ms; terminating the unresponsive worker`);
      void worker.terminate().catch(error=>fail(`termination failed: ${String(error)}`));
    },WORKER_DRAIN_MS);
    try{worker.postMessage({kind:'stop'});}catch(error){fail(`stop message failed: ${String(error)}`);}
  }};
}
