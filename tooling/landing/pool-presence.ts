// Git owns the task's checkout; this separate record owns worker presence.
// Readers never repair state. Unknown state protects the tree as attached.
import {lstatSync,readFileSync,rmSync} from 'node:fs';
import {durableRecord} from '../gate/durable-record.ts';
import {assertStateVersion,assertWritableState} from '../gate/state-version.ts';

export type DetachRequest={id:string;at:number;pid:number;identity:string};
export type WorkerPresence={state:'attached'|'detach-pending'|'detached';detachedAt:number|null;detachRequest?:DetachRequest;pendingReason?:string;diagnostic?:string};
type PresenceRecord={version:1|2;branch:string;dev:number;ino:number}&WorkerPresence;
const VERSION=2;
const IDENTITY=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} ([1-9][0-9]*) [0-9]+$/;
export const workerPresenceFile=(tree:string):string=>tree+'.worker.json';
export const assertWorkerPresenceWritable=(tree:string):void=>assertWritableState(workerPresenceFile(tree),VERSION);
const time=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
function validRequest(value:DetachRequest|undefined):value is DetachRequest{
  return !!value&&typeof value.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.id)&&time(value.at)
    &&value.at<=8_640_000_000_000_000&&Number.isSafeInteger(value.pid)&&value.pid>0&&typeof value.identity==='string'&&Number(IDENTITY.exec(value.identity)?.[1])===value.pid;
}

/** One fail-closed reader for status, disk promises and deletion eligibility.
 * A requester's exit never cancels its durable request. Only attachment does. */
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
    assertStateVersion(row,VERSION,file);
    if(![1,VERSION].includes(row?.version)||typeof row.branch!=='string'||!row.branch||!Number.isSafeInteger(row.dev)||!Number.isSafeInteger(row.ino)
      ||!['attached','detached','detach-pending'].includes(row.state)||!(row.state==='detached'?time(row.detachedAt):row.detachedAt===null)
      ||(row.state==='detach-pending'?row.version!==VERSION||!validRequest(row.detachRequest)||typeof row.pendingReason!=='string'||!row.pendingReason:
        row.detachRequest!==undefined||row.pendingReason!==undefined))throw Error('invalid worker presence');
    const root=lstatSync(tree);
    if(!root.isDirectory()||root.isSymbolicLink()||root.dev!==row.dev||root.ino!==row.ino)throw Error('worker presence belongs to another worktree');
    if(row.branch!==branch)throw Error('branch changed without presence publication: record names '+row.branch+', tree holds '+branch);
    return {state:row.state,detachedAt:row.detachedAt,...(row.state==='detach-pending'?{detachRequest:row.detachRequest!,pendingReason:row.pendingReason!}:{})};
  }catch(error){return {state:'attached',detachedAt:null,diagnostic:file+': '+(error instanceof Error?error.message:String(error))};}
}

/** Caller holds the pool operation owner and its short publication transaction.
 * A future writer is never downgraded. Pending never grants reclamation. */
export function writeWorkerPresence(tree:string,branch:string,state:WorkerPresence['state'],now:number,
  pending?:{request:DetachRequest;reason:string}):void{
  const file=workerPresenceFile(tree),root=lstatSync(tree);
  if(!root.isDirectory()||root.isSymbolicLink())throw Error('invalid worker tree: '+tree);
  if(state==='detach-pending'&&(!pending||!validRequest(pending.request)||!pending.reason))throw Error('invalid detach request');
  assertWorkerPresenceWritable(tree);
  durableRecord(file,{version:VERSION,branch,dev:root.dev,ino:root.ino,state,detachedAt:state==='detached'?now:null,
    ...(state==='detach-pending'?{detachRequest:pending!.request,pendingReason:pending!.reason}:{})} satisfies PresenceRecord);
}

/** Ending the Git hold ends its presence too, under the same pool lock. */
export function removeWorkerPresence(tree:string):void{
  assertWorkerPresenceWritable(tree);
  rmSync(workerPresenceFile(tree),{force:true});
}
