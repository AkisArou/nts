// One pause/resume obligation for the live cases of a pooled job.
import {yieldJobMemory,type Reservation} from './memory-ledger.ts';

export function caseCohort(reservation:Reservation,env:NodeJS.ProcessEnv,signal:AbortSignal,report:(line:string)=>void=()=>{}){
 const live=new Set<object>();
 let quiet:(()=>void)|undefined;
 let pause:Promise<void>|undefined,resume:Promise<void>|undefined;
 let obligation:Awaited<ReturnType<typeof yieldJobMemory>>|undefined;
 const enter=()=>{
   if(pause)return null;
   const owner={};live.add(owner);let done=false;
   return ()=>{if(done)return;done=true;live.delete(owner);if(!live.size)quiet?.();};
 };
 return {
  tryEnter:enter,
  /** The case owns its generation until the token and any scope have drained. */
  enter():()=>void{
   const leave=enter();if(!leave)throw Error('case cohort started work before its priority resume');return leave;
  },
  pause():Promise<void>{
   return pause??=Promise.resolve().then(async()=>{
    if(live.size){
      let cancel:()=>void=()=>{};
      try{await new Promise<void>((resolve,reject)=>{quiet=resolve;cancel=()=>reject(signal.reason);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});}
      finally{signal.removeEventListener('abort',cancel);quiet=undefined;}
    }
    signal.throwIfAborted();
    obligation=await yieldJobMemory(reservation,env,signal);
    report('case cohort yielded: idle workers drained; '+obligation.returned+' reservation bytes returned');
   });
  },
  resume():Promise<void>{
   return resume??=Promise.resolve().then(async()=>{
    if(!pause)return;
    await pause;await obligation!.resume();
    report('case cohort resumed after ordinary memory admission');
    pause=undefined;resume=undefined;obligation=undefined;
   });
  },
 };
}
