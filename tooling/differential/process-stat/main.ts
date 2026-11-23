// The one owner of Linux process and task stat records. It imports only
// node:fs, captured at load: the sealed oracle child carries this leaf in its
// own namespace, and governed code that replaces fs methods (and syncs the
// builtin exports) cannot change what it reads. Callers choose their policy
// for unreadable records through the explicit onError option; none splits a
// record itself.
import {readFileSync} from 'node:fs';
const readText=readFileSync;

export type ProcessStat={parent:number;group:number;session:number;cpu:number;own:number;started:number;busy:boolean;live:boolean;
  state:string;comm:string;processor?:number};
/** Linux stat fields begin after the final ')' because comm may contain it. */
export function processStat(text:string):ProcessStat{
  const end=text.lastIndexOf(')');
  if(!/^\d+ \(/.test(text)||end<0||text[end+1]!==' ')throw Error('invalid process activity record');
  const fields=text.slice(end+2).trim().split(/\s+/);
  const indexes=[1,2,3,11,12,13,14,19],values=indexes.map(at=>Number(fields[at]));
  if(!/^[RSDZTtXxKWPI]$/.test(fields[0]??'')||indexes.some((at,index)=>!/^\d+$/.test(fields[at]??'')||!Number.isSafeInteger(values[index])))
    throw Error('invalid process activity counters');
  // The CPU a task last ran on (field 39) is present in every full kernel record.
  const processor=fields[36];
  if(processor!==undefined&&(!/^\d+$/.test(processor)||!Number.isSafeInteger(Number(processor))))throw Error('invalid process activity counters');
  return {parent:values[0]!,group:values[1]!,session:values[2]!,cpu:values.slice(3,7).reduce((sum,n)=>sum+n,0),
    own:values[3]!+values[4]!,started:values[7]!,busy:fields[0]==='R'||fields[0]==='D',live:fields[0]!=='Z'&&fields[0]!=='X'&&fields[0]!=='x',
    state:fields[0]!,comm:text.slice(text.indexOf('(')+1,end),...(processor===undefined?{}:{processor:Number(processor)})};
}
export type StatReader=(pid:number)=>string;
export type StatErrorPolicy<K=number>=(key:K,error:Error)=>void;
export const liveProcessStat:StatReader=pid=>readText(`/proc/${pid}/stat`,'utf8');
const liveTaskStat=(pid:number,tid:number)=>readText(`/proc/${pid}/task/${tid}/stat`,'utf8');
const gone=(error:unknown)=>['ENOENT','ESRCH'].includes((error as NodeJS.ErrnoException).code??'');
const throwing:StatErrorPolicy<unknown>=(_key,error)=>{throw error;};
/** The explicit policy of a nullable or best-effort caller: an unreadable or
 * still-malformed record is absent, exactly as a gone process is. */
export const unreadableIsAbsent:StatErrorPolicy<unknown>=()=>{};

/** A malformed stat is retried once after all first observations.
 * Only absence proves gone. Recovered records (including reused PIDs) still
 * participate; repeated malformed bytes never certify an empty group. */
function readStats<K>(keys:Iterable<K>,readStat:(key:K)=>string,name:(key:K)=>string,onError:StatErrorPolicy<K>):Map<K,ProcessStat>{
  const records=new Map<K,ProcessStat>(),retry=new Map<K,string>();
  const read=(key:K):string|undefined=>{
    try{return readStat(key);}catch(error){
      if(!gone(error))onError(key,Error(`cannot read ${name(key)} stat: ${String(error)}`,{cause:error}));
      return;
    }
  };
  for(const key of keys){
    const text=read(key);if(text===undefined)continue;
    try{records.set(key,processStat(text));}catch{retry.set(key,text);}
  }
  for(const [key,first] of retry){
    const text=read(key);if(text===undefined)continue;
    try{records.set(key,processStat(text));}
    catch{onError(key,Error(`invalid ${name(key)} stat after recheck: first ${JSON.stringify(first)}; again ${JSON.stringify(text)}`));}
  }
  return records;
}
export function readProcessStats(pids:Iterable<number>,readStat:StatReader=liveProcessStat,onError:StatErrorPolicy=throwing):Map<number,ProcessStat>{
  return readStats(pids,readStat,pid=>`process ${pid}`,onError);
}
export function readProcessStat(pid:number,readStat:StatReader=liveProcessStat,onError:StatErrorPolicy=throwing):ProcessStat|undefined{
  return readProcessStats([pid],readStat,onError).get(pid);
}
/** The threads of one process, by task id, under the same recheck. */
export function readTaskStats(pid:number,tids:Iterable<number>,onError:StatErrorPolicy=throwing,readStat:StatReader=tid=>liveTaskStat(pid,tid)):Map<number,ProcessStat>{
  return readStats(tids,readStat,tid=>`process ${pid} task ${tid}`,onError);
}
