// Only a directly spawned detached child grants a process-group signal owner.
import type {ChildProcess} from 'node:child_process';
import {readFileSync} from 'node:fs';

export type ProcessGroupIdentity={group:number;session:number;started:number};
function identityAt(pid:number):ProcessGroupIdentity|undefined{
  let text:string;
  try{text=readFileSync(`/proc/${pid}/stat`,'utf8');}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'||(error as NodeJS.ErrnoException).code==='ESRCH')return;throw error;}
  const end=text.lastIndexOf(')');if(end<0)throw Error('invalid process activity record');
  const fields=text.slice(end+2).trim().split(/\s+/),values=[2,3,19].map(at=>Number(fields[at]));
  if(values.some(value=>!Number.isSafeInteger(value)||value<0))throw Error('invalid process activity counters');
  return {group:values[0]!,session:values[1]!,started:values[2]!};
}

export function assertProcessGroupIdentity(pid:number,birth:ProcessGroupIdentity,current:ProcessGroupIdentity|undefined):void{
  if(current&&(current.started!==birth.started||current.group!==pid||current.session!==pid))
    throw Error('refusing to stop a changed command group');
}

/** Capture synchronously, before the parent can reap a fast child. Linux keeps
 * a PGID reserved while any group member lives, so an exited leader does not
 * revoke this group's signal authority. An observed new leader must still
 * match the captured birth identity. This is active-process's shared fence. */
export function ownedProcessGroup(child:ChildProcess){
  const pid=child.pid;
  if(pid===undefined)return;
  if(!Number.isSafeInteger(pid)||pid<=1)throw Error('spawned command has no owned process group');
  let birth:ProcessGroupIdentity;
  try{
    const observed=identityAt(pid);
    if(!observed||observed.group!==pid||observed.session!==pid)throw Error('spawned command has no owned process group');
    birth=observed;
  }catch(error){
    // Ownership acquisition failed. Kill only the child handle we just
    // spawned; there is no authority to signal a negative group here.
    try{child.kill('SIGKILL');}
    catch(cleanup){throw new AggregateError([error,cleanup],'process-group acquisition and spawned-child cleanup failed');}
    throw error;
  }
  return {pid,started:birth.started,signal(signal:NodeJS.Signals):void{
    assertProcessGroupIdentity(pid,birth,identityAt(pid));
    try{process.kill(-pid,signal);}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
  }};
}
