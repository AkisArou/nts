// The command's waited rusage, not the observer's CPU or a sampled process tree.
import {spawnSync,type SpawnSyncOptionsWithStringEncoding,type SpawnSyncReturns} from 'node:child_process';
import {readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {getSystemErrorName} from 'node:util';
import {infrastructureProbe} from './infrastructure-probe.ts';

import {readChildUsage,type ChildUsage} from './child-usage.ts';
export {readChildUsage,type ChildUsage} from './child-usage.ts';
export type ChildObserver={binary:string;directory:string};
let ordinal=0;

export function prepareChildObserver(directory:string,env:NodeJS.ProcessEnv):{observer?:ChildObserver;error?:string}{
  const binary=join(directory,'phase-child');
  try{
    const built=infrastructureProbe({purpose:'build the waited-child phase observer',command:'cc',args:['-O2','-std=c11','-Wall','-Wextra','-Werror',fileURLToPath(new URL('./phase-child.c',import.meta.url)),'-o',binary],env});
    return built.status===0?{observer:{binary,directory}}:{error:`phase observer could not be built: ${built.stderr||built.status}`};
  }catch(error){return {error:`phase observer could not be built: ${String(error)}`};}
}


export function observedSpawnSync(command:string,args:readonly string[],options:SpawnSyncOptionsWithStringEncoding,
  observer:ChildObserver,record:(usage:ChildUsage|undefined,error?:string)=>void):SpawnSyncReturns<string>{
  const report=join(observer.directory,`child-${process.pid}-${ordinal++}.json`);
  const result=spawnSync(observer.binary,[report,'--',command,...args],options);
  let usage:ChildUsage|undefined;
  try{usage=readChildUsage(JSON.parse(readFileSync(report,'utf8')));}
  catch(error){record(undefined,String(error));}
  finally{try{rmSync(report,{force:true});}catch(error){record(undefined,`removing child observation: ${String(error)}`);}}
  if(usage){
    // execvp (and Node) can run executable text through its shell fallback;
    // posix_spawnp deliberately has no such contract. Only a proven no-entry
    // refusal may delegate once. Keep that child's CPU unknown, not zero.
    if(usage.pid===0&&usage.exec_errno&&getSystemErrorName(-usage.exec_errno)==='ENOEXEC'){
      record(undefined,'phase observation: ENOEXEC before entry; ordinary launch retained without waited rusage');
      return spawnSync(command,[...args],options);
    }
    record(usage);
    result.pid=usage.pid;
    if(usage.exec_errno){
      const code=getSystemErrorName(-usage.exec_errno);
      result.error=Object.assign(Error(`spawnSync ${command} ${code}`),{code,errno:-usage.exec_errno,path:command,spawnargs:[...args]});
      result.status=null;result.signal=null;
    }
  }
  return result;
}
