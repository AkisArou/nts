// Events carry no admission authority: every wake re-reads DiskCapacity.
import {mkdirSync,watch} from 'node:fs';
import {basename,dirname,join} from 'node:path';
import type {DiskCapacity} from '../gate/disk-capacity.ts';

/** One joined service lifetime, with no polling or reservation while idle. */
export class DiskReadinessWake{
  private readonly watchers:ReturnType<typeof watch>[]=[];
  private generation=0;private seen=-1;private capacity=true;
  private failure:Error|undefined;private wake:(()=>void)|undefined;
  constructor(home:string,capacity:DiskCapacity){
    const changed=(disk:boolean)=>{this.capacity||=disk;this.generation++;this.wake?.();};
    const failed=(error:unknown)=>{this.failure??=new Error('landing disk readiness watch failed: '+String(error),{cause:error});this.generation++;this.wake?.();};
    const add=(directory:string,onChange:(name:string|null)=>void)=>{
      mkdirSync(directory,{recursive:true});
      const watcher=watch(directory,(_event,name)=>onChange(name===null?null:String(name)));
      watcher.on('error',failed);this.watchers.push(watcher);
    };
    try{
      add(join(home,'queue'),()=>changed(false));
      add(join(home,'held'),()=>changed(false));
      add(join(home,'withdraw'),()=>changed(false));
      const names=new Set([capacity.stateFile,capacity.temporaryStateFile,capacity.changesFile].map(file=>basename(file)));
      add(dirname(capacity.stateFile),name=>{if(name===null||names.has(name))changed(true);});
    }catch(error){this.close();throw new Error('landing disk readiness watch could not start: '+String(error),{cause:error});}
  }
  /** Arm-before-read closes both startup and event coalescing races. */
  checkpoint():boolean{
    if(this.failure)throw this.failure;
    this.seen=this.generation;const changed=this.capacity;this.capacity=false;return changed;
  }
  async wait():Promise<void>{
    if(this.failure)throw this.failure;
    if(this.seen!==this.generation)return;
    await new Promise<void>(done=>{this.wake=done;});this.wake=undefined;
    if(this.failure)throw this.failure;
  }
  close():void{for(const watcher of this.watchers)watcher.close();this.watchers.length=0;this.wake?.();}
}
