// Finite, run-owned preparation. Native case workers still receive one case.
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {activeCommand} from '../gate/active-command.ts';
import {Admission} from '../gate/admission.ts';
import {OracleWorker,TypeScriptDiagnosticError,type OracleOptions,type OraclePrepared} from './oracle-emit.ts';

export type OracleRequest={key:string;options:OracleOptions};
export type OraclePreparation={prepared:OraclePrepared}|{instrument:string};
export async function prepareOracles(requests:OracleRequest[],options:{
  directory:string;toolchain:string;workers:number;env:NodeJS.ProcessEnv;memoryBytes?:number;
  report?:(message:string)=>void;signal?:AbortSignal;
}):Promise<Record<string,OraclePreparation>>{
  const {directory,report=()=>{}}=options;mkdirSync(directory,{recursive:true});
  if(!Number.isInteger(options.workers)||options.workers<1)throw Error('oracle worker count must be positive');
  if(new Set(requests.map(request=>request.key)).size!==requests.length)throw Error('oracle preparation keys must be unique');
  const outputRoots=[options.directory,...requests.map(request=>request.options.directory)];
  const result:Record<string,OraclePreparation>={};
  const admission=new Admission({report});let next=0;
  const settled=await Promise.allSettled(Array.from({length:Math.min(options.workers,requests.length)},async(_,index)=>{
    // No toolchain is verified or started for an empty population.
    while(!admission.open()){if(options.signal?.aborted)throw Error('oracle preparation owner was canceled');await new Promise(resolve=>setTimeout(resolve,1000));}
    const worker=new OracleWorker(join(directory,'worker-'+index),options.toolchain,outputRoots);
    try{
      while(true){
        if(options.signal?.aborted)throw Error('oracle preparation owner was canceled');
        while(!admission.open()){if(options.signal?.aborted)throw Error('oracle preparation owner was canceled');await new Promise(resolve=>setTimeout(resolve,1000));}
        // Claim only after admission: another worker may drain the queue while we wait.
        const request=requests[next];if(!request)break;
        const ordinal=next++,own=join(directory,'request-'+ordinal);mkdirSync(own,{recursive:true});
        const started=new Date().toISOString();let outcome,command=0;
        try{
          const [prepared]=await worker.prepareBatch([request.options],async(compiler,args,cwd)=>{
            if(options.signal?.aborted)throw Error('oracle preparation owner was canceled');
            const ownCommand=join(own,'project-'+command++);mkdirSync(ownCommand);
            const actual=['--as='+String(options.memoryBytes??2*2**30),'--core=0',compiler,...args];
            writeFileSync(join(ownCommand,'command.json'),JSON.stringify({command:'prlimit',args:actual,cwd,members:[request.key],identity:worker.identity},null,2)+'\n');
            const began=performance.now();let cpuTicks=0;
            const run=await activeCommand('prlimit',actual,{cwd,env:options.env,
              cpuBudgetSeconds:15,idleMs:120_000,maxBuffer:64*2**20,
              onActivity:event=>{cpuTicks=event.cpu;}});
            const wallMs=performance.now()-began;
            writeFileSync(join(ownCommand,'stdout'),run.stdout);writeFileSync(join(ownCommand,'stderr'),run.stderr);
            writeFileSync(join(ownCommand,'run.json'),JSON.stringify({...run,wallMs,sampledCpuTicks:cpuTicks},null,2)+'\n');
            report(`oracle project ${args[1]}: ${wallMs.toFixed(3)} ms; sampled process-group CPU ${cpuTicks} ticks; status ${run.status}`);
            if(run.signal||run.error||run.hung||run.runaway)throw Error('oracle request not measured: '+(run.signal??run.hung??run.runaway??run.error));
            return run;
          },options.signal);
          if(!prepared)throw Error('oracle request did not publish its prepared member');
          const record=join(dirname(prepared.manifest),'application-capture.json');
          if(existsSync(record))report('oracle application capture: '+JSON.stringify({member:request.key,...JSON.parse(readFileSync(record,'utf8'))}));
          result[request.key]={prepared};outcome={status:'complete',members:[request.key]};
        }catch(error){
          outcome={status:'instrument',members:[request.key],reason:String(error),
            ...(error instanceof TypeScriptDiagnosticError?{compilerStatus:error.status,diagnostics:error.diagnostics}: {})};
          if(options.signal?.aborted)throw error;
          result[request.key]={instrument:String(error)};
        }finally{
          writeFileSync(join(own,'finished.json'),JSON.stringify({...outcome,started,finished:new Date().toISOString()},null,2)+'\n');
        }
      }
    }finally{worker.close();}
  }));
  const failed=settled.find(outcome=>outcome.status==='rejected');
  if(failed?.status==='rejected')throw failed.reason;
  writeFileSync(join(directory,'members.json'),JSON.stringify(result,null,2)+'\n');return result;
}
