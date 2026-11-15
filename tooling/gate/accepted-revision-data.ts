// Accepted-main blobs are independent of candidate-tree bytes. Keep their
// addresses private: callers can only ask this owner to read that revision.
import {spawnSync} from 'node:child_process';
import {isAbsolute,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gitArguments} from './git-arguments/main.ts';

declare const ACCEPTED_DATA:unique symbol;
export type AcceptedRevisionData={readonly [ACCEPTED_DATA]:true};
export type RevisionContent=string|{error:string};
const paths=new WeakMap<AcceptedRevisionData,string>();
const root=fileURLToPath(new URL('../..',import.meta.url));

/** No working-tree URL or path escapes this declaration/read owner. */
export function acceptedRevisionData(url:URL):AcceptedRevisionData{
  const path=relative(root,fileURLToPath(url)).split(sep).join('/');
  if(!path||isAbsolute(path)||path==='..'||path.startsWith('../'))throw Error('accepted revision data escapes repository');
  const descriptor=Object.freeze({}) as AcceptedRevisionData;
  paths.set(descriptor,path);return descriptor;
}

/** The caller captures main once. Every read names that immutable commit;
 * failed reads stay unavailable, including an absent or invalid revision. */
export function acceptedRevision(repo:string,mainSha:string){
  const read=(descriptor:AcceptedRevisionData,operation:'show'|'grep',pattern?:string):RevisionContent=>{
    const path=paths.get(descriptor);
    if(!path)throw Error('accepted revision read requires its owned descriptor');
    if(!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(mainSha))return {error:'accepted main revision is not a full commit id: '+mainSha};
    const args=operation==='show'?['show',mainSha+':'+path]:
      ['grep','--no-color','--no-textconv','-I','-h','-E',pattern!,mainSha,'--',path];
    const result=spawnSync('git',gitArguments(args),{cwd:repo,encoding:'utf8',maxBuffer:1<<26});
    if(result.error||result.status!==0&&!(operation==='grep'&&result.status===1))
      return {error:result.error?.message||result.stderr.trim()||'git '+operation+' exit '+result.status};
    return result.stdout;
  };
  return {show:(descriptor:AcceptedRevisionData)=>read(descriptor,'show'),
    grep:(descriptor:AcceptedRevisionData,pattern:string)=>read(descriptor,'grep',pattern)};
}
