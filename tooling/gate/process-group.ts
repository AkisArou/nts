// Only a directly spawned detached child grants a process-group signal owner.
import type {ChildProcess} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {liveProcessStat,readProcessStat,readProcessStats,type StatReader} from '../differential/process-stat/main.ts';

export type ProcessGroupIdentity={group:number;session:number;started:number;live?:boolean};
/** A persisted observation grants no signal authority. */
export type ProcessGroupBirth={version:1;pid:number;started:number;boot:string};
const bootIdentity=()=>readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
const identityAt=(pid:number):ProcessGroupIdentity|undefined=>readProcessStat(pid);
export type ProcessGroupObservations={boot:()=>string;pids:()=>Iterable<number>;stat:StatReader};
const liveGroupObservations:ProcessGroupObservations={boot:bootIdentity,pids:()=>readdirSync('/proc').filter(name=>/^\d+$/.test(name)).map(Number),stat:liveProcessStat};

/** Read-only recovery. On this boot, empty means no live member with both
 * the recorded PGID and session and a start at/after the captured birth.
 * A different boot proves every process from the recorded boot is gone.
 * This never reconstructs a signaller from disk or from the process scan. */
export function assertObservedGroupEmpty(value:unknown,observations:ProcessGroupObservations=liveGroupObservations):void{
  const birth=value as ProcessGroupBirth;
  if(!birth||typeof birth!=='object'||Array.isArray(birth)||Object.keys(birth).sort().join(',')!=='boot,pid,started,version'
    ||birth.version!==1||!Number.isSafeInteger(birth.pid)||birth.pid<=1||!Number.isSafeInteger(birth.started)||birth.started<=0
    ||typeof birth.boot!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(birth.boot))throw Error('invalid persisted command group birth');
  if(birth.boot!==observations.boot())return;
  for(const [name,process] of readProcessStats(observations.pids(),observations.stat)){
    if(process.live&&process.group===birth.pid&&process.session===birth.pid&&process.started>=birth.started)
      throw Error(`owned command group ${birth.pid} has not drained: live member ${name}`);
  }
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
  let birth:ProcessGroupIdentity,observation:ProcessGroupBirth;
  try{
    const observed=identityAt(pid);
    if(!observed||observed.group!==pid||observed.session!==pid)throw Error('spawned command has no owned process group');
    birth=observed;
    observation=Object.freeze({version:1,pid,started:birth.started,boot:bootIdentity()});
  }catch(error){
    // Ownership acquisition failed. Kill only the child handle we just
    // spawned; there is no authority to signal a negative group here.
    try{child.kill('SIGKILL');}
    catch(cleanup){throw new AggregateError([error,cleanup],'process-group acquisition and spawned-child cleanup failed');}
    throw error;
  }
  return {pid,started:birth.started,observation,assertEmpty():void{assertObservedGroupEmpty(observation);},signal(signal:NodeJS.Signals):void{
    assertProcessGroupIdentity(pid,birth,identityAt(pid));
    try{process.kill(-pid,signal);}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
  }};
}
