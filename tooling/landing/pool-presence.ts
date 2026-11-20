// Git owns the task's checkout; this separate record owns worker presence.
// Readers never repair state. Unknown state protects the tree as attached.
import {lstatSync,readFileSync,rmSync} from 'node:fs';
import {durableRecord} from '../gate/durable-record.ts';
import {assertStateVersion,assertWritableState} from '../gate/state-version.ts';

export type WorkerPresence={state:'attached'|'detached';detachedAt:number|null;diagnostic?:string};
type PresenceRecord={version:1;branch:string;dev:number;ino:number;state:'attached'|'detached';detachedAt:number|null};
export const workerPresenceFile=(tree:string):string=>tree+'.worker.json';
export const assertWorkerPresenceWritable=(tree:string):void=>assertWritableState(workerPresenceFile(tree),1);

/** One fail-closed reader for status, disk promises and deletion eligibility. */
export function workerPresence(tree:string,branch:string):WorkerPresence{
  const file=workerPresenceFile(tree);
  try{
    let stat;
    try{stat=lstatSync(file);}catch(error){
      if((error as NodeJS.ErrnoException).code==='ENOENT')return {state:'attached',detachedAt:null};
      throw error;
    }
    if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid?.())throw Error('not an owned regular record');
    const row=JSON.parse(readFileSync(file,'utf8')) as PresenceRecord;
    assertStateVersion(row,1,file);
    if(row?.version!==1||typeof row.branch!=='string'||!row.branch||!Number.isSafeInteger(row.dev)||!Number.isSafeInteger(row.ino)
      ||!['attached','detached'].includes(row.state)||!(row.state==='attached'?row.detachedAt===null:Number.isSafeInteger(row.detachedAt)&&row.detachedAt!>=0))throw Error('invalid worker presence');
    const root=lstatSync(tree);
    if(!root.isDirectory()||root.isSymbolicLink()||root.dev!==row.dev||root.ino!==row.ino||row.branch!==branch)throw Error('worker presence belongs to another branch or worktree');
    return {state:row.state,detachedAt:row.detachedAt};
  }catch(error){return {state:'attached',detachedAt:null,diagnostic:file+': '+(error instanceof Error?error.message:String(error))};}
}

/** Caller holds the pool and tree locks. A future writer is never downgraded. */
export function writeWorkerPresence(tree:string,branch:string,state:WorkerPresence['state'],now:number):void{
  const file=workerPresenceFile(tree),root=lstatSync(tree);
  if(!root.isDirectory()||root.isSymbolicLink())throw Error('invalid worker tree: '+tree);
  assertWorkerPresenceWritable(tree);
  durableRecord(file,{version:1,branch,dev:root.dev,ino:root.ino,state,detachedAt:state==='detached'?now:null} satisfies PresenceRecord);
}

/** Ending the Git hold ends its presence too, under the same pool lock. */
export function removeWorkerPresence(tree:string):void{
  assertWorkerPresenceWritable(tree);
  rmSync(workerPresenceFile(tree),{force:true});
}
