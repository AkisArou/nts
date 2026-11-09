// Finite, run-owned preparation. Native case workers still receive one case.
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {activeCommand,COMPILE_CPU_BOUND_SECONDS} from '../gate/active-command.ts';
import {reserveJob} from '../gate/memory-ledger.ts';
import {CaseBudgetError,PressureError,ToolingInstrumentError} from '../gate/step-result.ts';
import {memoryRun,memoryCause,memoryDisposition} from '../census/worker-memory.ts';
import type {OracleBudget} from './oracle-execution.ts';
import {OracleWorker,TypeScriptDiagnosticError,type OracleOptions,type OraclePrepared} from './oracle-emit.ts';

export type OracleRequest={key:string;options:OracleOptions};
// The measured case peak plus margin; the census aggregate remains authoritative.
export const ORACLE_COMPILE_MEMORY_BYTES=3*2**30;
let residentWorker=0;
export type OraclePreparation={prepared:OraclePrepared}|{instrument:string}|{timeout:string;budget?:OracleBudget}|{memoryCap:string;budget?:OracleBudget};
export class OracleCompileBudgetError extends CaseBudgetError{
  readonly outcome:'timeout'|'memory-cap';
  readonly budget:OracleBudget;
  constructor(outcome:OracleCompileBudgetError['outcome'],reason:string,budget?:OracleBudget){super(reason);this.budget=budget??{phase:'prepare',outcome,bound:outcome==='timeout'?COMPILE_CPU_BOUND_SECONDS:ORACLE_COMPILE_MEMORY_BYTES,signal:null,reason};this.outcome=outcome;this.name='OracleCompileBudgetError';}
}
/** Budget exhaustion describes the compiler's case, never a broken instrument. */
export function preparedOracle(member:OraclePreparation|undefined,context:string):OraclePrepared{
  if(member&&'prepared' in member)return member.prepared;
  if(member&&'timeout' in member)throw new OracleCompileBudgetError('timeout',context+': '+member.timeout,member.budget?{...member.budget,reason:context+': '+member.timeout}:undefined);
  if(member&&'memoryCap' in member)throw new OracleCompileBudgetError('memory-cap',context+': '+member.memoryCap,member.budget?{...member.budget,reason:context+': '+member.memoryCap}:undefined);
  throw new ToolingInstrumentError('tooling-setup',context+': '+(member&&'instrument' in member?member.instrument:'missing finite member'));
}
export async function prepareOracles(requests:OracleRequest[],options:{
  directory:string;toolchain:string;workers:number;env:NodeJS.ProcessEnv;memoryBytes?:number;
  report?:(message:string)=>void;signal?:AbortSignal;resolutionOwnerPid?:number;
}):Promise<Record<string,OraclePreparation>>{
  const {directory,report=()=>{}}=options;mkdirSync(directory,{recursive:true});
  if(!Number.isInteger(options.workers)||options.workers<1)throw Error('oracle worker count must be positive');
  if(new Set(requests.map(request=>request.key)).size!==requests.length)throw Error('oracle preparation keys must be unique');
  const outputRoots=[options.directory,...requests.map(request=>request.options.directory)];
  const result:Record<string,OraclePreparation>={};
  const bytes=options.memoryBytes??ORACLE_COMPILE_MEMORY_BYTES,workers=Math.min(options.workers,requests.length);let next=0;
  // The preparation's memory is its job's reservation: inside a gate step's,
  // or any other its environment names, it asks for nothing; alone, it
  // reserves its workers' resident allowances, which the census run caps
  // anyway, once in the machine's memory ledger. No compile waits on the
  // host's memory. An empty population reserves nothing and starts nothing.
  let reservation:Awaited<ReturnType<typeof reserveJob>>|null=null;
  if(workers>0){
    try{reservation=await reserveJob({bytes:Math.min(workers*bytes,memoryRun().budgetBytes),what:'oracle preparation of '+requests.length+' program(s)'},
      {env:options.env,signal:options.signal,report:options.report});}
    catch(error){if(options.signal?.aborted)throw Error('oracle preparation owner was canceled');throw error;}
  }
  try{
    const settled=await Promise.allSettled(Array.from({length:workers},async(_,index)=>{
      // The census owner supplies the aggregate cap and signal/exit drain too.
      const memory=memoryRun(),resident=memory.worker('oracle'+residentWorker++,bytes);
      let closeWorker=()=>{};
      try{
        const worker=new OracleWorker(join(directory,'worker-'+index),options.toolchain,outputRoots,options.resolutionOwnerPid);
        closeWorker=()=>worker.close();
        while(true){
          if(options.signal?.aborted)throw Error('oracle preparation owner was canceled');
          const request=requests[next];if(!request)break;
          const ordinal=next++,own=join(directory,'request-'+ordinal);mkdirSync(own,{recursive:true});
          const started=new Date().toISOString();let outcome,command=0;
          try{
            const [prepared]=await worker.prepareBatch([request.options],async(compiler,args,cwd)=>{
              if(options.signal?.aborted)throw Error('oracle preparation owner was canceled');
              const ownCommand=join(own,'project-'+command++);mkdirSync(ownCommand);
              // The SDK's Go compiler reserves virtual ranges. Only touched
              // memory counts, through the census's authenticated resident scope.
              const scope=resident.scope('prlimit',['--core=0',compiler,...args],options.env);
              const before=resident.counters(),aggregateBefore=memory.aggregateOoms();
              writeFileSync(join(ownCommand,'command.json'),JSON.stringify({command:'systemd-run',args:scope.argv,cwd,members:[request.key],identity:worker.identity,residentLimitBytes:resident.bytes},null,2)+'\n');
              const began=performance.now();let cpuTicks=0;
              let run;
              try{
                run=await activeCommand('systemd-run',scope.argv,{cwd,env:scope.env,
                  eachProcessCpuSeconds:COMPILE_CPU_BOUND_SECONDS,idleMs:120_000,maxBuffer:64*2**20,
                  onActivity:event=>{cpuTicks=event.cpu;}});
                if(!resident.ready(scope))throw new ToolingInstrumentError('tooling-setup','oracle compiler scope failed before bounded entry: '+run.stderr);
              }finally{resident.stop(scope);}
              const cause=memoryCause(before,resident.counters(),aggregateBefore,memory.aggregateOoms());
              const wallMs=performance.now()-began;
              writeFileSync(join(ownCommand,'stdout'),run.stdout);writeFileSync(join(ownCommand,'stderr'),run.stderr);
              writeFileSync(join(ownCommand,'run.json'),JSON.stringify({...run,wallMs,sampledCpuTicks:cpuTicks,memoryCause:cause,residentLimitBytes:resident.bytes,
                residentPeakBytes:Number(readFileSync('/sys/fs/cgroup'+resident.group+'/memory.peak','utf8'))},null,2)+'\n');
              report(`oracle project ${args[1]}: ${wallMs.toFixed(3)} ms; sampled process-group CPU ${cpuTicks} ticks; status ${run.status}`);
              const disposition=memoryDisposition(cause,options.workers===1?'exclusive':'parallel');
              if(disposition==='budget'&&resident.bytes<bytes)throw new PressureError('oracle compile not measured: aggregate reservation is smaller than the case resident allowance');
              if(disposition==='budget')throw new OracleCompileBudgetError('memory-cap',`oracle compile memory-cap: ${request.key} exceeded its ${resident.bytes} byte resident budget`,{phase:'prepare',outcome:'memory-cap',bound:resident.bytes,signal:run.signal,reason:`oracle compile memory-cap: ${request.key} exceeded its ${resident.bytes} byte resident budget`});
              if(disposition==='pressure')throw new PressureError('oracle compile not measured: resident '+cause);
              if(run.timeout)throw new OracleCompileBudgetError('timeout','oracle compile timed out: '+run.timeout,{phase:'prepare',outcome:'timeout',bound:COMPILE_CPU_BOUND_SECONDS,signal:run.signal,reason:'oracle compile timed out: '+run.timeout});
              if(run.hung||run.runaway||run.error||run.signal)throw new ToolingInstrumentError('tooling-setup','oracle request not measured: '+(run.hung??run.runaway??run.error??run.signal));
              return run;
            },options.signal);
            if(!prepared)throw Error('oracle request did not publish its prepared member');
            const record=join(dirname(prepared.manifest),'application-capture.json');
            if(existsSync(record))report('oracle application capture: '+JSON.stringify({member:request.key,...JSON.parse(readFileSync(record,'utf8'))}));
            result[request.key]={prepared};outcome={status:'complete',members:[request.key]};
          }catch(error){
            outcome={status:error instanceof OracleCompileBudgetError?error.outcome:'instrument',members:[request.key],reason:String(error),
              ...(error instanceof TypeScriptDiagnosticError?{compilerStatus:error.status,diagnostics:error.diagnostics}: {})};
            if(options.signal?.aborted||error instanceof PressureError)throw error;
            result[request.key]=error instanceof OracleCompileBudgetError
              ?error.outcome==='timeout'?{timeout:error.message,budget:error.budget}:{memoryCap:error.message,budget:error.budget}
              :{instrument:String(error)};
          }finally{
            writeFileSync(join(own,'finished.json'),JSON.stringify({...outcome,started,finished:new Date().toISOString()},null,2)+'\n');
          }
        }
      }finally{try{closeWorker();}finally{resident.close();}}
    }));
    const failed=settled.find(outcome=>outcome.status==='rejected');
    if(failed?.status==='rejected')throw failed.reason instanceof ToolingInstrumentError||failed.reason instanceof PressureError||options.signal?.aborted?failed.reason
      :new ToolingInstrumentError('tooling-setup','oracle worker was not measured: '+String(failed.reason),{cause:failed.reason});
    writeFileSync(join(directory,'members.json'),JSON.stringify(result,null,2)+'\n');return result;
  // A reservation this preparation made ends with it; one it ran inside is its job's.
  }finally{if(reservation&&!reservation.inherited)reservation.release();}
}
