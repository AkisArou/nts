// Cancellation delivery is independent of service and host-tool preparation.
import {watch} from 'node:fs';
import {join} from 'node:path';
import type {Queue} from './queue.ts';

/** Only this reason means a requested withdrawal; a broken watcher is an
 * instrument failure and must never authorize a withdrawn answer. */
export class WithdrawalRequested extends Error {
  readonly id:string;
  constructor(id:string){super(`withdrawal requested for ${id}`);this.id=id;}
}

/** One service-owned watch, armed before taking any entry. Subscribing then
 * re-reading the durable marker closes both the startup and subscription race.
 * Watch setup/error failures are loud; cancellation never depends on a timer. */
export class WithdrawalWatch {
  private readonly entries=new Map<string,{controller:AbortController;marker?:string;generation:number;seen:number;wake?:()=>void}>();
  private failure:Error|undefined;
  private readonly watcher:ReturnType<typeof watch>;
  private readonly queue:Queue;
  private readonly onFailure:(error:Error)=>void;
  constructor(queue:Queue,onFailure:(error:Error)=>void=()=>{}){
    this.queue=queue;this.onFailure=onFailure;
    try{this.watcher=watch(join(queue.home,'withdraw'),()=>{try{this.refresh();}catch(error){this.failed(error);}});}
    catch(error){throw new Error(`landing withdrawal watcher could not start in ${join(queue.home,'withdraw')}: ${String(error)}`,{cause:error});}
    this.watcher.on('error',error=>this.failed(error));
  }
  private failed(error:unknown):void{
    if(this.failure)return;
    this.failure=new Error(`landing withdrawal watcher failed: ${String(error)}`,{cause:error});
    this.watcher.close();
    // Watch failure grants no cancellation authority over healthy work.
    // Existing cancellation recovery may wake and report the failed watch;
    // ordinary checks retain their own verdict and the publication fence.
    for(const entry of this.entries.values())entry.wake?.();
    this.onFailure(this.failure);
  }
  get error():Error|undefined{return this.failure;}
  assertHealthy():void{if(this.failure)throw this.failure;}
  private refresh():void{
    for(const [id,entry] of this.entries){
      const marker=this.queue.withdrawalMarker(id);
      if(marker===undefined||marker===entry.marker)continue;
      const first=!entry.controller.signal.aborted;
      entry.marker=marker;entry.generation++;if(first)entry.seen=entry.generation;
      entry.controller.abort(new WithdrawalRequested(id));entry.wake?.();
    }
  }
  entry(id:string):{signal:AbortSignal;waitForRetry:()=>Promise<void>;close:()=>void}{
    this.assertHealthy();
    if(this.entries.has(id))throw Error(`withdrawal watch already owns ${id}`);
    const controller=new AbortController(),entry:{controller:AbortController;marker?:string;generation:number;seen:number;wake?:()=>void}={controller,generation:0,seen:0};this.entries.set(id,entry);
    this.refresh();
    entry.seen=entry.generation;
    return {signal:controller.signal,waitForRetry:async()=>{
      this.assertHealthy();
      if(entry.seen===entry.generation)await new Promise<void>(resolve=>{entry.wake=resolve;});
      entry.wake=undefined;this.assertHealthy();entry.seen=entry.generation;
    },close:()=>{this.entries.delete(id);}};
  }
  close():void{this.watcher.close();}
}
/** The production service's source-owned watch capability. */
export const createWithdrawalWatch=(queue:Queue,onFailure:(error:Error)=>void)=>new WithdrawalWatch(queue,onFailure);

