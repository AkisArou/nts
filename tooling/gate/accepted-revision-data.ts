// Accepted-main blobs are independent of candidate-tree bytes. Keep their
// addresses private: callers can only ask this owner to read that revision.
import {spawnSync} from 'node:child_process';
import {isAbsolute,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gitArguments} from './git-arguments/main.ts';

declare const ACCEPTED_DATA:unique symbol;
export type AcceptedRevisionData={readonly [ACCEPTED_DATA]:true};
export type RevisionContent=string|{error:string};
/** Whole blobs under a declared directory whose content matches a pattern. */
export type RevisionFiles={path:string;text:string}[]|{error:string};
declare const ACCEPTED_REVISION:unique symbol;
export type AcceptedRevision={readonly [ACCEPTED_REVISION]:true;readonly revision:string;
  show(descriptor:AcceptedRevisionData):RevisionContent;grep(descriptor:AcceptedRevisionData,pattern:string):RevisionContent;
  files(descriptor:AcceptedRevisionData,pattern:string):RevisionFiles};
const paths=new WeakMap<AcceptedRevisionData,string>();
const root=fileURLToPath(new URL('../..',import.meta.url));

/** No working-tree URL or path escapes this declaration/read owner. */
export function acceptedRevisionData(url:URL):AcceptedRevisionData{
  const path=relative(root,fileURLToPath(url)).split(sep).join('/');
  if(!path||isAbsolute(path)||path==='..'||path.startsWith('../'))throw Error('accepted revision data escapes repository');
  const descriptor=Object.freeze({}) as AcceptedRevisionData;
  paths.set(descriptor,path);return descriptor;
}

/** Capture accepted main here, never a caller's candidate commit. Every read
 * uses this immutable revision even if the repository's refs later move. */
export function acceptedRevision(repo:string):AcceptedRevision|{error:string}{
  const main=spawnSync('git',gitArguments(['rev-parse','--verify','refs/heads/main^{commit}']),{cwd:repo,encoding:'utf8'});
  const mainSha=main.stdout?.trim();
  if(main.error||main.status!==0||!mainSha||!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(mainSha))
    return {error:main.error?.message||main.stderr?.trim()||'accepted main revision unavailable'};
  const read=(descriptor:AcceptedRevisionData,operation:'show'|'grep',pattern?:string):RevisionContent=>{
    const path=paths.get(descriptor);
    if(!path)throw Error('accepted revision read requires its owned descriptor');
    const args=operation==='show'?['show',mainSha+':'+path]:
      ['grep','--no-color','--no-textconv','--no-line-number','--no-column','--no-heading','--no-break','-I','-h','-E',pattern!,mainSha,'--',path];
    const result=spawnSync('git',gitArguments(args),{cwd:repo,encoding:'utf8',maxBuffer:1<<26});
    if(result.error||result.status!==0&&!(operation==='grep'&&result.status===1))
      return {error:result.error?.message||result.stderr.trim()||'git '+operation+' exit '+result.status};
    return result.stdout;
  };
  // A reader that needs each blob's own context (a relative path beside the
  // citation that names its root) reads the matching blobs whole.
  const files=(descriptor:AcceptedRevisionData,pattern:string):RevisionFiles=>{
    const path=paths.get(descriptor);
    if(!path)throw Error('accepted revision read requires its owned descriptor');
    const listed=spawnSync('git',gitArguments(['grep','--no-color','--no-textconv','-I','-l','-z','-E',pattern,mainSha,'--',path]),{cwd:repo,encoding:'utf8',maxBuffer:1<<26});
    if(listed.error||listed.status!==0&&listed.status!==1)return {error:listed.error?.message||listed.stderr.trim()||'git grep exit '+listed.status};
    const found:{path:string;text:string}[]=[];
    for(const name of listed.stdout.split('\0').filter(Boolean)){
      if(!name.startsWith(mainSha+':'))return {error:'git grep named '+name+' outside '+mainSha};
      const file=name.slice(mainSha.length+1);
      const shown=spawnSync('git',gitArguments(['show',mainSha+':'+file]),{cwd:repo,encoding:'utf8',maxBuffer:1<<28});
      if(shown.error||shown.status!==0)return {error:shown.error?.message||shown.stderr.trim()||'git show exit '+shown.status};
      found.push({path:file,text:shown.stdout});
    }
    return found.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  };
  return Object.freeze({revision:mainSha,show:(descriptor:AcceptedRevisionData)=>read(descriptor,'show'),
    grep:(descriptor:AcceptedRevisionData,pattern:string)=>read(descriptor,'grep',pattern),files}) as AcceptedRevision;
}
