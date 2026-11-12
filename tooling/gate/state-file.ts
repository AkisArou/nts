// Shared mutable state is read and published under the same file lock. This is
// the history owner's existing flock protocol, also used by durable records.
import {spawnSync,type SpawnSyncReturns} from 'node:child_process';
import {closeSync,mkdirSync,openSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {assertStateVersion,assertWritableState} from './state-version.ts';
import {durableRecord} from './durable-record.ts';

export const STATE_LOCK_WAIT_SECONDS=10;
export function lockStateFile(file:string):(()=>void)|null{
  const fd=openSync(`${file}.lock`,'a',0o600);let locked:SpawnSyncReturns<string>;
  try{
    // flock locks this shared open-file description; closing fd releases it.
    locked=spawnSync('flock',['-w',String(STATE_LOCK_WAIT_SECONDS),'-E','75','8'],{stdio:['ignore','ignore','pipe',null,null,null,null,null,fd],encoding:'utf8'});
  }catch(error){closeSync(fd);throw error;}
  if(locked.status===0)return()=>closeSync(fd);
  closeSync(fd);if(locked.status===75)return null;
  throw Error(`cannot lock ${file}: ${locked.error?.message??(locked.stderr.trim()||`flock ended ${locked.status??locked.signal}`)}`);
}
// Reentry is synchronous: one owner operation can call another without
// reopening the same flock against itself (for example queue withdrawal).
const held=new Set<string>();
export function withStateLock<T>(key:string,write:()=>T):T{
  const file=resolve(key);if(held.has(file))return write();
  mkdirSync(dirname(file),{recursive:true});
  const unlock=lockStateFile(file);if(!unlock)throw Error(`${file} stayed locked for ${STATE_LOCK_WAIT_SECONDS} s`);
  held.add(file);try{return write();}finally{held.delete(file);unlock();}
}
export function withStateWrite<T>(file:string,supported:number,write:()=>T,lock=file):T{
  return withStateLock(lock,()=>{assertWritableState(file,supported);return write();});
}
export function versionedRecord(file:string,supported:number,value:unknown,lock=file):void{
  withStateWrite(file,supported,()=>{assertStateVersion(value,supported,file);durableRecord(file,value);},lock);
}
