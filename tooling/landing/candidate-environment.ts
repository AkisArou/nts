// Cross-version contract: the candidate's tooling/gate/canonical-environment.ts
// exports gateEnvironment. No other version creates its environment or grants.
// Keep this process alive while the command runs: it owns resolutionOwner.
import {spawnSync,type StdioOptions} from "node:child_process";
import {readFileSync,writeFileSync} from "node:fs";
import {isAbsolute,join,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {finishRunTemporary} from '../gate/run-temporary.ts';

export type CandidateCommand = {tree:string;run:string;owned:Record<string,string>;command:readonly string[];standalone?:boolean;discardTemporary?:boolean};
type LaunchRequest=CandidateCommand&{treeLock?:boolean;node?:string};
class CandidateEnvironmentContractError extends Error {}

/** The caller supplies the already verified candidate Node, never PATH's node. */
export function candidateCommand(node:string,request:CandidateCommand,env:NodeJS.ProcessEnv,options:{output?:number;treeLock?:number;supervisor?:readonly [string,...string[]]}={}){
  const output=options.output??'pipe',stdio:StdioOptions=['pipe',output,output,'pipe'];
  if(options.treeLock!==undefined)stdio.push('ignore','ignore','ignore','ignore',options.treeLock);
  const [program,...args]=[...(options.supervisor??[]),node,fileURLToPath(import.meta.url)];
  const result=spawnSync(program!,args,{
    cwd:request.tree,env:options.treeLock!==undefined?{...env,NTS_GATE_LOCK_FD:'8'}:env,
    input:JSON.stringify({...request,node,treeLock:options.treeLock!==undefined}),encoding:'utf8',maxBuffer:1<<30,
    stdio,
  });
  // Keep a killed/not-started command distinct from its ordinary nonzero exit.
  if(result.output?.[3]){
    const receipt:{signal:NodeJS.Signals|null;error:{message:string;code?:string}|null}=JSON.parse(result.output[3]);
    result.signal=receipt.signal;
    if(receipt.error)result.error=Object.assign(new Error(receipt.error.message),{code:receipt.error.code});
  }
  return result;
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
    const child=spawnSync(request.command[0]!,request.command.slice(1),{cwd:request.tree,env:planned.env,
      stdio:request.treeLock?['inherit','inherit','inherit','ignore','ignore','ignore','ignore','ignore',8]:'inherit'});
    writeFileSync(3,JSON.stringify({signal:child.signal,error:child.error?{message:child.error.message,code:(child.error as NodeJS.ErrnoException).code}:null}));
    return child.status??1;
  }finally{
    // Recorder evidence lives in its own run files, as before. Its run-owned
    // scratch is discarded even when recording refuses or cannot start.
    if(request.discardTemporary)finishRunTemporary(planned.temporary,planned.env.HOME!,true);
  }
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{process.exitCode=await launch();}
  catch(error){
    console.error(`candidate environment: ${String(error)}`);
    if(!(error instanceof CandidateEnvironmentContractError))writeFileSync(3,JSON.stringify({signal:null,error:{message:String(error)}}));
    process.exitCode=2;
  }
}
