// Only a directly spawned detached child grants a process-group signal owner.
import type {ChildProcess} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';

export type ProcessGroupIdentity={group:number;session:number;started:number;live?:boolean};
/** A persisted observation grants no signal authority. */
export type ProcessGroupBirth={version:1;pid:number;started:number;boot:string};
const bootIdentity=()=>readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
/** Linux stat fields begin after the final ')' because comm may contain it. */
export function processStat(text:string){
  const end=text.lastIndexOf(')');
  if(!/^\d+ \(/.test(text)||end<0||text[end+1]!==' ')throw Error('invalid process activity record');
  const fields=text.slice(end+2).trim().split(/\s+/);
  const indexes=[1,2,3,11,12,13,14,19],values=indexes.map(at=>Number(fields[at]));
  if(!/^[RSDZTtXxKWPI]$/.test(fields[0]??'')||indexes.some((at,index)=>!/^\d+$/.test(fields[at]??'')||!Number.isSafeInteger(values[index])))
    throw Error('invalid process activity counters');
  return {parent:values[0]!,group:values[1]!,session:values[2]!,cpu:values.slice(3,7).reduce((sum,n)=>sum+n,0),
    own:values[3]!+values[4]!,started:values[7]!,busy:fields[0]==='R'||fields[0]==='D',live:fields[0]!=='Z'&&fields[0]!=='X'&&fields[0]!=='x'};
}
export type ProcessStat=ReturnType<typeof processStat>;
type StatReader=(pid:number)=>string;
const liveStat:StatReader=pid=>readFileSync(`/proc/${pid}/stat`,'utf8');
const gone=(error:unknown)=>['ENOENT','ESRCH'].includes((error as NodeJS.ErrnoException).code??'');

/** A malformed stat is retried once after all first observations.
 * Only absence proves gone. Recovered records (including reused PIDs) still
 * participate; repeated malformed bytes never certify an empty group. */
export function readProcessStats(pids:Iterable<number>,readStat:StatReader=liveStat,onError:(pid:number,error:Error)=>void=(_pid,error)=>{throw error;}):Map<number,ProcessStat>{
  const records=new Map<number,ProcessStat>(),retry=new Map<number,string>();
  const read=(pid:number):string|undefined=>{
    try{return readStat(pid);}catch(error){
      if(!gone(error))onError(pid,Error(`cannot read process ${pid} stat: ${String(error)}`,{cause:error}));
      return;
    }
  };
  for(const pid of pids){
    const text=read(pid);if(text===undefined)continue;
    try{records.set(pid,processStat(text));}catch{retry.set(pid,text);}
  }
  for(const [pid,first] of retry){
    const text=read(pid);if(text===undefined)continue;
    try{records.set(pid,processStat(text));}
    catch{onError(pid,Error(`invalid process ${pid} stat after recheck: first ${JSON.stringify(first)}; again ${JSON.stringify(text)}`));}
  }
  return records;
}
export function readProcessStat(pid:number,readStat:StatReader=liveStat):ProcessStat|undefined{return readProcessStats([pid],readStat).get(pid);}
const identityAt=(pid:number):ProcessGroupIdentity|undefined=>readProcessStat(pid);
export type ProcessGroupObservations={boot:()=>string;pids:()=>Iterable<number>;stat:StatReader};
const liveGroupObservations:ProcessGroupObservations={boot:bootIdentity,pids:()=>readdirSync('/proc').filter(name=>/^\d+$/.test(name)).map(Number),stat:liveStat};

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
