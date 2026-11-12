// Legacy stream-based readers retain their child_process contract while the
// case lease owns their worker scope. New supervised commands use activeCommand.
import {spawn,type SpawnOptions} from 'node:child_process';
import {caseReceipt} from './case-context.ts';
import {commandWorker} from '../census/worker-memory.ts';
import {PressureError,ToolingInstrumentError,publishPressure,publishToolingFailure} from './step-result.ts';

function scoped(command:string,args:readonly string[]|SpawnOptions=[],options?:SpawnOptions){
  const argv=Array.isArray(args)?args as string[]:[];
  const supplied=(Array.isArray(args)?options:args) as SpawnOptions|undefined;
  const worker=caseReceipt(supplied?.env)?commandWorker(command,argv,supplied?.env):undefined;
  const child=spawn(worker?'systemd-run':command,worker?.scope.argv??argv,{...supplied,env:worker?.scope.env??supplied?.env});
  if(worker)child.once('close',(status,signal)=>{
    let problem:unknown;
    try{
      const pressure=worker.observation({status,signal});
      if(pressure)throw new PressureError(`case memory: ${command} was killed by ${pressure.cause} under its ${pressure.limitBytes} byte case cap`);
    }catch(error){problem=error;}
    // Cleanup belongs inside the instrument path too; a finally throw used
    // to escape it and turn the retirement failure into a product FAIL.
    try{worker.close();}catch(error){problem??=error;}
    if(problem){
      const error=problem;
      const failure=error instanceof ToolingInstrumentError||error instanceof PressureError?error:new ToolingInstrumentError('tooling-setup',String(error));
      if(failure instanceof PressureError)publishPressure(failure,supplied?.env);else publishToolingFailure(failure,supplied?.env);
      child.emit('error',failure);
    }
  });
  return child;
}
// Every stdio option is forwarded unchanged, preserving spawn's overloads.
export const scopedSpawn=scoped as typeof spawn;
