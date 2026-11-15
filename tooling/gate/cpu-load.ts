import {Worker} from 'node:worker_threads';
import {ToolingInstrumentError} from './step-result.ts';

const SOURCE=new URL('./cpu-load-worker.ts',import.meta.url);
type Request={shared:SharedArrayBuffer;index:number};
export type CpuLoad={failed:Promise<never>;progress():number[];close():Promise<void>};

/** Ready means every worker completed work. No elapsed window starts or
 * decides the experiment. Unexpected departure refuses the observation. */
export async function startCpuLoad(count:number,create:(request:Request)=>Worker=request=>new Worker(SOURCE,{workerData:request})):Promise<CpuLoad>{
  if(!Number.isSafeInteger(count)||count<1)throw new ToolingInstrumentError('tooling-setup','CPU load needs a positive worker count');
  const shared=new SharedArrayBuffer((count+1)*Uint32Array.BYTES_PER_ELEMENT),state=new Uint32Array(shared);
  const exits:Promise<void>[]=[],ready:Promise<void>[]=[],errors:unknown[]=[];
  let stopping=false,closed:Promise<void>|undefined,refuse!:(error:unknown)=>void;
  const failed=new Promise<never>((_,reject)=>{refuse=reject;});
  // The owner subscribes after readiness; retain an early failure without an
  // unhandled rejection racing that handoff.
  void failed.catch(()=>{});
  const broken=(error:unknown)=>refuse(new ToolingInstrumentError('tooling-setup','CPU load worker failed: '+String(error),{cause:error}));
  const close=():Promise<void>=>{
    if(closed)return closed;
    stopping=true;Atomics.store(state,0,1);
    closed=Promise.allSettled(exits).then(()=>{
      if(errors.length)throw new ToolingInstrumentError('tooling-cleanup','CPU load worker drain failed: '+errors.map(String).join('; '),{cause:new AggregateError(errors)});
    });
    return closed;
  };
  try{
    for(let index=1;index<=count;index++){
      const worker=create({shared,index});
      ready.push(new Promise(resolve=>worker.once('message',message=>{
        if(message?.ready!==index){broken('invalid readiness from worker '+index);return;}
        resolve();
      })));
      worker.on('error',error=>{errors.push(error);broken(error);});
      exits.push(new Promise(resolve=>worker.once('exit',code=>{
        if(code!==0){const error=Error('CPU load worker '+index+' exited '+code);errors.push(error);broken(error);}
        else if(!stopping)broken('CPU load worker '+index+' departed before stop');
        resolve();
      })));
    }
    await Promise.race([Promise.all(ready),failed]);
    return {failed,progress:()=>Array.from(state.slice(1)),close};
  }catch(primary){
    try{await close();}catch(cleanup){throw new ToolingInstrumentError('tooling-cleanup',String(primary)+'; '+String(cleanup),{cause:new AggregateError([primary,cleanup])});}
    throw primary;
  }
}
