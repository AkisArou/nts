// Manual activity/clock input for a command bridge; no timer or kernel sample.
import {ToolingInstrumentError} from './step-result.ts';
import {CommandLiveness,type CommandPolicy,type CommandSample} from './command-liveness.ts';
import type {ActiveResult,ActivityWatch,CommandObservations} from './active-process.ts';
export function commandObservationFixture(initialCpu=0,frequency=100){
  let entered=true;
  let now=0,group:number|undefined,watch:ActivityWatch|undefined;
  const attached=Promise.withResolvers<void>();
  const observations:CommandObservations={now:()=>now,frequency,initialCpu:()=>initialCpu,entryReady:()=>entered,
    watch:value=>{if(watch)throw Error('fixture already observes a command');watch=value;group=value.group;attached.resolve();return()=>{watch=undefined;};}};
  return {observations,attached:attached.promise,group:()=>group,
    clock(value:number){now=value;},
    entry(value:boolean){entered=value;},
    sample(value:number,{cpu=initialCpu,own=0,busy=false,processCpu=0,pid=watch?.group??51}={}){
      if(!watch)throw Error('fixture has no active command observer');now=value;
      watch.sample(cpu,own,busy,{pid,cpu:processCpu});
    },
    broken(error:unknown){if(!watch)throw Error('fixture has no active command observer');watch.broken(error);},
  };
}

/** Consumer tests replay the same pure policy without starting a command. */
export function scriptedCommand(command:string,policy:CommandPolicy,samples:readonly CommandSample[],output:Partial<ActiveResult>={}):ActiveResult{
  const model=new CommandLiveness(command,policy,0,100);
  let decision;
  for(const sample of samples){decision=model.sample(sample);if(decision)break;}
  if(decision?.kind==='startup')throw new ToolingInstrumentError('tooling-setup',decision.reason);
  const stdout=output.stdout??'',stderr=output.stderr??'';
  return {status:decision?null:0,signal:decision?'SIGKILL':null,stdout,stderr,out:stdout+stderr,elapsedMs:samples.at(-1)?.now??0,
    ...output,...(decision?{[decision.kind]:decision.reason}:{})};
}
export const commandSample=(now:number,values:Partial<Omit<CommandSample,'now'>>={}):CommandSample=>({now,entered:true,cpu:values.own??0,own:0,busy:false,processOwn:{pid:51,cpu:values.own??0},...values});
