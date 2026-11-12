// A synchronous infrastructure question has no case outcome. Its command may
// answer normally, or the instrument fails by purpose before any fallback.
import {spawnSync,type SpawnSyncOptionsWithStringEncoding,type SpawnSyncReturns} from 'node:child_process';
import {publishToolingFailure,ToolingInstrumentError} from './step-result.ts';

// A loaded machine has delayed healthy Node/systemd/git startups beyond the
// former 5–15 second limits. Five minutes is a wedged-tool guard, not a speed
// requirement; exhausting it holds the instrument and never judges a change.
export const INFRASTRUCTURE_PROBE_BOUND_MS=5*60_000;
export type ProbeRequest={
  purpose:string;command:string;args:readonly string[];
  cwd?:string;env?:NodeJS.ProcessEnv;input?:string|Buffer;maxBuffer?:number;
  /** Source/lexer checks classify ordinary exits themselves. Signals and
   * launch failures are always instrument failures, even on this route. */
  exits?:readonly number[]|'classify';
};
export type ProbeResult=SpawnSyncReturns<string>;
export type ProbeRunner=(command:string,args:readonly string[],options:SpawnSyncOptionsWithStringEncoding)=>ProbeResult;
export type InfrastructureProbe=(request:ProbeRequest)=>ProbeResult;

/** Injection replaces the entire runner; no fixture falls back to a process. */
export function infrastructureProbes(runner:ProbeRunner=spawnSync):InfrastructureProbe{
  return request=>{
    const failure=(why:string,cause?:unknown):never=>{
      const error=new ToolingInstrumentError('tooling-setup',`infrastructure probe ${request.purpose} (${request.command} ${request.args.join(' ')}): ${why}`,{cause});
      publishToolingFailure(error,request.env);throw error;
    };
    let result:ProbeResult;
    try{result=runner(request.command,request.args,{cwd:request.cwd,env:request.env,input:request.input,
      encoding:'utf8',timeout:INFRASTRUCTURE_PROBE_BOUND_MS,killSignal:'SIGKILL',maxBuffer:request.maxBuffer??16*1024*1024});}
    catch(error){return failure(`could not start: ${error instanceof Error?error.message:String(error)}`,error);}
    if(result.error){
      if((result.error as NodeJS.ErrnoException).code==='ETIMEDOUT')return failure(`did not answer within the ${INFRASTRUCTURE_PROBE_BOUND_MS} ms wedged-probe bound`,result.error);
      return failure(`could not run: ${result.error.message}`,result.error);
    }
    if(result.signal)return failure(`stopped by ${result.signal}`);
    if(result.status===null)return failure('ended without an exit status');
    if(request.exits!=='classify'&&!(request.exits??[0]).includes(result.status))return failure(`exited ${result.status}: ${(result.stderr??'').trim()}`);
    return result;
  };
}
export const infrastructureProbe=infrastructureProbes();
