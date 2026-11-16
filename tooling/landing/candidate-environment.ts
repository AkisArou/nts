import {registerCommandCloser,runAsCommand} from "../differential/command-entry/main.ts";
// Cross-version contract: the candidate's tooling/gate/canonical-environment.ts
// exports gateEnvironment. No other version creates its environment or grants.
// Keep this process alive while the command runs: it owns resolutionOwner.
import {spawn,spawnSync,type StdioOptions} from "node:child_process";
import {readFileSync,writeFileSync} from "node:fs";
import {isAbsolute,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {finishRunTemporary} from '../gate/run-temporary.ts';
import {ownedProcessGroup} from '../gate/process-group.ts';

export type CandidateCommand = {tree:string;run:string;owned:Record<string,string>;command:readonly string[];standalone?:boolean;discardTemporary?:boolean};
type LaunchRequest=CandidateCommand&{treeLock?:boolean;node?:string};
class CandidateEnvironmentContractError extends Error {}
type CandidateOptions={output?:number;treeLock?:number;supervisor?:readonly [string,...string[]]};
type AsyncCandidateOptions=CandidateOptions&{signal?:AbortSignal;cancelled?:()=>void};
export type CandidateResult={status:number|null;signal:NodeJS.Signals|null;stdout:string|null;stderr:string|null;error?:Error;cancelled?:boolean;
  /** Retained after cancellation until the directly acquired group is empty. */
  certifyDrain?:()=>void};
const MAX_OUTPUT=1<<30;

function candidateLaunch(node:string,request:CandidateCommand,env:NodeJS.ProcessEnv,options:CandidateOptions){
  const output=options.output??'pipe',stdio:StdioOptions=['pipe',output,output,'pipe'];
  if(options.treeLock!==undefined)stdio.push('ignore','ignore','ignore','ignore',options.treeLock);
  const [program,...args]=[...(options.supervisor??[]),node,fileURLToPath(import.meta.url)];
  return {program:program!,args,options:{
    cwd:request.tree,env:options.treeLock!==undefined?{...env,NTS_GATE_LOCK_FD:'8'}:env,
    stdio,
  },input:JSON.stringify({...request,node,treeLock:options.treeLock!==undefined})};
}
function candidateReceipt<T extends {signal:NodeJS.Signals|null;error?:Error;output:readonly (string|null)[]}>(result:T):T{
  // Keep a killed/not-started command distinct from its ordinary nonzero exit.
  if(result.output?.[3]){
    const receipt:{signal:NodeJS.Signals|null;error:{message:string;code?:string}|null}=JSON.parse(result.output[3]);
    result.signal=receipt.signal;
    if(receipt.error)result.error=Object.assign(new Error(receipt.error.message),{code:receipt.error.code});
  }
  return result;
}

/** The caller supplies the already verified candidate Node, never PATH's node.
 * Synchronous full-check transaction contracts use this form. */
export function candidateCommand(node:string,request:CandidateCommand,env:NodeJS.ProcessEnv,options:CandidateOptions={}){
  const launch=candidateLaunch(node,request,env,options);
  return candidateReceipt(spawnSync(launch.program,launch.args,{...launch.options,input:launch.input,encoding:'utf8',maxBuffer:MAX_OUTPUT}));
}

/** An owned sampler must keep receiving events while a candidate runs.
 * Retain the same wire protocol, output budget and killed-child receipt. */
export function candidateCommandAsync(node:string,request:CandidateCommand,env:NodeJS.ProcessEnv,options:AsyncCandidateOptions={}):Promise<CandidateResult>{
  options.signal?.throwIfAborted();
  const launch=candidateLaunch(node,request,env,options);
  let stop=()=>{},certify=()=>{};
  const completed=new Promise<CandidateResult>((resolve,reject)=>{
    const child=spawn(launch.program,launch.args,{...launch.options,detached:true});
    const captured:(Buffer[]|null)[]=child.stdio.map(stream=>stream?[]:null),sizes:number[]=[];
    let error:Error|undefined,overflow=false,cancelled=false,group:ReturnType<typeof ownedProcessGroup>;
    stop=()=>{
      if(cancelled)return;cancelled=true;
      try{group?.signal('SIGTERM');}catch(cause){error??=cause as Error;}
      try{options.cancelled?.();}catch(cause){error??=cause as Error;}
    };
    certify=()=>{if(cancelled)group?.assertEmpty();};
    child.on('error',cause=>{error??=cause;});
    for(const index of [1,2,3]){
      const stream=child.stdio[index];
      if(!stream||!('on' in stream))continue;
      stream.on('error',(cause:Error)=>{error??=cause;});
      stream.on('data',(part:Buffer)=>{
        sizes[index]=(sizes[index]??0)+part.length;
        if(sizes[index]!>MAX_OUTPUT){
          if(!overflow){overflow=true;error??=Object.assign(new Error('candidate output exceeded its capture budget'),{code:'ENOBUFS'});stop();}
          return;
        }
        captured[index]?.push(Buffer.from(part));
      });
    }
    child.on('close',(status,signal)=>{
      options.signal?.removeEventListener('abort',stop);
      const output=captured.map(parts=>parts?Buffer.concat(parts).toString('utf8'):null);
      try{resolve(candidateReceipt({status,signal,stdout:output[1]??null,stderr:output[2]??null,...(error?{error}:{}),...(cancelled?{cancelled:true}:{}),output}));}
      catch(cause){reject(cause);}
    });
    try{group=ownedProcessGroup(child);}catch(cause){error??=cause as Error;}
    options.signal?.addEventListener('abort',stop,{once:true});
    if(options.signal?.aborted)stop();
    child.stdin!.on('error',cause=>{error??=cause;});
    child.stdin!.end(launch.input);
  });
  const unregister=registerCommandCloser('candidate command '+request.command[0],{cancel:()=>stop(),close:async()=>{await completed;certify();}});
  return completed.then(result=>{
    if(result.cancelled)return {...result,certifyDrain:()=>{certify();unregister();}};
    unregister();return result;
  });
}

async function launch():Promise<number>{
  const request:LaunchRequest=JSON.parse(readFileSync(0,'utf8'));
  if(!isAbsolute(request.tree)||!isAbsolute(request.run)||!request.command.length||
    request.command.some(value=>typeof value!=='string')||!request.owned||Object.values(request.owned).some(value=>typeof value!=='string')||
    request.node!==undefined&&(typeof request.node!=='string'||!isAbsolute(request.node)))throw Error('invalid candidate command request');
  const module=join(request.tree,'tooling/gate/canonical-environment.ts');
  let candidate:typeof import('../gate/canonical-environment.ts');
  try{
    candidate=await import(pathToFileURL(module).href);
    if(typeof candidate.gateEnvironment!=='function')throw Error('gateEnvironment is not exported');
  }catch(error){throw new CandidateEnvironmentContractError(`candidate environment contract: ${module} must export gateEnvironment: ${String(error)}`);}
  const planned=candidate.gateEnvironment(process.env,{run:request.run,owned:request.owned,oracleRoot:request.tree,standalone:request.standalone,node:request.node});
  try{
    const child=spawn(request.command[0]!,request.command.slice(1),{cwd:request.tree,env:planned.env,
      stdio:request.treeLock?['inherit','inherit','inherit','ignore','ignore','ignore','ignore','ignore',8]:'inherit'});
    let error:Error|undefined;
    const closed=new Promise<{status:number|null;signal:NodeJS.Signals|null}>(resolve=>{
      child.on('error',cause=>{error=cause;});child.once('close',(status,signal)=>resolve({status,signal}));
    });
    // The caller signals the whole acquired group once. This entry joins its
    // child instead of forwarding another signal or exiting ahead of it.
    const unregister=registerCommandCloser('candidate payload',{close:async()=>{await closed;}});
    const result=await closed;unregister();
    writeFileSync(3,JSON.stringify({signal:result.signal,error:error?{message:error.message,code:(error as NodeJS.ErrnoException).code}:null}));
    return result.status??1;
  }finally{
    // Recorder evidence lives in its own run files, as before. Its run-owned
    // scratch is discarded even when recording refuses or cannot start.
    if(request.discardTemporary)finishRunTemporary(planned.temporary,planned.env.HOME!,true);
  }
}

runAsCommand(import.meta.url,async()=>{
  try{process.exitCode=await launch();}
  catch(error){
    console.error(`candidate environment: ${String(error)}`);
    if(!(error instanceof CandidateEnvironmentContractError))writeFileSync(3,JSON.stringify({signal:null,error:{message:String(error)}}));
    process.exitCode=2;
  }
});
