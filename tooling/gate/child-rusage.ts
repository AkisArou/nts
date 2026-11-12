// The command's waited rusage, not the observer's CPU or a sampled process tree.
import {spawnSync,type SpawnSyncOptionsWithStringEncoding,type SpawnSyncReturns} from 'node:child_process';
import {readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {getSystemErrorName} from 'node:util';
import {infrastructureProbe} from './infrastructure-probe.ts';

export type ChildUsage={version:1;cpu_measure:'wait4-rusage-v1';pid:number;wall_s:number;user_s:number;sys_s:number;exit:number;signal:number;exec_errno:number};
export type ChildObserver={binary:string;directory:string};
let ordinal=0;

export function prepareChildObserver(directory:string,env:NodeJS.ProcessEnv):{observer?:ChildObserver;error?:string}{
  const binary=join(directory,'phase-child');
  try{
    const built=infrastructureProbe({purpose:'build the waited-child phase observer',command:'cc',args:['-O2','-std=c11','-Wall','-Wextra','-Werror',fileURLToPath(new URL('./phase-child.c',import.meta.url)),'-o',binary],env});
    return built.status===0?{observer:{binary,directory}}:{error:`phase observer could not be built: ${built.stderr||built.status}`};
  }catch(error){return {error:`phase observer could not be built: ${String(error)}`};}
}

export function readChildUsage(value:unknown):ChildUsage{
  if(typeof value!=='object'||value===null)throw Error('phase observation: missing waited-child rusage');
  const row=value as Record<string,unknown>;
  if(row.version!==1||row.cpu_measure!=='wait4-rusage-v1'
    ||!['pid','exit','signal','exec_errno'].every(key=>typeof row[key]==='number'&&Number.isSafeInteger(row[key]))
    ||!['wall_s','user_s','sys_s'].every(key=>typeof row[key]==='number'&&Number.isFinite(row[key])&&row[key]>=0)
    ||Number(row.pid)<0||(Number(row.pid)===0&&!(Number(row.exec_errno)>0&&row.exit===-1&&row.signal===0))
    ||Number(row.exit)<-1||Number(row.signal)<0||Number(row.exec_errno)<0)
    throw Error('phase observation: invalid waited-child rusage');
  return row as ChildUsage;
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
