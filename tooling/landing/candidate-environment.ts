// Cross-version contract: the candidate's tooling/gate/canonical-environment.ts
// exports gateEnvironment. No other version creates its environment or grants.
// Keep this process alive while the command runs: it owns resolutionOwner.
import {spawnSync} from "node:child_process";
import {readFileSync,writeFileSync} from "node:fs";
import {isAbsolute,join,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

export type CandidateCommand = {tree:string;run:string;owned:Record<string,string>;command:readonly string[]};
class CandidateEnvironmentContractError extends Error {}

/** The caller supplies the already verified candidate Node, never PATH's node. */
export function candidateCommand(node:string,request:CandidateCommand,env:NodeJS.ProcessEnv){
  const result=spawnSync(node,[fileURLToPath(new URL('./candidate-environment.ts',import.meta.url))],{
    cwd:request.tree,env,input:JSON.stringify(request),encoding:'utf8',maxBuffer:1<<30,stdio:['pipe','pipe','pipe','pipe'],
  });
  // Keep a killed/not-started command distinct from its ordinary nonzero exit.
  if(result.output[3]){
    const receipt:{signal:NodeJS.Signals|null;error:{message:string;code?:string}|null}=JSON.parse(result.output[3]);
    result.signal=receipt.signal;
    if(receipt.error)result.error=Object.assign(new Error(receipt.error.message),{code:receipt.error.code});
  }
  return result;
}

async function launch():Promise<number>{
  const request:CandidateCommand=JSON.parse(readFileSync(0,'utf8'));
  if(!isAbsolute(request.tree)||!isAbsolute(request.run)||!request.command.length||
    request.command.some(value=>typeof value!=='string')||!request.owned||Object.values(request.owned).some(value=>typeof value!=='string'))throw Error('invalid candidate command request');
  const module=join(request.tree,'tooling/gate/canonical-environment.ts');
  let candidate:typeof import('../gate/canonical-environment.ts');
  try{
    candidate=await import(pathToFileURL(module).href);
    if(typeof candidate.gateEnvironment!=='function')throw Error('gateEnvironment is not exported');
  }catch(error){throw new CandidateEnvironmentContractError(`candidate environment contract: ${module} must export gateEnvironment: ${String(error)}`);}
  const planned=candidate.gateEnvironment(process.env,{run:request.run,owned:request.owned,oracleRoot:request.tree});
  const child=spawnSync(request.command[0]!,request.command.slice(1),{cwd:request.tree,env:planned.env,stdio:'inherit'});
  writeFileSync(3,JSON.stringify({signal:child.signal,error:child.error?{message:child.error.message,code:(child.error as NodeJS.ErrnoException).code}:null}));
  return child.status??1;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{process.exitCode=await launch();}
  catch(error){
    console.error(`candidate environment: ${String(error)}`);
    if(!(error instanceof CandidateEnvironmentContractError))writeFileSync(3,JSON.stringify({signal:null,error:{message:String(error)}}));
    process.exitCode=2;
  }
}
