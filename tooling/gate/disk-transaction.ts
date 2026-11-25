// Advisory observations only. Neither admission nor reclamation reads these
// records for a decision. Broken sidecar/history writes never break their owner;
// required clock errors fail by name, after a release mutation has completed.
import {appendFileSync,mkdirSync,readFileSync,renameSync,writeFileSync,rmSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {holder,processIdentity,withLock,LockWaitError} from '../landing/lock.ts';
import {processCgroup} from '../landing/tree-users.ts';
import type {HostObservations} from './host-observations.ts';
import {existsSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {durableRecord} from './durable-record.ts';
import {assertStateVersion} from './state-version.ts';

export type DiskPhase={phase:string;entries:number;lockHeldMs:number};
type Preparation={id:string;attempt:number;retries:number;invalidation?:'generation'|'receipt';observationMs?:number};
type PreparationProgress=Preparation&{startedMs:number};
export type DiskTransaction={pid:number;identity:string;unit:string;operation:string;root:string;phase:string;
  lockHeldMs:number;maximumLockHeldMs:number;status:'completed'|'failed';phases?:DiskPhase[];preparation?:Preparation&{elapsedMs:number}};
type Owner=Pick<DiskTransaction,'pid'|'identity'|'unit'>;
export class DiskTransactions {
  private maximum=0;private total=0;
  private phases:DiskPhase[]|undefined;
  get maximumLockHeldMs():number{return this.maximum;}
  get totalLockHeldMs():number{return this.total;}
  private readonly owner:Owner;
  readonly path:string;readonly clock:Pick<HostObservations,'now'>;readonly observe:((row:DiskTransaction)=>void)|undefined;
  constructor(path:string,clock:Pick<HostObservations,'now'>,observe?:(row:DiskTransaction)=>void){
    this.path=path;this.clock=clock;this.observe=observe;
    const pid=process.pid;
    let identity='',unit='unknown';
    try{identity=processIdentity(pid)??'';}catch{}
    try{unit=processCgroup(pid).split(/[\n/]/).reverse().find(part=>/\.(service|scope)$/.test(part))??'unknown';}catch{}
    this.owner={pid,identity,unit};
  }
  private publish(value:unknown):void{
    const temporary=this.path+'.transaction.'+process.pid+'.'+randomUUID();
    try{writeFileSync(temporary,JSON.stringify(value)+'\n',{flag:'wx'});renameSync(temporary,this.path+'.transaction.json');}
    catch{}finally{try{rmSync(temporary,{force:true});}catch{}}
  }
  /** Component timing belongs to the enclosing transaction, not another
   * acquisition or another contribution to its total hold. */
  measure<T>(phase:string,body:()=>T,entries:(value:T)=>number):T{
    if(!this.phases)throw Error('disk phase has no transaction: '+phase);
    const start=this.clock.now(),value=body();
    this.phases.push({phase,entries:entries(value),lockHeldMs:this.clock.now()-start});return value;
  }
  run<T>(operation:string,root:string,body:()=>T,waitMs=30_000,options:{completeOnClockFailure?:boolean;preparation?:PreparationProgress}={}):T{
    let row:DiskTransaction|undefined;
    let clockFailure:{error:unknown}|undefined;
    const now=():number|undefined=>{
      try{return this.clock.now();}catch(error){
        if(!options.completeOnClockFailure)throw error;
        clockFailure??={error};return undefined;
      }
    };
    try{
      mkdirSync(dirname(this.path),{recursive:true});
      let start:number|undefined,status:DiskTransaction['status']='failed';const phases:DiskPhase[]=[];
      try{
        const result=withLock(this.path,()=>{
          start=now();
          this.publish({...this.owner,operation,root,phase:operation});
          const previous=this.phases;this.phases=phases;
          try{return body();}finally{this.phases=previous;}
        },waitMs);
        status='completed';return result;
      }finally{
        // Include the owner's release work as well as its body, without
        // charging acquisition wait or post-release diagnostics to the hold.
        const end=start===undefined?undefined:now();
        if(start!==undefined&&end!==undefined){
          const lockHeldMs=end-start;this.maximum=Math.max(this.maximum,lockHeldMs);this.total+=lockHeldMs;
          row={...this.owner,operation,root,phase:operation,lockHeldMs,maximumLockHeldMs:this.maximum,status};
          if(phases.length)row.phases=phases;
          if(options.preparation){const {startedMs,...progress}=options.preparation;row.preparation={...progress,elapsedMs:end-startedMs};}
        }
        // A release must finish its mutation and unlock before its diagnostic
        // clock error escapes. Never invent a duration or replace a body error.
        if(status==='completed'&&clockFailure)throw clockFailure.error;
      }
    }catch(error){
      if(error instanceof LockWaitError)error.message+='; '+this.describeHolder();
      throw error;
    }finally{
      // Appending a process's history and the observer run after release.
      if(row){
        try{appendFileSync(this.path+'.transactions.'+process.pid+'.jsonl',JSON.stringify(row)+'\n');}catch{}
        this.observe?.(row);
      }
    }
  }
  describeHolder():string{
    try{
      const row=JSON.parse(readFileSync(this.path+'.transaction.json','utf8')) as Partial<DiskTransaction>;
      if(!Number.isSafeInteger(row.pid)||typeof row.identity!=='string'||!row.identity||
        typeof row.unit!=='string'||typeof row.operation!=='string'||typeof row.root!=='string'||typeof row.phase!=='string')return 'holder phase unknown';
      if(holder(this.path)!==row.pid||processIdentity(row.pid!)!==row.identity)return 'holder phase unknown (stale transaction sidecar)';
      return 'holder transaction '+row.operation+'; root '+row.root+'; phase '+row.phase;
    }catch{return 'holder phase unknown';}
  }
}

export type IntentLease={root:string;target:string;outputs?:readonly ('nts-dev'|'clippy')[]};
export type DiskIntent={id:string;root:string;pid:number;identity:string;operation:string;leases?:readonly IntentLease[]};
export class DiskIntentBusy extends Error {
  constructor(intent:DiskIntent){super('disk target fenced by '+intent.operation+': '+intent.root);}
}
type State={version:1;generation:number;intents:DiskIntent[]};
export const overlaps=(a:string,b:string):boolean=>{
  a=resolve(a);b=resolve(b);return a===b||a.startsWith(b+sep)||b.startsWith(a+sep);
};
/** Authoritative state, unlike the advisory transaction sidecar. All writers
 * bump one monotonic generation even if their changes restore previous bytes. */
export class DiskState {
  readonly transactions:DiskTransactions;
  readonly file:string;private readonly changed:(()=>void)|undefined;
  constructor(transactions:DiskTransactions,changed?:()=>void){this.transactions=transactions;this.file=transactions.path+'.state.json';this.changed=changed;}
  read():State{
    if(!existsSync(this.file))return {version:1,generation:0,intents:[]};
    const row=JSON.parse(readFileSync(this.file,'utf8')) as State;
    assertStateVersion(row,1,this.file);
    if(row.version!==1||!Number.isSafeInteger(row.generation)||row.generation<0||!Array.isArray(row.intents)||row.intents.some(intent=>
      !intent||typeof intent.id!=='string'||!intent.id||typeof intent.root!=='string'||resolve(intent.root)!==intent.root||
      !Number.isSafeInteger(intent.pid)||intent.pid<=0||typeof intent.identity!=='string'||!intent.identity||typeof intent.operation!=='string'||
      intent.leases!==undefined&&(!Array.isArray(intent.leases)||intent.leases.some(lease=>!lease||
        typeof lease.root!=='string'||resolve(lease.root)!==lease.root||typeof lease.target!=='string'||resolve(lease.target)!==lease.target||
        lease.outputs!==undefined&&(!Array.isArray(lease.outputs)||lease.outputs.some((name:unknown)=>name!=='nts-dev'&&name!=='clippy'))))))
      throw Error('invalid disk transaction state: '+this.file);
    return row;
  }
  private write(state:State):void{
    if(state.generation===Number.MAX_SAFE_INTEGER)throw Error('disk transaction generation exhausted');
    durableRecord(this.file,{...state,generation:state.generation+1});
  }
  /** Called immediately before a real capacity mutation, holding the lock. */
  advance():void{this.write(this.read());}
  /** Capture a generation, observe without the lock, then compare-and-publish.
   * Retries perform the expensive observation again, never while locked. */
  prepared<T,R>(operation:string,root:string,observe:()=>T,publish:(value:T)=>R,waitMs=30_000,
    options:{capture?:()=>void;validate?:(value:T)=>boolean;dispose?:(value:T)=>void}={}):R{
    const startedMs=this.transactions.clock.now(),id=randomUUID();let retries=0;
    for(;;){
      const preparation:PreparationProgress={id,startedMs,attempt:retries+1,retries};
      const generation=this.transactions.run(operation+'-capture',root,()=>{options.capture?.();return this.read().generation;},waitMs,{preparation});
      const observationStart=this.transactions.clock.now();
      const value=observe();
      try{
        preparation.observationMs=this.transactions.clock.now()-observationStart;
        const result=this.transactions.run(operation+'-publish',root,()=>{
          const state=this.read();
          if(state.generation!==generation||options.validate&&!options.validate(value)){
            preparation.invalidation=state.generation!==generation?'generation':'receipt';preparation.retries=++retries;
            return {valid:false as const};
          }
          return {valid:true as const,value:publish(value)};
        },waitMs,{preparation});
        if(result.valid)return result.value;
      }finally{options.dispose?.(value);}
    }
  }
  liveIntents():DiskIntent[]{return this.read().intents.filter(intent=>processIdentity(intent.pid)===intent.identity);}
  begin(root:string,operation:string,waitMs=30_000,leases:readonly IntentLease[]=[]):DiskIntent{
    root=resolve(root);
    return this.transactions.run(operation+'-intent-publish',root,()=>{
      const state=this.read(),intents=this.liveIntents();
      const held=intents.find(intent=>overlaps(intent.root,root));
      if(held)throw new DiskIntentBusy(held);
      const intent={id:randomUUID(),root,pid:process.pid,identity:processIdentity(process.pid)!,operation,leases};
      this.write({...state,intents:[...intents,intent]});return intent;
    },waitMs);
  }
  protect(intent:DiskIntent,lease:IntentLease):void{
    const changed=this.transactions.run(intent.operation+'-intent-protect',lease.root,()=>{
      const state=this.read();this.assertIntent(intent);
      const current=state.intents.find(row=>row.id===intent.id)!;
      if(current.leases?.some(row=>row.root===lease.root&&row.target===lease.target&&(lease.outputs??['nts-dev','clippy']).every(name=>(row.outputs??['nts-dev','clippy']).includes(name))))return false;
      this.write({...state,intents:state.intents.map(row=>row.id===intent.id?{...row,leases:[...(row.leases??[]),lease]}:row)});
      return true;
    });
    if(changed)this.changed?.();
  }
  assertIntent(intent:DiskIntent):void{
    if(!this.liveIntents().some(row=>row.id===intent.id&&row.identity===intent.identity&&row.root===intent.root))throw Error('disk intent changed: '+intent.root);
  }
  end(intent:DiskIntent,waitMs=30_000):void{
    const changed=this.transactions.run(intent.operation+'-intent-retire',intent.root,()=>{
      const state=this.read(),intents=state.intents.filter(row=>row.id!==intent.id);if(intents.length===state.intents.length)return false;
      this.write({...state,intents});return true;
    },waitMs);
    if(changed)this.changed?.();
  }
}
