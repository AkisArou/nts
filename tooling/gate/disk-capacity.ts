import {GateResource} from './gate-resource.ts';
import {ClaimReceipt,GitReceipt,PoolMembershipReceipt} from './disk-preparation.ts';
import {TreePin} from '../landing/tree-pin.ts';
import type {DiskIntent} from './disk-transaction.ts';
import {DiskTransactions,DiskState,DiskIntentBusy,overlaps,type DiskTransaction} from './disk-transaction.ts';
import {gitArguments} from "./git-arguments/main.ts";
// One capacity equation for pool leases and temporary admission. Git owns a
// lease; declared build outputs consume its measured promise. No folder size
// outside those outputs, and no free checkout, enters that promise.
// The configured pool outputs and capture temporaries share one filesystem;
// this capacity namespace accounts all temporary claims against that disk.
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {worktrees,type Git} from '../landing/git.ts';
import {processCgroup} from '../landing/tree-users.ts';
import {workerPresence} from '../landing/pool-presence.ts';
import {processIdentity,LockWaitError} from '../landing/lock.ts';
import {FIXTURE_ENVIRONMENT} from './cache-capabilities.ts';
import {completedBuild,type BuildOutputName} from './build-completion.ts';
import {hostObservations,type HostObservations} from './host-observations.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {TEMP_DISK_FLOOR_BYTES} from './run-temporary.ts';
import {assertStateVersion,assertWritableState} from './state-version.ts';
import {durableRecord} from './durable-record.ts';
import {describeReclamation,reclaimDisk,liveReclaimOwnership,type ReclaimReport,type ReclaimTarget,type ReclaimOwnership} from './disk-reclamation.ts';
import {declaredTargets,readKeep} from '../full-check/keep.ts';
import {DiskBuildAdmissionError,ToolingInstrumentError} from '../differential/command-entry/instrument.ts';

export const DISK_CAPACITY='NTS_DISK_CAPACITY';
/** A build's admission, handed by the owner that admitted it to the command
 * that does the build, so one build is admitted once (#951). Only its owner
 * sets it; a launcher's never reaches a new owner. */
export const DISK_BUILD_ADMISSION='NTS_DISK_BUILD_ADMISSION';
export const BUILD_FOOTPRINT_FILE=new URL('../../results/builds/cold-inner.json',import.meta.url);
export type BuildForecast={bytes:number;outputs:Record<BuildOutputName,number>;source:string};
export type BuildLease={root:string;target:string;outputs?:readonly BuildOutputName[]};
type BuildClaim=BuildLease&{id:string;pid:number;identity:string};
/** Ends the admission (its owner's only; a handed one ends with its owner), and
 * the variables that hand it to the build's command. */
export type BuildAdmission=(()=>void)&{readonly env:Readonly<Record<typeof DISK_BUILD_ADMISSION,string>>};
type BuildClaims={version:1;claims:BuildClaim[]};
export type TemporaryDiskClaim={id:string;pid:number;identity:string;path:string;bytes:number};
type TemporaryDiskClaims={version:1;claims:TemporaryDiskClaim[]};
export type TemporaryDiskLease=Readonly<TemporaryDiskClaim>&{release():void};
/** What holds the disk a waiting request needs: a build's remaining promise,
 * by its tree's root, or another temporary claim, by its path. */
export type DiskHolder={kind:'build'|'temporary';path:string;bytes:number};
/** A temporary request that waits for its bytes (TemporaryAdmission.acquire):
 * its owner by birth identity and cgroup, what it is, since when, and the
 * capacity it last saw. A record whose owner is gone has expired. */
export type TemporaryDiskWait={id:string;pid:number;identity:string;cgroup:string;path:string;bytes:number;what:string;since:string;
  freeBytes:number;floorBytes:number;holders:DiskHolder[]};
type TemporaryDiskWaits={version:1;waits:TemporaryDiskWait[]};
/** The live record of one waiting request; `end` removes it, once. */
export type DiskWaitRecord={readonly id:string;update(snapshot:CapacitySnapshot):void;end():void};
export type CapacitySnapshot={freeBytes:number;floorBytes:number;reservedBytes:number;buildReservedBytes:number;temporaryReservedBytes:number;availableBytes:number;
  temporaries:TemporaryDiskClaim[];
  fencedBy?:DiskIntent;
  leases:{root:string;remainingBytes:number;outputs:{name:BuildOutputName;allocatedBytes:number;remainingBytes:number;complete:boolean}[]}[]};
export type PoolCapacitySource={dir:string;git:Git};

export function coldBuildForecast(file:URL|string=BUILD_FOOTPRINT_FILE):BuildForecast {
  const row=JSON.parse(readFileSync(file,'utf8')) as {version:number;kind:string;source:string;peakAllocatedBytes:number;samples:{outputs:Record<BuildOutputName,number>}[]};
  assertStateVersion(row,1,String(file));
  if(row.version!==1||row.kind!=='cold-inner'||!row.source||!row.samples.length)throw Error('invalid measured cold build footprint: '+String(file));
  const outputs=Object.fromEntries((['nts-dev','clippy'] as const).map(name=>[name,Math.max(...row.samples.map(sample=>sample.outputs[name]))])) as Record<BuildOutputName,number>;
  if(Object.values(outputs).some(bytes=>!Number.isSafeInteger(bytes)||bytes<=0)||!Number.isSafeInteger(row.peakAllocatedBytes)||row.peakAllocatedBytes<=0)throw Error('invalid measured cold build byte count: '+String(file));
  // Preserve the sum of independently observed output peaks, rounded once.
  const bytes=Math.ceil(Object.values(outputs).reduce((sum,n)=>sum+n,0)/2**30)*2**30;
  return {bytes,outputs,source:row.source};
}

function poolSource(env:NodeJS.ProcessEnv):PoolCapacitySource|null {
  const packet=env[DISK_CAPACITY];
  if(packet!==undefined){
    const row=JSON.parse(readFileSync(packet,'utf8')) as {version:number;pool: {dir:string;root:string}|null};
    assertStateVersion(row,1,packet);
    if(row.version!==1||!('pool' in row))throw Error('invalid disk capacity capability: '+packet);
    return row.pool===null?null:{dir:resolve(row.pool.dir),git:{root:row.pool.root,env}};
  }
  if(env[FIXTURE_ENVIRONMENT]!==undefined)throw Error('fixture has no '+DISK_CAPACITY+' capability');
  return {dir:join(homedir(),'.cache/nts-pool'),git:{root:fileURLToPath(new URL('../..',import.meta.url)),env}};
}

const gib=(bytes:number)=>(bytes/2**30).toFixed(1)+' GiB';
/** What holds the disk in a snapshot, largest first. */
export function diskHolders(snapshot:CapacitySnapshot):DiskHolder[]{
  return [...snapshot.leases.filter(row=>row.remainingBytes>0).map(row=>({kind:'build' as const,path:row.root,bytes:row.remainingBytes})),
    ...snapshot.temporaries.map(claim=>({kind:'temporary' as const,path:claim.path,bytes:claim.bytes}))].sort((a,b)=>b.bytes-a.bytes||a.path.localeCompare(b.path));
}
/** A waiting request in words: what it needs, what is free, and who holds the rest. */
export function describeDiskWait(wait:Pick<TemporaryDiskWait,'what'|'bytes'|'freeBytes'|'floorBytes'|'holders'>):string{
  const of=(kind:DiskHolder['kind'])=>wait.holders.filter(holder=>holder.kind===kind);
  const listed=(kind:DiskHolder['kind'],label:string)=>{const rows=of(kind),sum=rows.reduce((total,row)=>total+row.bytes,0);
    return gib(sum)+' '+label+(rows.length?' ('+rows.map(row=>row.path+' '+gib(row.bytes)).join(', ')+')':'');};
  return `${wait.what} waits for ${gib(wait.bytes)} of disk above the ${gib(wait.floorBytes)} floor: ${gib(wait.freeBytes)} free, `
    +`${listed('build','promised to builds')}, ${listed('temporary','to temporaries')}`;
}

export class DiskCapacity {
  readonly host:HostObservations;readonly forecast:BuildForecast;readonly pool:PoolCapacitySource|null;readonly stateFile:string;readonly temporaryStateFile:string;readonly waitStateFile:string;
  private readonly reclamation:{services:readonly ReclaimTarget[];ownership:ReclaimOwnership};
  private readonly handed:string|undefined;
  private readonly lockWaitMs:number;
  readonly transactions:DiskTransactions;
  readonly state:DiskState;
  private poolOperationActive=false;
  private readonly poolIntents=new Map<string,DiskIntent>();
  private readonly poolReleases:(()=>void)[]=[];
  constructor(options:{env?:NodeJS.ProcessEnv;host?:HostObservations;forecast?:BuildForecast;pool?:PoolCapacitySource|null;
    reclamation?:{services:readonly ReclaimTarget[];ownership:ReclaimOwnership};lockWaitMs?:number;observeTransaction?:(row:DiskTransaction)=>void}={}){
    const env=options.env??process.env;
    this.handed=env[DISK_BUILD_ADMISSION];this.lockWaitMs=options.lockWaitMs??30_000;
    if(env[FIXTURE_ENVIRONMENT]!==undefined&&env[DISK_CAPACITY]===undefined)throw Error('fixture has no '+DISK_CAPACITY+' capability');
    this.host=options.host??hostObservations(env);this.forecast=options.forecast??coldBuildForecast();
    this.pool=options.pool===undefined?poolSource(env):options.pool;
    this.stateFile=this.pool?join(this.pool.dir,'.disk-builds.json'):env[DISK_CAPACITY]?env[DISK_CAPACITY]+'.builds.json':join(homedir(),'.cache/nts-pool/.disk-builds.json');
    // A private/fixture pool cannot discover the account's service trees.
    const services=this.pool?.dir===join(homedir(),'.cache/nts-pool')&&env[FIXTURE_ENVIRONMENT]===undefined
      ? declaredTargets(join(homedir(),'.cache'),Object.fromEntries(Object.entries(readKeep()).filter(([,rule])=>rule.kind!=='pool')))
        .map(row=>({...row,service:true})):[];
    this.reclamation=options.reclamation??{services,ownership:liveReclaimOwnership};
    // Older build owners retain their own schema and cannot overwrite a
    // temporary claim. Both files are governed by the same capacity lock.
    this.temporaryStateFile=this.stateFile+'.temporaries.json';
    // Waiting requests hold no bytes, so no claim reader ever sees them.
    this.waitStateFile=this.stateFile+'.waits.json';
    this.transactions=new DiskTransactions(join(this.pool?.dir??dirname(this.stateFile),this.pool?'.lock':'.disk-lock'),this.host,options.observeTransaction);
    this.state=new DiskState(this.transactions,()=>this.signalChange());
  }
  /** A wake hint only. Readiness always re-runs the complete capacity equation. */
  get changesFile():string{return this.stateFile+'.changed.json';}
  signalChange():void{
    mkdirSync(dirname(this.changesFile),{recursive:true});
    assertWritableState(this.changesFile,1);
    durableRecord(this.changesFile,{version:1,event:randomUUID()});
  }
  private prepared<T,R>(operation:string,root:string,observe:()=>T,publish:(value:T)=>R,gitLeases:readonly BuildLease[]=[]):R{
    let git:GitReceipt[]=[],membership:PoolMembershipReceipt|undefined;
    return this.state.prepared(operation,root,()=>{
      const claims=this.claimReceipt();
      // A concurrent legacy mutation can make an outside Git question fail.
      // Validate its receipts before deciding whether that error is current.
      try{return {claims,git,outcome:{ok:true as const,value:observe()}};}
      catch(error){return {claims,git,outcome:{ok:false as const,error}};}
    },prepared=>{
      if(!prepared.outcome.ok)throw prepared.outcome.error;
      return publish(prepared.outcome.value);
    },this.lockWaitMs,{
      capture:()=>{
        const capture=()=>{
          membership=this.pool?new PoolMembershipReceipt(this.pool.git.root):undefined;
          const registrations=membership?.registrations(this.pool!.dir)??[],requests=new Map(gitLeases.map(lease=>[resolve(lease.root),lease]));
          git=[...registrations.filter(row=>!requests.has(row.root)).map(row=>new GitReceipt(row.root,[],'lease',row)),
            ...[...requests.values()].map(lease=>new GitReceipt(lease.root,(lease.outputs??['nts-dev','clippy']).map(name=>join(lease.target,name,'.nts-complete.json'))))];
          return membership?.entryCount??0;
        };
        if(this.pool)this.transactions.measure('pool-membership-capture',capture,entries=>entries);else capture();
      },
      validate:prepared=>prepared.claims.valid()&&(membership?this.transactions.measure('pool-membership-recheck',()=>{
        const seen=membership!.recheck();return {...seen,valid:seen.valid&&prepared.git.every(receipt=>receipt.valid())};
      },row=>row.entries).valid:prepared.git.every(receipt=>receipt.valid())),
      dispose:prepared=>prepared.claims.close(),
    });
  }
  claimReceipt():ClaimReceipt{return new ClaimReceipt([this.stateFile,this.temporaryStateFile]);}
  private fence(root:string):DiskIntent|undefined{return this.state.liveIntents().find(intent=>![...this.poolIntents.values()].some(own=>own.id===intent.id)&&overlaps(intent.root,root));}
  /** Pool work has a nonwaiting owner; only a selected tree gets an intent. */
  poolOperation<T>(body:()=>T,busy:()=>never):T{
    if(!this.pool)throw Error('pool operation has no pool');
    mkdirSync(this.pool.dir,{recursive:true});
    const owner=GateResource.tryAcquire(join(this.pool.dir,'.operations.lock'));if(!owner)return busy();
    try{
      this.poolOperationActive=true;
      try{return body();}
      catch(error){if(error instanceof DiskIntentBusy)return busy();throw error;}
      finally{
        try{for(const release of this.poolReleases.splice(0))release();}
        finally{this.poolOperationActive=false;this.signalChange();}
      }
    }finally{owner.close();}
  }
  /** Select the changed tree before publishing any fence. Other trees' old
   * and prospective leases remain capacity promises, never fence roots. */
  poolTarget<T>(tree:string,body:()=>T):T{
    if(!this.poolOperationActive)throw Error('pool target has no operation owner');
    tree=resolve(tree);
    if(!this.pool||dirname(tree)!==resolve(this.pool.dir)||!/^[1-9][0-9]*$/.test(tree.slice(resolve(this.pool.dir).length+1)))throw Error('pool operation target is not a selected slot: '+tree);
    if(this.poolIntents.has(tree))return body();
    const leases=this.activeLeases().filter(lease=>overlaps(tree,lease.root));
    const intent=this.state.begin(tree,'pool-operation',this.lockWaitMs,leases);
    this.poolIntents.set(tree,intent);
    try{return body();}
    finally{try{this.state.end(intent,this.lockWaitMs);}finally{this.poolIntents.delete(tree);}}
  }
  protectPoolLease(lease:BuildLease):void{
    const intent=[...this.poolIntents.values()].find(intent=>overlaps(intent.root,lease.root));
    if(!intent)throw Error('pool lease has no selected-tree intent');
    this.state.protect(intent,lease);
  }
  admitPoolLease(lease:BuildLease):void{this.poolReleases.push(this.beginBuild(lease));}
  private current(snapshot:CapacitySnapshot,path:string):CapacitySnapshot{
    const freeBytes=this.host.disk(path).freeBytes;
    if(!Number.isSafeInteger(freeBytes)||freeBytes<0)throw Error('disk free bytes were not measured: '+path);
    return {...snapshot,freeBytes,availableBytes:freeBytes-snapshot.floorBytes-snapshot.reservedBytes};
  }
  private claims():BuildClaim[]{
    if(!existsSync(this.stateFile))return [];
    const row=JSON.parse(readFileSync(this.stateFile,'utf8')) as BuildClaims;
    assertStateVersion(row,1,this.stateFile);
    if(row.version!==1||!Array.isArray(row.claims))throw Error('invalid disk build claims: '+this.stateFile);
    return row.claims.filter(claim=>Number.isSafeInteger(claim.pid)&&claim.identity===processIdentity(claim.pid));
  }
  private record(claims:BuildClaim[]):void{
    assertWritableState(this.stateFile,1);durableRecord(this.stateFile,{version:1,claims});
  }
  private temporaryClaims():TemporaryDiskClaim[]{
    if(!existsSync(this.temporaryStateFile))return [];
    const row=JSON.parse(readFileSync(this.temporaryStateFile,'utf8')) as TemporaryDiskClaims;
    assertStateVersion(row,1,this.temporaryStateFile);
    if(row.version!==1||!Array.isArray(row.claims))throw Error('invalid temporary disk claims: '+this.temporaryStateFile);
    const ids=new Set<string>();
    for(const claim of row.claims){
      if(!claim||typeof claim.id!=='string'||!claim.id||ids.has(claim.id)||!Number.isSafeInteger(claim.pid)||claim.pid<=0
        ||typeof claim.identity!=='string'||!claim.identity||typeof claim.path!=='string'||!claim.path||resolve(claim.path)!==claim.path
        ||!Number.isSafeInteger(claim.bytes)||claim.bytes<=0)throw Error('invalid temporary disk claim: '+this.temporaryStateFile);
      ids.add(claim.id);
    }
    return row.claims.filter(claim=>claim.identity===processIdentity(claim.pid));
  }
  private recordTemporaries(claims:TemporaryDiskClaim[]):void{
    assertWritableState(this.temporaryStateFile,1);durableRecord(this.temporaryStateFile,{version:1,claims});
  }
  /** The live waiting temporary requests. The file is published whole, so a
   * reader needs no lock; a record whose owner is proven gone has expired,
   * and an owner that cannot be observed is a host fault (processIdentity). */
  diskWaits():TemporaryDiskWait[]{
    if(!existsSync(this.waitStateFile))return [];
    const row=JSON.parse(readFileSync(this.waitStateFile,'utf8')) as TemporaryDiskWaits;
    assertStateVersion(row,1,this.waitStateFile);
    if(row.version!==1||!Array.isArray(row.waits))throw Error('invalid temporary disk waits: '+this.waitStateFile);
    const bytes=(value:unknown)=>Number.isSafeInteger(value)&&(value as number)>=0;
    for(const wait of row.waits){
      if(!wait||typeof wait.id!=='string'||!wait.id||!Number.isSafeInteger(wait.pid)||wait.pid<=0||typeof wait.identity!=='string'||!wait.identity
        ||typeof wait.cgroup!=='string'||!wait.cgroup.startsWith('/')||typeof wait.path!=='string'||resolve(wait.path)!==wait.path||!bytes(wait.bytes)||wait.bytes===0
        ||typeof wait.what!=='string'||!wait.what||!Number.isFinite(Date.parse(wait.since))||!bytes(wait.freeBytes)||!bytes(wait.floorBytes)||!Array.isArray(wait.holders)
        ||wait.holders.some(holder=>!holder||(holder.kind!=='build'&&holder.kind!=='temporary')||typeof holder.path!=='string'||!bytes(holder.bytes)))
        throw Error('invalid temporary disk wait: '+this.waitStateFile);
    }
    return row.waits.filter(wait=>wait.identity===processIdentity(wait.pid));
  }
  /** Records that this process's temporary request of `bytes` at `path` waits,
   * as `snapshot` refused it. Writes share the capacity lock, so concurrent
   * waiters never lose each other's records. */
  beginWait(what:string,path:string,bytes:number,snapshot:CapacitySnapshot,since:string):DiskWaitRecord{
    const pid=process.pid,identity=processIdentity(pid),id=randomUUID();
    if(!identity)throw Error('temporary disk waiter has no process birth identity');
    const cgroup=processCgroup(pid).split('\n').find(line=>line.startsWith('0::'))?.slice(3);
    if(!cgroup)throw Error('temporary disk waiter has no unified cgroup');
    const of=(seen:CapacitySnapshot):TemporaryDiskWait=>({id,pid,identity,cgroup,path:resolve(path),bytes,what,since,freeBytes:seen.freeBytes,floorBytes:seen.floorBytes,holders:diskHolders(seen)});
    // Expired records are dropped with every write.
    const store=(next:TemporaryDiskWait|null)=>{
      const waits=this.diskWaits().filter(wait=>wait.id!==id);
      assertWritableState(this.waitStateFile,1);durableRecord(this.waitStateFile,{version:1,waits:next?[...waits,next]:waits});
    };
    this.transactions.run('disk-wait-publish',path,()=>store(of(snapshot)),this.lockWaitMs);
    let ended=false;
    return {id,
      update:seen=>{if(!ended)this.transactions.run('disk-wait-publish',path,()=>store(of(seen)),this.lockWaitMs);},
      end:()=>{if(ended)return;ended=true;this.releaseClaim(()=>store(null));}};
  }
  activeLeases():BuildLease[]{
    if(!this.pool||!existsSync(this.pool.dir))return [];
    const {dir,git}=this.pool;
    const refs=infrastructureProbe({purpose:'read landed disk lease owners',command:'git',args:gitArguments(['for-each-ref','--format=%(objectname) %(refname)','refs/nts/landed/']),cwd:git.root,...(git.env?{env:git.env}:{})}).stdout;
    const landed=new Map(refs.trim().split('\n').filter(Boolean).map(line=>{const [sha,ref]=line.split(' ');return [ref!.slice('refs/nts/landed/'.length),sha!];}));
    return worktrees(git).filter(tree=>dirname(resolve(tree.path))===resolve(dir)&&/^[1-9][0-9]*$/.test(tree.path.split('/').at(-1)!)
      &&tree.branch!==null&&landed.get(tree.branch)!==tree.head&&workerPresence(tree.path,tree.branch).state==='attached').map(tree=>({root:tree.path,target:join(tree.path,'target')}));
  }
  /** Caller holds a pool-operation intent. Detach never overrides a live build,
   * temporary claim, unit, or process (including ledger owners and waiters). */
  assertWorkerAbsent(tree:string,ownPin?:TreePin):void{
    const pins=TreePin.users(tree,ownPin);if(pins.length)throw Error('live tree pin '+pins[0]!.where+' owns '+tree);
    const under=(a:string,b:string)=>b===a||b.startsWith(a+'/');
    for(const claim of this.claims())if([claim.root,claim.target].some(path=>under(resolve(tree),resolve(path))||under(resolve(path),resolve(tree))))
      throw Error('live build claim '+claim.id+' by pid '+claim.pid+' owns '+tree);
    for(const claim of this.temporaryClaims())if(under(resolve(tree),resolve(claim.path))||under(resolve(claim.path),resolve(tree)))
      throw Error('live temporary claim '+claim.id+' by pid '+claim.pid+' owns '+tree);
    this.reclamation.ownership(tree,join(tree,'target'),ownPin);
  }
  snapshot(path:string,leases?:readonly BuildLease[]):CapacitySnapshot {
    if(leases===undefined)return this.prepared("capacity-snapshot",path,()=>this.snapshot(path,[...this.activeLeases(),...this.claims()]),snapshot=>this.current(snapshot,path));
    const merged=new Map<string,BuildLease>();
    for(const lease of [...leases,...this.state.liveIntents().flatMap(intent=>intent.leases??[])]){const key=resolve(lease.target),previous=merged.get(key);merged.set(key,{...lease,target:key,
      outputs:[...new Set([...(previous?.outputs??[]),...(lease.outputs??['nts-dev','clippy'])])]});}
    const rows=[...merged.values()].map(lease=>{
      const outputs=lease.outputs!.map(name=>{
        const output=join(lease.target,name),complete=completedBuild(lease.root,name,output);
        const allocatedBytes=this.host.allocatedBytes(output);
        return {name,allocatedBytes,complete,remainingBytes:complete?0:Math.max(0,this.forecast.outputs[name]-allocatedBytes)};
      });
      const raw=outputs.reduce((sum,output)=>sum+output.remainingBytes,0);
      // The rounding margin is consumed with the build, never held after both
      // owners completed. Partial allocations reduce the promise immediately.
      const measured=lease.outputs!.reduce((sum,name)=>sum+this.forecast.outputs[name],0);
      const rounded=Math.ceil(measured/2**30)*2**30;
      const margin=outputs.every(output=>output.complete)?0:rounded-measured;
      return {root:lease.root,outputs,remainingBytes:raw?raw+margin:0};
    });
    const freeBytes=this.host.disk(path).freeBytes,temporaries=this.temporaryClaims();
    const buildReservedBytes=rows.reduce((sum,row)=>sum+row.remainingBytes,0),temporaryReservedBytes=temporaries.reduce((sum,row)=>sum+row.bytes,0),reservedBytes=buildReservedBytes+temporaryReservedBytes;
    if(!Number.isSafeInteger(freeBytes)||freeBytes<0||!Number.isSafeInteger(reservedBytes))throw Error('disk capacity bytes were not measured: '+path);
    return {freeBytes,floorBytes:TEMP_DISK_FLOOR_BYTES,reservedBytes,buildReservedBytes,temporaryReservedBytes,temporaries,
      availableBytes:freeBytes-TEMP_DISK_FLOOR_BYTES-reservedBytes,leases:rows};
  }
  /** The check and durable claim share the pool/build capacity lock. A denied
   * attempt owns nothing; every successful attempt has its own release. */
  tryTemporary(path:string,bytes:number):{snapshot:CapacitySnapshot;lease:TemporaryDiskLease|null}{
    if(!path||!Number.isSafeInteger(bytes)||bytes<=0)throw Error('invalid temporary disk reservation');
    const pid=process.pid,identity=processIdentity(pid),id=randomUUID();path=resolve(path);
    if(!identity)throw Error('temporary disk owner has no process birth identity');
    this.reclaim(path,bytes);
    return this.prepared("temporary-admission",path,()=>this.snapshot(path,[...this.activeLeases(),...this.claims()]),seen=>{
      const snapshot=this.current(seen,path);
      if(this.fence(path)||snapshot.availableBytes<bytes)return {snapshot,lease:null};
      const claim:TemporaryDiskClaim={id,pid,identity,path,bytes};
      this.state.advance();this.recordTemporaries([...snapshot.temporaries,claim]);
      let released=false;
      const release=()=>{if(released)return;this.releaseClaim(()=>{
        const claims=this.temporaryClaims(),next=claims.filter(row=>row.id!==id);if(next.length===claims.length)return;
        this.state.advance();this.recordTemporaries(next);this.signalChange();
      });released=true;};
      return {snapshot,lease:Object.freeze({...claim,release})};
    });
  }
  /** A service target, or an explicit build outside a pool lease, promises
   * only its declared output. Pool and build claims merge by target, so the
   * same work is never promised twice. A killed builder's identity expires.
   * A build already admitted by the owner that started this command (its
   * DISK_BUILD_ADMISSION) is that owner's: covering this target and outputs,
   * it is not admitted again, since a second admission of the same work
   * refuses a build its owner admitted whenever the disk moves between the
   * two. A handed admission whose owner no longer holds it is an instrument
   * failure, never a fresh admission. */
  beginBuild(lease:BuildLease):BuildAdmission {
    if(this.handed!==undefined){
      const id=this.handed,held=this.transactions.run('build-handoff-read',lease.target,()=>this.claims().find(claim=>claim.id===id),this.lockWaitMs);
      if(!held)throw new ToolingInstrumentError('tooling-setup',`disk build admission ${id} is not held by a live build owner`);
      if(resolve(held.target)===resolve(lease.target)&&(lease.outputs??['nts-dev','clippy']).every(name=>(held.outputs??['nts-dev','clippy']).includes(name)))
        return Object.assign(()=>{},{env:{[DISK_BUILD_ADMISSION]:id}});
    }
    const id=randomUUID(),pid=process.pid,identity=processIdentity(pid);
    if(!identity)throw Error('disk build owner has no process birth identity');
    const next={...lease,id,pid,identity};
    const reclamation=this.reclaim(lease.target,0,undefined,[next]);
    this.prepared("build-admission",lease.target,()=>{const claims=this.claims();return {claims,snapshot:this.snapshot(lease.target,[...this.activeLeases(),...claims,next])};},({claims,snapshot:seen})=>{
      const snapshot=this.current(seen,lease.target);
      const request={root:resolve(lease.root),target:resolve(lease.target),outputs:[...(lease.outputs??['nts-dev','clippy'])]};
      const fence=this.fence(lease.target);
      if(fence)throw new DiskBuildAdmissionError({...request,kind:'target-fenced',intent:{token:fence.id,root:fence.root,pid:fence.pid,identity:fence.identity}},describeReclamation(reclamation));
      if(snapshot.availableBytes<0)throw new DiskBuildAdmissionError({...request,kind:'shortfall',
        shortBytes:-snapshot.availableBytes,freeBytes:snapshot.freeBytes,floorBytes:snapshot.floorBytes,buildReservedBytes:snapshot.buildReservedBytes,temporaryReservedBytes:snapshot.temporaryReservedBytes},describeReclamation(reclamation));
      this.state.advance();this.record([...claims,next]);
    },[lease]);
    let released=false;
    const release=()=>{if(released)return;this.releaseClaim(()=>{
      const claims=this.claims(),next=claims.filter(claim=>claim.id!==id);if(next.length===claims.length)return;
      this.state.advance();this.record(next);this.signalChange();
    });released=true;};
    return Object.assign(release,{env:{[DISK_BUILD_ADMISSION]:id}});
  }
  /** Read-only retry readiness: no build attempt, claim, or reclamation. */
  buildSnapshot(lease:BuildLease):CapacitySnapshot{
    return this.prepared("build-readiness",lease.target,()=>this.snapshot(lease.target,[...this.activeLeases(),...this.claims(),lease]),seen=>{const snapshot=this.current(seen,lease.target);const fencedBy=this.fence(lease.target);return fencedBy?{...snapshot,fencedBy}:snapshot;},[lease]);
  }
  /** A pool observation for display/preflight; grants use beginBuild. */
  poolSnapshot(path:string,leases:readonly BuildLease[]):CapacitySnapshot{return this.snapshot(path,[...leases,...this.claims()]);}
  /** A finished build must not become a failed step because cleanup met a
   * busy pool. The durable claim remains conservative until its birth expires. */
  private releaseClaim(body:()=>void):void{
    try{this.transactions.run("claim-release",this.stateFile,body,this.lockWaitMs,{completeOnClockFailure:true});}catch(error){
      if(!(error instanceof LockWaitError))throw error;
      console.error('disk claim release deferred until owner exit: '+error.message);
    }
  }
  /** Reclaim outside admission's transaction. Every subsequent grant rechecks
   * current promises and actual free bytes under the capacity lock. Pending
   * leases protect the prospective target throughout reclamation. */
  reclaim(path:string,extraReservedBytes=0,maintenance?:{before:number;keep:number},pending:readonly BuildLease[]=[]):ReclaimReport|null {
    if(!this.pool)return null;
    try{return reclaimDisk({pool:this.pool,host:this.host,coldBytes:this.forecast.bytes,...this.reclamation,maintenance,
      // Trash discovery/finalization observes or retires owner metadata. It
      // must not invalidate a preparation merely by inspecting that owner's
      // trash; reclamation advances the generation at its actual detach.
      locked:(body,operation='reclaim-metadata',root=this.pool!.dir)=>this.transactions.run(operation,root,body,this.lockWaitMs),state:this.state,
      claimReceipt:()=>this.claimReceipt(),
      snapshot:()=>{const snapshot=this.snapshot(path,[...this.activeLeases(),...this.claims(),...pending]);return {...snapshot,reservedBytes:snapshot.reservedBytes+extraReservedBytes};},
      protectedRoots:()=>[...this.activeLeases(),...this.claims(),...pending,...this.temporaryClaims().map(claim=>({root:claim.path,target:claim.path}))]});
    }finally{this.signalChange();}
  }
}
