// Shell pools use the same lease and resident worker as JavaScript pools.
// The controller stays outside the worker's hard cap to report a kill.
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {withToken} from './tokens.mjs';
import {MemoryRun,memoryCause,workerCapBytes} from '../census/worker-memory.ts';
import {PressureError,CaseBudgetError,ToolingInstrumentError,publishPressure,publishToolingFailure} from './step-result.ts';

export async function tokenCommand(argv:readonly string[]):Promise<{status:number|null;signal:NodeJS.Signals|null}>{
  const args=[...argv];
  if(args.shift()!=='--case')throw Error('token-command.ts requires --case <path>');
  const project=args.shift();if(!project)throw Error('token-command.ts requires a stable case path');
  let backend='';if(args[0]==='--backend'){args.shift();backend=args.shift()??'';}
  if(args.shift()!=='--')throw Error('token-command.ts requires -- before its command');
  const command=args.shift();if(!command)throw Error('token-command.ts requires a command');
  return withToken(async()=>{
    const memory=new MemoryRun({budgetBytes:workerCapBytes()}),worker=memory.worker('shell',memory.budgetBytes);
    const before=worker.counters(),aggregate=memory.aggregateOoms(),scope=worker.scope(command,args);
    try{
      const result=await new Promise<{status:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{
        const child=spawn('systemd-run',scope.argv,{env:scope.env,stdio:'inherit'});
        child.once('error',reject);child.once('close',(status,signal)=>resolve({status,signal}));
      });
      if(!worker.ready(scope))throw Error('case memory: shell worker failed before bounded entry');
      const cause=memoryCause(before,worker.counters(),aggregate,memory.aggregateOoms());
      if(cause){
        const message=`case memory: ${project} was killed by ${cause} under its ${worker.bytes} byte case cap`;
        throw cause==='own-limit'?new CaseBudgetError(message):new PressureError(message);
      }
      return result;
    }finally{memory.close();}
  },{project,backend});
}

async function main():Promise<void>{
  try{
    const result=await tokenCommand(process.argv.slice(2));
    if(result.signal)process.kill(process.pid,result.signal);else process.exitCode=result.status??1;
  }catch(error){
    if(error instanceof PressureError||error instanceof CaseBudgetError){publishPressure(error);console.error(error.message);process.exitCode=124;return;}
    const failure=error instanceof ToolingInstrumentError?error:new ToolingInstrumentError('tooling-setup',String(error));
    publishToolingFailure(failure);console.error(failure.message);process.exitCode=124;
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)void main();
