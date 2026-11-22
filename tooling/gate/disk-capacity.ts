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
import {workerPresence} from '../landing/pool-presence.ts';
import {withLock,processIdentity,LockWaitError} from '../landing/lock.ts';
import {FIXTURE_ENVIRONMENT} from './cache-capabilities.ts';
import {completedBuild,type BuildOutputName} from './build-completion.ts';
import {hostObservations,type HostObservations} from './host-observations.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {TEMP_DISK_FLOOR_BYTES} from './run-temporary.ts';
import {assertStateVersion,assertWritableState} from './state-version.ts';
import {durableRecord} from './durable-record.ts';
import {describeReclamation,reclaimDisk,liveReclaimOwnership,type ReclaimReport,type ReclaimTarget,type ReclaimOwnership} from './disk-reclamation.ts';
import {landingLayout} from '../landing/layout.ts';
import {layout as fullCheckLayout} from '../full-check/layout.ts';
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
export type CapacitySnapshot={freeBytes:number;floorBytes:number;reservedBytes:number;buildReservedBytes:number;temporaryReservedBytes:number;availableBytes:number;
  temporaries:TemporaryDiskClaim[];
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

export class DiskCapacity {
  readonly host:HostObservations;readonly forecast:BuildForecast;readonly pool:PoolCapacitySource|null;readonly stateFile:string;readonly temporaryStateFile:string;
  private readonly reclamation:{services:readonly ReclaimTarget[];ownership:ReclaimOwnership};
  private readonly handed:string|undefined;
  private readonly lockWaitMs:number;
  constructor(options:{env?:NodeJS.ProcessEnv;host?:HostObservations;forecast?:BuildForecast;pool?:PoolCapacitySource|null;
    reclamation?:{services:readonly ReclaimTarget[];ownership:ReclaimOwnership};lockWaitMs?:number}={}){
    const env=options.env??process.env;
    this.handed=env[DISK_BUILD_ADMISSION];this.lockWaitMs=options.lockWaitMs??30_000;
    if(env[FIXTURE_ENVIRONMENT]!==undefined&&env[DISK_CAPACITY]===undefined)throw Error('fixture has no '+DISK_CAPACITY+' capability');
    this.host=options.host??hostObservations(env);this.forecast=options.forecast??coldBuildForecast();
    this.pool=options.pool===undefined?poolSource(env):options.pool;
    this.stateFile=this.pool?join(this.pool.dir,'.disk-builds.json'):env[DISK_CAPACITY]?env[DISK_CAPACITY]+'.builds.json':join(homedir(),'.cache/nts-pool/.disk-builds.json');
    const landing=landingLayout(),full=fullCheckLayout();
    // A private/fixture pool cannot discover the account's service trees.
    const services=this.pool?.dir===join(homedir(),'.cache/nts-pool')&&env[FIXTURE_ENVIRONMENT]===undefined
      ? [{tree:landing.tree,target:landing.target,service:true},{tree:full.tree,target:full.target,service:true},
        ...[full.bench,...Object.values(full.records)].map(tree=>({tree,target:join(tree,'target'),service:true}))]:[];
    this.reclamation=options.reclamation??{services,ownership:liveReclaimOwnership};
    // Older build owners retain their own schema and cannot overwrite a
    // temporary claim. Both files are governed by the same capacity lock.
    this.temporaryStateFile=this.stateFile+'.temporaries.json';
  }
  /** A wake hint only. Readiness always re-runs the complete capacity equation. */
  get changesFile():string{return this.stateFile+'.changed.json';}
  signalChange():void{
    mkdirSync(dirname(this.changesFile),{recursive:true});
    assertWritableState(this.changesFile,1);
    durableRecord(this.changesFile,{version:1,event:randomUUID()});
  }
  /** The same lock take() holds across its capacity check and branch switch. */
  locked<T>(body:()=>T):T {
    const dir=this.pool?.dir??dirname(this.stateFile);
    mkdirSync(dir,{recursive:true});return withLock(join(dir,this.pool?'.lock':'.disk-lock'),body,this.lockWaitMs);
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
  activeLeases():BuildLease[]{
    if(!this.pool||!existsSync(this.pool.dir))return [];
    const {dir,git}=this.pool;
    const refs=infrastructureProbe({purpose:'read landed disk lease owners',command:'git',args:gitArguments(['for-each-ref','--format=%(objectname) %(refname)','refs/nts/landed/']),cwd:git.root,...(git.env?{env:git.env}:{})}).stdout;
    const landed=new Map(refs.trim().split('\n').filter(Boolean).map(line=>{const [sha,ref]=line.split(' ');return [ref!.slice('refs/nts/landed/'.length),sha!];}));
    return worktrees(git).filter(tree=>dirname(resolve(tree.path))===resolve(dir)&&/^[1-9][0-9]*$/.test(tree.path.split('/').at(-1)!)
      &&tree.branch!==null&&landed.get(tree.branch)!==tree.head&&workerPresence(tree.path,tree.branch).state==='attached').map(tree=>({root:tree.path,target:join(tree.path,'target')}));
  }
  /** Caller holds the pool lock. Explicit detach never overrides a live build,
   * temporary claim, unit, or process (including ledger owners and waiters). */
  assertWorkerAbsent(tree:string):void{
    const under=(a:string,b:string)=>b===a||b.startsWith(a+'/');
    for(const claim of this.claims())if([claim.root,claim.target].some(path=>under(resolve(tree),resolve(path))||under(resolve(path),resolve(tree))))
      throw Error('live build claim '+claim.id+' by pid '+claim.pid+' owns '+tree);
    for(const claim of this.temporaryClaims())if(under(resolve(tree),resolve(claim.path))||under(resolve(claim.path),resolve(tree)))
      throw Error('live temporary claim '+claim.id+' by pid '+claim.pid+' owns '+tree);
    this.reclamation.ownership(tree,join(tree,'target'));
  }
  snapshot(path:string,leases?:readonly BuildLease[]):CapacitySnapshot {
    if(leases===undefined)return this.locked(()=>this.snapshot(path,[...this.activeLeases(),...this.claims()]));
    const merged=new Map<string,BuildLease>();
    for(const lease of leases){const key=resolve(lease.target),previous=merged.get(key);merged.set(key,{...lease,target:key,
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
    return this.locked(()=>{
      const leases=[...this.activeLeases(),...this.claims()];
      const snapshot=this.snapshot(path,leases);
      if(snapshot.availableBytes<bytes)return {snapshot,lease:null};
      const claim:TemporaryDiskClaim={id,pid,identity,path,bytes};
      this.recordTemporaries([...snapshot.temporaries,claim]);
      let released=false;
      const release=()=>{if(released)return;this.releaseClaim(()=>{this.recordTemporaries(this.temporaryClaims().filter(row=>row.id!==id));this.signalChange();});released=true;};
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
      const id=this.handed,held=this.locked(()=>this.claims().find(claim=>claim.id===id));
      if(!held)throw new ToolingInstrumentError('tooling-setup',`disk build admission ${id} is not held by a live build owner`);
      if(resolve(held.target)===resolve(lease.target)&&(lease.outputs??['nts-dev','clippy']).every(name=>(held.outputs??['nts-dev','clippy']).includes(name)))
        return Object.assign(()=>{},{env:{[DISK_BUILD_ADMISSION]:id}});
    }
    const id=randomUUID(),pid=process.pid,identity=processIdentity(pid);
    if(!identity)throw Error('disk build owner has no process birth identity');
    const next={...lease,id,pid,identity};
    const reclamation=this.reclaim(lease.target,0,undefined,[next]);
    this.locked(()=>{
      const claims=this.claims();
      const snapshot=this.snapshot(lease.target,[...this.activeLeases(),...claims,next]);
      if(snapshot.availableBytes<0)throw new DiskBuildAdmissionError({root:resolve(lease.root),target:resolve(lease.target),outputs:[...(lease.outputs??['nts-dev','clippy'])],
        shortBytes:-snapshot.availableBytes,freeBytes:snapshot.freeBytes,floorBytes:snapshot.floorBytes,buildReservedBytes:snapshot.buildReservedBytes,temporaryReservedBytes:snapshot.temporaryReservedBytes},describeReclamation(reclamation));
      this.record([...claims,next]);
    });
    let released=false;
    const release=()=>{if(released)return;this.releaseClaim(()=>{this.record(this.claims().filter(claim=>claim.id!==id));this.signalChange();});released=true;};
    return Object.assign(release,{env:{[DISK_BUILD_ADMISSION]:id}});
  }
  /** Read-only retry readiness: no build attempt, claim, or reclamation. */
  buildSnapshot(lease:BuildLease):CapacitySnapshot{
    return this.locked(()=>this.snapshot(lease.target,[...this.activeLeases(),...this.claims(),lease]));
  }
  /** Pool callers already own this lock and pass Git facts from that instant. */
  poolSnapshot(path:string,leases:readonly BuildLease[]):CapacitySnapshot{return this.snapshot(path,[...leases,...this.claims()]);}
  /** A finished build must not become a failed step because cleanup met a
   * busy pool. The durable claim remains conservative until its birth expires. */
  private releaseClaim(body:()=>void):void{
    try{this.locked(body);}catch(error){
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
      locked:body=>this.locked(body),
      snapshot:()=>{const snapshot=this.snapshot(path,[...this.activeLeases(),...this.claims(),...pending]);return {...snapshot,reservedBytes:snapshot.reservedBytes+extraReservedBytes};},
      protectedRoots:()=>[...this.activeLeases(),...this.claims(),...pending,...this.temporaryClaims().map(claim=>({root:claim.path,target:claim.path}))]});
    }finally{this.signalChange();}
  }
}
