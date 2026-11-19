// Resource observations are a capability of a run. Tests provide a complete
// owned view, including observations made by dependencies and child processes.
import {closeSync,existsSync,openSync,readFileSync,readSync,readdirSync,statSync,statfsSync,writeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {durableRecord} from './durable-record.ts';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {HostObservationError} from './host-observation-error.ts';
export {HostObservationError} from './host-observation-error.ts';
import {PRESSURE_RESOURCES,loopDelay,parsePressure,pressureReading,type PressureReading,type LoopDelay,type LoopDelayMeter} from './host-pressure.ts';
export type {PressureReading,LoopDelay,LoopDelayMeter} from './host-pressure.ts';
import {availableParallelism,cpus,loadavg} from 'node:os';
import {FIXTURE_ENVIRONMENT} from './cache-capabilities.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {observeTreeProcesses,type TreeProcessObservation} from '../landing/tree-users.ts';
import {parseRunOwner,type RunOwner} from './scopes/run-owner.ts';

export const HOST_OBSERVATIONS = 'NTS_HOST_OBSERVATIONS';
export const HOST_OBSERVATION_ENVIRONMENT = [HOST_OBSERVATIONS,'NTS_MEMINFO','NTS_VMSTAT','NTS_MEMORY_LEDGER','NTS_GATE_COSTS_DIR','NTS_DISK_CAPACITY'] as const;
/** A cgroup counter's object has ended. Only an owner which already opened
 * that exact group may interpret this as retirement rather than failure. */
export class CgroupDeparted extends HostObservationError {
  readonly group:string;
  constructor(group:string,cause:unknown){super(`host observation cgroup has departed: ${group}`,{cause});this.group=group;}
}
/** All live cgroup operations share this provenance and errno boundary.
 * A successful stat, a parent's listing, or a retained inode proves existence.
 * Merely asking for a path does not. */
export type CgroupFiles={inode(group:string):string;text(group:string,file:string):string;children(group:string):string[]};
const liveCgroupFiles:CgroupFiles={
  inode:group=>String(statSync(`/sys/fs/cgroup${group}`,{bigint:true}).ino),
  text:(group,file)=>readFileSync(`/sys/fs/cgroup${group}/${file}`,'utf8'),
  children:group=>readdirSync(`/sys/fs/cgroup${group}`,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort(),
};
export class CgroupObservations {
  #seen=new Set<string>();
  #files:CgroupFiles;
  constructor(files:CgroupFiles=liveCgroupFiles){this.#files=files;}
  observe<T>(group:string,operation:string,read:()=>T):T{
    checkedGroup(group);
    try{return read();}catch(error){
      if(error instanceof HostObservationError)throw error;
      if(this.#seen.has(group)&&['ENOENT','ENODEV','ESRCH'].includes((error as NodeJS.ErrnoException).code??''))throw new CgroupDeparted(group,error);
      throw new HostObservationError(`host observation cgroup ${group} ${operation} failed: ${String(error)}`,{cause:error});
    }
  }
  inode(group:string,retained?:string):string{
    if(retained!==undefined)this.#seen.add(group);
    const inode=this.observe(group,'stat',()=>this.#files.inode(group));
    this.#seen.add(group);
    if(retained!==undefined&&inode!==retained)throw new CgroupDeparted(group,Error('retained cgroup identity was replaced'));
    return inode;
  }
  text(group:string,file:string):string{return this.observe(group,file,()=>this.#files.text(group,file));}
  /** Physical directory or unit listings establish existence before a read. */
  listed(groups:readonly string[]):void{for(const group of groups)this.#seen.add(checkedGroup(group));}
  populated(group:string):boolean{
    this.inode(group);
    const value=/^populated ([01])$/m.exec(this.text(group,'cgroup.events'))?.[1];
    if(value===undefined)throw new HostObservationError(`host observation cgroup ${group} cgroup.events has no populated answer`);
    return value==='1';
  }
  children(group:string):string[]{
    this.inode(group);
    const children=this.observe(group,'children',()=>this.#files.children(group).map(name=>`${group==='/'?'':group}/${name}`));
    this.listed(children);
    return children;
  }
  charge(group:string,retained?:string):number{
    this.inode(group,retained);
    return this.observe(group,'resident charge',()=>parseCgroupCharge(this.text(group,'memory.current'),this.text(group,'memory.stat')));
  }
  peak(group:string,retained?:string):number{
    this.inode(group,retained);const text=this.text(group,'memory.peak').trim();
    if(!/^\d+$/.test(text))throw new HostObservationError(`host observation cgroup ${group} memory.peak is invalid`);
    return number(Number(text),'scopePeak.bytes');
  }
  members(group:string,retained?:string):number[]{
    this.inode(group,retained);
    const pids=this.text(group,'cgroup.procs').trim().split(/\s+/).filter(Boolean).map(Number);
    if(pids.some(pid=>!Number.isSafeInteger(pid)||pid<=0))throw new HostObservationError(`host observation cgroup ${group} cgroup.procs is invalid`);
    for(const child of this.children(group)){
      try{pids.push(...this.members(child));}
      catch(error){if(!(error instanceof CgroupDeparted)||error.group!==child)throw error;}
    }
    return pids;
  }
}
// Native ownership acquisition is a safety observation even in a resource
// fixture. Its reads still belong to the same cgroup observation owner.
export const cgroupOwnershipInode=(group:string)=>new CgroupObservations().inode(group);
export const cgroupOwnershipMembers=(group:string)=>new CgroupObservations().members(group);
export const cgroupOwnershipAccounted=(group:string)=>new CgroupObservations().observe(group,'memory.current presence',()=>existsSync(`/sys/fs/cgroup${checkedGroup(group)}/memory.current`));
/** The count supplies a ControlGroup from a physical systemd unit listing.
 * This is safety observation, like acquisition, even in a resource fixture. */
export function listedCgroupPopulated(group:string,observations=new CgroupObservations()):boolean{
  observations.listed([group]);
  return sampleCgroup(group,()=>observations.populated(group),false);
}
export type RetainedCgroup={path:string;inode:string};
export type MemberDeclaration={version:1;group:string;members:number[]};
/** Immutable fixture actor records have one writer/reader schema. */
export function parseMemberDeclaration(value:unknown,name='resident.members declaration'):MemberDeclaration{
  const row=value as MemberDeclaration;
  if(!row||typeof row!=='object'||row.version!==1||Object.keys(row).sort().join(',')!=='group,members,version'
    ||typeof row.group!=='string'||!Array.isArray(row.members)||row.members.some(pid=>!Number.isSafeInteger(pid)||pid<=0))throw new HostObservationError(`host observation ${name} is invalid`);
  checkedGroup(row.group);return row;
}
export function sampleCgroup<T>(group:string,read:()=>T,departed:T):T{
  try{return read();}catch(error){if(error instanceof CgroupDeparted&&error.group===group)return departed;throw error;}
}
export const retainedCgroupCharge=(host:HostObservations,ref:RetainedCgroup)=>sampleCgroup(ref.path,()=>host.cgroupCharge(ref.path,ref.inode),0);
export const retainedCgroupMembers=(host:HostObservations,ref:RetainedCgroup)=>sampleCgroup(ref.path,()=>host.cgroupMembers(ref.path,ref.inode),[]);
/** Keep the cause chain where the failure is reported, while the summary
 * retains the short reason. The runner routes growth failures here. */
export function reportMemoryFailure(error:unknown,report:(line:string)=>void,stop:(reason:string)=>void):void{
  const seen=new Set<unknown>();let cause:unknown=error;
  while(cause!==undefined&&!seen.has(cause)){
    seen.add(cause);report(cause instanceof Error?cause.stack??String(cause):String(cause));
    cause=cause instanceof Error?cause.cause:undefined;
  }
  stop(`memory: ${error instanceof Error?error.message:String(error)}`);
}
export type MachineMemory = {availableBytes:number;totalBytes:number};
export type DiskSpace = {freeBytes:number;freeInodes:number};
export type CgroupCpu = {usageUsec:number;userUsec:number;systemUsec:number};
export type OwnCpu = {userUsec:number;systemUsec:number};
export type ScopeMemoryPeak = {readonly resettable:boolean;reset():void;read():number;close():void};
export type HostObservationFixture = {
  version:1;
  memberDeclarations?:{directory:string;scopeReceipts:string[]};
  memory:{file:string};
  paging:{file:string};
  disk:DiskSpace;
  allocated:{kind:'fixed';defaultBytes:number;paths?:Record<string,number>}|{kind:'live'};
  cpu:{kind:'fixed';default:CgroupCpu;cgroups?:Record<string,CgroupCpu>}|{kind:'live'};
  selfCpu:{kind:'fixed';value:OwnCpu}|{kind:'live'};
  resident:{kind:'fixed';defaultBytes:number;processes?:Record<string,number>;cgroups?:Record<string,number>;members?:Record<string,number[]>;files?:Record<string,Record<string,string>>}|{kind:'live'};
  scopePeak:{kind:'fixed';bytes:number;resettable:boolean}|{kind:'live'};
  width:{logical:number;available:number};
  load:[number,number,number];
  clock:{kind:'live'}|{kind:'fixed';now:number}|{kind:'file';file:string};
  wallClock:{kind:'live'}|{kind:'fixed';now:number};
  pressure:{kind:'live'}|{kind:'fixed';ownGroup:string;machine:PressureReading;default:PressureReading;cgroups?:Record<string,PressureReading>};
  loopDelay:{kind:'live'}|{kind:'fixed';value:LoopDelay};
  processUsers:{kind:'proc';root:string}|{kind:'live';pids:number[]};
};

export interface HostObservations {
  memory():MachineMemory;
  swap():{totalBytes:number;freeBytes:number};
  load():[number,number,number];
  paging():{inputPages:number;outputPages:number};
  disk(path:string):DiskSpace;
  allocatedBytes(path:string):number;
  processCharge(pid:number):number;
  /** Physical acquisition is a safety observation, also in a fixed fixture.
   * Its capability records that exact scope for subsequent samplers. */
  acquireCgroup(path:string):RetainedCgroup;
  cgroupCharge(path:string,inode?:string):number;
  cgroupMembers(path:string,inode?:string):number[];
  cgroupText(path:string,file:string):string;
  cgroupMemoryPeak(path:string,inode?:string):number;
  /** The child cgroups directly beneath `path`, as absolute cgroup paths.
   * A fixture's cgroups are the keys of its fixed `resident.cgroups`. */
  cgroupChildren(path:string):string[];
  cgroupCpu(path:string):CgroupCpu;
  ownCpu():OwnCpu;
  ownScopeMemoryPeak():ScopeMemoryPeak;
  scopeMemoryPeak(group:string):ScopeMemoryPeak;
  machineWidth():number;
  availableWidth():number;
  now():number;
  wallNow():number;
  ownCgroup():string;
  machinePressure():PressureReading;
  cgroupPressure(group:string):PressureReading;
  loopDelay():LoopDelayMeter;
  processUsers(roots:readonly string[]):TreeProcessObservation;
}

function checkedGroup(group:string):string{
  if(typeof group!=='string'||!group.startsWith('/')||group.split('/').includes('..')||group.includes('\n')||group.includes('\0'))throw new HostObservationError('host observation pressure cgroup path is invalid');
  return group;
}
function liveOwnCgroup():string{
  const match=/^0::(\/.*)$/m.exec(textFile('/proc/self/cgroup','pressure.ownCgroup'));
  if(!match)throw new HostObservationError('host observation pressure.ownCgroup is missing');
  return checkedGroup(match[1]!);
}
function livePressure(cgroups:CgroupObservations,group?:string):PressureReading{
  const root=group===undefined?'/proc/pressure':`/sys/fs/cgroup${checkedGroup(group)}`;
  const read=()=>{
    if(group!==undefined)cgroups.inode(group);
    const identity=statSync(root,{bigint:true}),resources={} as PressureReading['resources'];
    for(const resource of PRESSURE_RESOURCES)resources[resource]=parsePressure(readFileSync(`${root}/${resource}${group===undefined?'':'.pressure'}`,'utf8'),`pressure.${root}.${resource}`);
    const after=statSync(root,{bigint:true});
    if(identity.dev!==after.dev||identity.ino!==after.ino)throw Error('scope identity changed during sampling');
    return {identity:`${root}:${identity.dev}:${identity.ino}`,resources};
  };
  if(group!==undefined)return cgroups.observe(group,'pressure',read);
  try{return read();}catch(error){throw new HostObservationError(`host observation pressure ${root} failed: ${String(error)}`,{cause:error});}
}
function liveLoopDelay():LoopDelayMeter{
  const histogram=monitorEventLoopDelay({resolution:20});histogram.enable();let closed=false;
  const opened=()=>{if(closed)throw new HostObservationError('host observation loopDelay meter is closed');};
  return {
    read:()=>{opened();return loopDelay({count:histogram.count,maxMs:histogram.count?histogram.max/1e6:null,p99Ms:histogram.count?histogram.percentile(99)/1e6:null});},
    reset:()=>{opened();histogram.reset();},
    close:()=>{if(!closed){closed=true;histogram.disable();}},
  };
}

function number(value:unknown,name:string):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new HostObservationError(`host observation ${name} is missing or invalid`);
  return value;
}

function ownCpu(value:unknown):OwnCpu{
  if(typeof value!=='object'||value===null)throw new HostObservationError('host observation selfCpu.value is missing or invalid');
  const row=value as Record<string,unknown>;
  return {userUsec:number(row.userUsec,'selfCpu.value.userUsec'),systemUsec:number(row.systemUsec,'selfCpu.value.systemUsec')};
}
function liveOwnCpu():OwnCpu{const value=process.cpuUsage();return {userUsec:value.user,systemUsec:value.system};}
function textFile(value:unknown,name:string):string {
  if(typeof value!=='string'||!value)throw new HostObservationError(`host observation ${name} is missing or invalid`);
  try{return readFileSync(value,'utf8');}catch(error){throw new HostObservationError(`cannot read host observation ${name}: ${String(error)}`);}
}

export function parseMemory(text:string):MachineMemory|null {
  const read=(name:string)=>new RegExp(`^${name}:\\s+(\\d+) kB$`,'m').exec(text)?.[1];
  const available=read('MemAvailable'),total=read('MemTotal');
  return available===undefined||total===undefined?null:{availableBytes:Number(available)*1024,totalBytes:Number(total)*1024};
}
export function parseProcessCharge(text:string):number {
  const read=(name:string)=>Number(new RegExp(`^${name}:\\s+(\\d+) kB$`,'m').exec(text)?.[1]??0)*1024;
  return read('RssAnon')+read('RssShmem');
}
export function parseCgroupCharge(current:string,stat:string):number {
  const read=(name:string)=>{
    const value=new RegExp(`^${name} (\\d+)$`,'m').exec(stat)?.[1];
    if(value===undefined)throw new Error(`memory.stat has no ${name}`);
    return Number(value);
  };
  return Math.max(0,Number(current.trim())-read('active_file')-read('inactive_file')-read('slab_reclaimable'));
}
function cpuCounters(value:unknown,name:string):CgroupCpu {
  if(typeof value!=='object'||value===null)throw new HostObservationError(`host observation ${name} is missing or invalid`);
  const row=value as Record<string,unknown>;
  const counter=(key:string):number=>{const n=number(row[key],`${name}.${key}`);if(!Number.isSafeInteger(n))throw new HostObservationError(`host observation ${name}.${key} is not a whole microsecond counter`);return n;};
  return {usageUsec:counter('usageUsec'),userUsec:counter('userUsec'),systemUsec:counter('systemUsec')};
}
export function parseCgroupCpu(text:string):CgroupCpu {
  const counter=(name:string):number=>{
    const values=[...text.matchAll(new RegExp(`^${name} (\\d+)$`,'gm'))];
    if(values.length!==1)throw new HostObservationError(`host observation cpu.stat ${name} is missing or duplicated`);
    const value=Number(values[0]![1]);if(!Number.isSafeInteger(value))throw new HostObservationError(`host observation cpu.stat ${name} is invalid`);return value;
  };
  return {usageUsec:counter('usage_usec'),userUsec:counter('user_usec'),systemUsec:counter('system_usec')};
}
function liveCgroupCpu(path:string,cgroups:CgroupObservations):CgroupCpu { cgroups.inode(path);return parseCgroupCpu(cgroups.text(path,'cpu.stat')); }

function liveAllocatedBytes(path:string,env:NodeJS.ProcessEnv):number {
  if(!existsSync(path))return 0;
  const result=infrastructureProbe({purpose:'measure allocated disk bytes for '+path,command:'du',args:['-sx','-B1','--',path],env});
  const value=/^(\d+)\s/.exec(result.stdout)?.[1];
  if(value===undefined)throw new HostObservationError('host observation allocatedBytes has no byte count: '+path);
  return number(Number(value),'allocatedBytes.'+path);
}

/** memory.peak resets belong to an open descriptor, not to a cgroup path.
 * Retain the descriptor for the whole case stream and discover reset support
 * before a caller can mistake a whole-scope peak for a per-case measurement. */
function liveScopeMemoryPeak(cgroups:CgroupObservations,requestedGroup?:string):ScopeMemoryPeak {
  let fd:number,group:string;
  try {
    const current=requestedGroup===undefined?readFileSync('/proc/self/cgroup','utf8').trim():'';
    group=requestedGroup??(current.startsWith('0::/')?current.slice(3):'');
    if(!group||group==='/'||group.split('/').includes('..')||group.includes('\n'))throw Error('own scope identity is invalid');
    cgroups.inode(group);
    fd=cgroups.observe(group,'scopePeak open',()=>openSync(`/sys/fs/cgroup${group}/memory.peak`,'r+'));
  } catch(error) {if(error instanceof CgroupDeparted)throw error;throw new HostObservationError(`host observation scopePeak cannot open own memory.peak: ${String(error)}`,{cause:error});}
  let resettable=false,closed=false;
  try{cgroups.observe(group,'scopePeak reset support',()=>writeSync(fd,'reset\n'));resettable=true;}catch(error){
    if(!(error instanceof HostObservationError)||!['EINVAL','EOPNOTSUPP'].includes((error.cause as NodeJS.ErrnoException|undefined)?.code??'')){closeSync(fd);throw error;}
  }
  const opened=()=>{if(closed)throw new HostObservationError('host observation scopePeak meter is closed');};
  return {resettable,
    reset:()=>{opened();if(!resettable)throw new HostObservationError('host observation scopePeak meter cannot reset');cgroups.observe(group,'scopePeak reset',()=>writeSync(fd,'reset\n'));},
    read:()=>{opened();const buffer=Buffer.alloc(32);let size:number;size=cgroups.observe(group,'scopePeak read',()=>readSync(fd,buffer,0,buffer.length,0));const text=buffer.toString('utf8',0,size).trim();if(!/^\d+$/.test(text))throw new HostObservationError('host observation scopePeak counter is invalid');return number(Number(text),'scopePeak.bytes');},
    close:()=>{if(!closed){closed=true;closeSync(fd);}},
  };
}
function memory(file:string):MachineMemory {
  const result=parseMemory(readFileSync(file,'utf8'));
  if(result===null)throw new Error(`${file} names no MemAvailable and MemTotal`);
  return result;
}
function swap(file:string){
  const contents=textFile(file,'memory.file');
  const read=(name:string)=>{const value=new RegExp(`^${name}:\\s+(\\d+) kB$`,'m').exec(contents)?.[1];if(value===undefined)throw new HostObservationError(`host observation memory has no ${name}`);return Number(value)*1024;};
  return {totalBytes:read('SwapTotal'),freeBytes:read('SwapFree')};
}
function paging(file:string){
  const contents=textFile(file,'paging.file');
  const read=(name:string)=>{
    const value=new RegExp(`^${name} (\\d+)$`,'m').exec(contents)?.[1];
    if(value===undefined)throw new HostObservationError(`host observation paging has no ${name}`);
    return Number(value);
  };
  return {inputPages:read('pswpin'),outputPages:read('pswpout')};
}

/** No fixture method falls back to a live observation. Reloading its owned
 * file lets the fixture move one resource without replacing its capability. */
export function hostObservations(env:NodeJS.ProcessEnv=process.env):HostObservations {
  const cgroups=new CgroupObservations();
  const file=env[HOST_OBSERVATIONS];
  if(file!==undefined){
    if(!file)throw new HostObservationError('host observation capability path is missing or invalid');
    const read=():HostObservationFixture=>{
      let value:HostObservationFixture;
      try{value=JSON.parse(readFileSync(file,'utf8')) as HostObservationFixture;}catch(error){throw new HostObservationError(`cannot read host observation capability ${file}: ${String(error)}`);}
      if(value?.version!==1)throw new HostObservationError('host observation fixture has no supported version');
      for(const [name,path] of [['memory.file',value.memory?.file],['paging.file',value.paging?.file]]) {
        if(typeof path!=='string'||!path)throw new HostObservationError(`host observation ${name} is missing or invalid`);
      }
      number(value.disk?.freeBytes,'disk.freeBytes');number(value.disk?.freeInodes,'disk.freeInodes');
      if(!Array.isArray(value.load)||value.load.length!==3)throw new HostObservationError('host observation load is missing or invalid');
      value.load.forEach((part,index)=>number(part,`load.${index}`));
      number(value.width?.logical,'width.logical');number(value.width?.available,'width.available');
      if(value.cpu?.kind==='fixed')cpuCounters(value.cpu.default,'cpu.default');
      else if(value.cpu?.kind!=='live')throw new HostObservationError('host observation cpu is missing or invalid');
      if(value.selfCpu?.kind==='fixed')ownCpu(value.selfCpu.value);
      else if(value.selfCpu?.kind!=='live')throw new HostObservationError('host observation selfCpu is missing or invalid');
      if(value.allocated?.kind==='fixed')number(value.allocated.defaultBytes,'allocated.defaultBytes');
      else if(value.allocated?.kind!=='live')throw new HostObservationError('host observation allocated is missing or invalid');
      if(value.resident?.kind==='fixed')number(value.resident.defaultBytes,'resident.defaultBytes');
      else if(value.resident?.kind!=='live')throw new HostObservationError('host observation resident is missing or invalid');
      if(value.scopePeak?.kind==='fixed'){
        number(value.scopePeak.bytes,'scopePeak.bytes');
        if(typeof value.scopePeak.resettable!=='boolean')throw new HostObservationError('host observation scopePeak.resettable is missing or invalid');
      } else if(value.scopePeak?.kind!=='live')throw new HostObservationError('host observation scopePeak is missing or invalid');
      if(value.clock?.kind==='fixed')number(value.clock.now,'clock.now');
      else if(value.clock?.kind==='file'){if(!value.clock.file)throw new HostObservationError('host observation clock.file is missing or invalid');}
      else if(value.clock?.kind!=='live')throw new HostObservationError('host observation clock is missing or invalid');
      if(value.wallClock?.kind==='fixed')number(value.wallClock.now,'wallClock.now');
      else if(value.wallClock?.kind!=='live')throw new HostObservationError('host observation wallClock is missing or invalid');
      if(value.pressure?.kind==='fixed'){
        checkedGroup(value.pressure.ownGroup);pressureReading(value.pressure.machine,'pressure.machine');pressureReading(value.pressure.default,'pressure.default');
      }else if(value.pressure?.kind!=='live')throw new HostObservationError('host observation pressure is missing or invalid');
      if(value.loopDelay?.kind==='fixed')loopDelay(value.loopDelay.value);
      else if(value.loopDelay?.kind!=='live')throw new HostObservationError('host observation loopDelay is missing or invalid');
      if(value.processUsers?.kind==='proc'){
        if(typeof value.processUsers.root!=='string'||!isAbsolute(value.processUsers.root))throw new HostObservationError('host observation processUsers.root is missing or invalid');
      }else if(value.processUsers?.kind==='live'){
        if(!Array.isArray(value.processUsers.pids)||value.processUsers.pids.some(pid=>!Number.isSafeInteger(pid)||pid<=0)||new Set(value.processUsers.pids).size!==value.processUsers.pids.length)throw new HostObservationError('host observation processUsers.pids is missing or invalid');
      }else throw new HostObservationError('host observation processUsers is missing or invalid');
      return value;
    };
    read();
    // Each acquired physical scope publishes its own immutable identity in
    // this fixture's capability. Separate records avoid cross-process lost
    // updates. Acquisition is provenance only: it declares no resource value.
    const acquisitionFile=(path:string)=>join(file+'.acquired',createHash('sha256').update(checkedGroup(path)).digest('hex')+'.json');
    const acquireCgroup=(path:string):RetainedCgroup=>{
      const ref={path,inode:cgroups.inode(path)};
      if(read().resident.kind==='fixed'){
        durableRecord(acquisitionFile(path),ref);
        fixtureScope(path,ref.inode);
      }
      return ref;
    };
    const fixtureJson=(path:string,name:string,optional=false):unknown=>{
      try{return JSON.parse(readFileSync(path,'utf8'));}
      catch(error){if(optional&&(error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw new HostObservationError(`host observation ${name} is unreadable: ${path}: ${String(error)}`,{cause:error});}
    };
    const fixtureRecords=(directory:string):string[]=>{
      try{return readdirSync(directory).filter(name=>name.endsWith('.json')).sort().map(name=>join(directory,name));}
      catch(error){throw new HostObservationError(`host observation resident.members declaration directory is unreadable: ${directory}`,{cause:error});}
    };
    const fixtureScope=(path:string,inode?:string,source=read().memberDeclarations):boolean=>{
      if(!source||read().resident.kind!=='fixed')return false;
      if(typeof source.directory!=='string'||!isAbsolute(source.directory)||!Array.isArray(source.scopeReceipts)||source.scopeReceipts.some(value=>typeof value!=='string'||!isAbsolute(value)))throw new HostObservationError('host observation resident.members declaration source is invalid');
      if(source.scopeReceipts.length===0)return false;
      const receipts=new Map<string,RunOwner|undefined>();
      for(const receipt of source.scopeReceipts){
        const value=fixtureJson(receipt,'resident.members creation receipt',true);
        try{receipts.set(receipt,value===undefined?undefined:parseRunOwner(JSON.stringify(value),receipt));}
        catch(error){throw new HostObservationError(`host observation resident.members creation receipt is invalid: ${receipt}: ${String(error)}`,{cause:error});}
      }
      // Bindings retain identity only, so a fresh sampler can recognize a
      // closed receipt. Membership always comes from explicit logical declarations.
      let mismatchedIdentity=false;
      for(const record of fixtureRecords(join(source.directory,'scopes'))){
        const binding=fixtureJson(record,'resident.members scope binding') as {version?:number;receipt?:string;owner?:RunOwner};
        if(!binding||binding.version!==1||typeof binding.receipt!=='string'||!receipts.has(binding.receipt)||Object.keys(binding).sort().join(',')!=='owner,receipt,version')throw new HostObservationError(`host observation resident.members scope binding is invalid: ${record}`);
        let prior:RunOwner;
        try{prior=parseRunOwner(JSON.stringify(binding.owner),record);}
        catch(error){throw new HostObservationError(`host observation resident.members scope binding is invalid: ${record}: ${String(error)}`,{cause:error});}
        if(!prior.scope)throw new HostObservationError(`host observation resident.members scope binding lacks identity: ${record}`);
        if(prior.scope.group!==path)continue;
        if(inode!==undefined&&inode!==prior.scope.inode){mismatchedIdentity=true;continue;}
        const current=receipts.get(binding.receipt);
        if(!current||current.nonce!==prior.nonce)throw new CgroupDeparted(path,Error('fixture creation receipt closed'));
        if(!current.scope||current.scope.group!==path||current.scope.device!==prior.scope.device||current.scope.inode!==prior.scope.inode)throw new HostObservationError(`host observation resident.members creation identity changed for ${path}`);
      }
      for(const [receipt,owner]of receipts){
        const scope=owner?.scope;if(!scope||scope.group!==path)continue;
        cgroups.listed([path]);
        const identity=cgroups.observe(path,'fixture creation identity',()=>{
          const value=statSync(`/sys/fs/cgroup${path}`,{bigint:true});return {device:String(value.dev),inode:String(value.ino)};
        });
        if(identity.device!==scope.device||identity.inode!==scope.inode||inode!==undefined&&inode!==scope.inode)throw new HostObservationError(`host observation resident.members creation identity does not match ${path}`);
        const key=createHash('sha256').update(JSON.stringify([receipt,owner!.nonce,scope])).digest('hex');
        const binding=join(source.directory,'scopes',key+'.json');
        if(!existsSync(binding))durableRecord(binding,{version:1,receipt,owner});
        return true;
      }
      if(mismatchedIdentity)throw new HostObservationError(`host observation resident.members creation identity does not match ${path}`);
      return false;
    };
    const fixtureMembers=(path:string,declared:Record<string,number[]>|undefined,inode?:string):number[]=>{
      checkedGroup(path);
      const rows=new Map<string,number[]>();
      const add=(group:unknown,members:unknown)=>{
        if(typeof group!=='string'||!Array.isArray(members)||members.some(pid=>!Number.isSafeInteger(pid)||pid<=0))throw new HostObservationError(`host observation resident.members declaration is invalid for ${path}`);
        checkedGroup(group);rows.set(group,[...new Set([...(rows.get(group)??[]),...members as number[]])]);
      };
      for(const [group,members]of Object.entries(declared??{}))add(group,members);
      const source=read().memberDeclarations;
      if(source){
        if(typeof source.directory!=='string'||!isAbsolute(source.directory)||!Array.isArray(source.scopeReceipts)||source.scopeReceipts.some(value=>typeof value!=='string'||!isAbsolute(value)))throw new HostObservationError('host observation resident.members declaration source is invalid');
        for(const record of fixtureRecords(source.directory)){
          const row=parseMemberDeclaration(fixtureJson(record,'resident.members declaration'),'resident.members declaration '+record);
          add(row.group,row.members);
        }
        if(fixtureScope(path,inode,source))return [...new Set([...rows].filter(([group])=>group===path||group.startsWith(path+'/')).flatMap(([,members])=>members))];
      }
      const value=rows.get(path);
      if(value===undefined)throw new HostObservationError(`host observation resident.members has no cgroup ${path}`);
      return value;
    };
    const charge=(kind:'processes'|'cgroups',key:string,inode?:string)=>{
      const resident=read().resident;
      if(resident?.kind==='live')return kind==='processes'?liveProcessCharge(Number(key)):cgroups.charge(key);
      if(resident?.kind!=='fixed')throw new HostObservationError('host observation resident is missing or invalid');
      if(kind==='cgroups')fixtureScope(key,inode);
      return number(resident[kind]?.[key]??resident.defaultBytes,`resident.${kind}.${key}`);
    };
    const scopePeak=(group?:string):ScopeMemoryPeak=>{
      const initial=read().scopePeak;
      if(initial.kind==='live')return liveScopeMemoryPeak(cgroups,group);
      let closed=false;
      const current=()=>{if(closed)throw new HostObservationError('host observation scopePeak meter is closed');const value=read().scopePeak;if(value.kind!=='fixed'||value.resettable!==initial.resettable)throw new HostObservationError('host observation scopePeak meter changed its kind or resettability');return value;};
      return {resettable:initial.resettable,reset:()=>{current();if(!initial.resettable)throw new HostObservationError('host observation scopePeak meter cannot reset');},read:()=>number(current().bytes,'scopePeak.bytes'),close:()=>{closed=true;}};
    };
    return {
      memory:()=>{const value=read();const contents=textFile(value.memory?.file,'memory.file');const parsed=parseMemory(contents);if(parsed===null)throw new HostObservationError('host observation memory has no MemAvailable and MemTotal');return parsed;},
      swap:()=>swap(read().memory.file),
      load:()=>read().load,
      paging:()=>paging(read().paging?.file??''),
      processUsers:roots=>{
        const value=read().processUsers;
        try{return observeTreeProcesses(roots,{self:process.pid,...(value.kind==='proc'?{proc:value.root}:{pids:value.pids})});}
        catch(error){throw new HostObservationError('host observation processUsers failed: '+String(error));}
      },
      disk:()=>{const value=read().disk;return {freeBytes:number(value?.freeBytes,'disk.freeBytes'),freeInodes:number(value?.freeInodes,'disk.freeInodes')};},
      allocatedBytes:path=>{const value=read().allocated;return value.kind==='live'?liveAllocatedBytes(path,env):number(value.paths?.[path]??value.defaultBytes,'allocated.paths.'+path);},
      processCharge:pid=>charge('processes',String(pid)),
      acquireCgroup,
      cgroupCharge:(path,inode)=>read().resident.kind==='live'?cgroups.charge(path,inode):charge('cgroups',path,inode),
      cgroupMembers:(path,inode)=>{const resident=read().resident;return resident.kind==='live'?cgroups.members(path,inode):fixtureMembers(path,resident.members,inode);},
      cgroupText:(path,file)=>{const resident=read().resident;if(resident.kind==='live'){cgroups.inode(path);return cgroups.text(path,file);}const value=resident.files?.[path]?.[file];if(value===undefined)throw new HostObservationError(`host observation cgroup ${path} ${file} is missing`);return value;},
      cgroupMemoryPeak:(path,inode)=>{const value=read().scopePeak;if(value.kind==='live')return cgroups.peak(path,inode);fixtureScope(path,inode);return number(value.bytes,'scopePeak.bytes');},
      cgroupChildren:path=>{
        checkedGroup(path);const resident=read().resident;
        if(resident.kind==='live')return cgroups.children(path);
        return fixtureCgroupChildren(Object.keys(resident.cgroups??{}),path);
      },
      cgroupCpu:path=>{const cpu=read().cpu;if(cpu.kind==='live')return liveCgroupCpu(path,cgroups);return cpuCounters(cpu.cgroups?.[path]??cpu.default,`cpu.cgroups.${path}`);},
      ownCpu:()=>{const value=read().selfCpu;return value.kind==='live'?liveOwnCpu():ownCpu(value.value);},
      ownScopeMemoryPeak:()=>scopePeak(),
      scopeMemoryPeak:group=>scopePeak(group),
      machineWidth:()=>number(read().width?.logical,'width.logical'),
      availableWidth:()=>number(read().width?.available,'width.available'),
      now:()=>{const value=read().clock;if(value?.kind==='live')return performance.now();if(value?.kind==='fixed')return number(value.now,'clock.now');if(value?.kind==='file'){const text=textFile(value.file,'clock.file').trim();if(!text)throw new HostObservationError('host observation clock.now is missing or invalid');return number(Number(text),'clock.now');}throw new HostObservationError('host observation clock is missing or invalid');},
      wallNow:()=>{const value=read().wallClock;return value.kind==='live'?Date.now():number(value.now,'wallClock.now');},
      ownCgroup:()=>{const value=read().pressure;return value.kind==='live'?liveOwnCgroup():checkedGroup(value.ownGroup);},
      machinePressure:()=>{const value=read().pressure;return value.kind==='live'?livePressure(cgroups):pressureReading(value.machine,'pressure.machine');},
      cgroupPressure:group=>{checkedGroup(group);const value=read().pressure;return value.kind==='live'?livePressure(cgroups,group):pressureReading(value.cgroups?.[group]??{...value.default,identity:group+':'+value.default.identity},'pressure.cgroups.'+group);},
      loopDelay:()=>{
        const initial=read().loopDelay;if(initial.kind==='live')return liveLoopDelay();let closed=false;
        const opened=()=>{if(closed)throw new HostObservationError('host observation loopDelay meter is closed');};
        return {read:()=>{opened();const value=read().loopDelay;if(value.kind!=='fixed')throw new HostObservationError('host observation loopDelay meter changed kind');return loopDelay(value.value);},reset:()=>{opened();},close:()=>{closed=true;}};
      },
    };
  }
  if(env[FIXTURE_ENVIRONMENT]!==undefined)throw new HostObservationError('fixture host observation capability missing: '+HOST_OBSERVATIONS);
  // A partial legacy test view must not quietly select the rest of the host.
  if(env.NTS_MEMINFO||env.NTS_VMSTAT)throw new HostObservationError('NTS_MEMINFO/NTS_VMSTAT require an owned HostObservations capability');
  return {
    memory:()=>memory('/proc/meminfo'),
    paging:()=>paging('/proc/vmstat'),
    processUsers:roots=>observeTreeProcesses(roots,{self:process.pid}),
    swap:()=>swap('/proc/meminfo'),
    load:()=>loadavg() as [number,number,number],
    disk:path=>{let existing=resolve(path);while(!existsSync(existing))existing=dirname(existing);const value=statfsSync(existing);return {freeBytes:value.bavail*value.bsize,freeInodes:value.ffree};},
    allocatedBytes:path=>liveAllocatedBytes(path,env),
    processCharge:liveProcessCharge,
    acquireCgroup:path=>({path,inode:cgroups.inode(path)}),
    cgroupCharge:(path,inode)=>cgroups.charge(path,inode),
    cgroupMembers:(path,inode)=>cgroups.members(path,inode),
    cgroupText:(path,file)=>{cgroups.inode(path);return cgroups.text(path,file);},
    cgroupMemoryPeak:(path,inode)=>cgroups.peak(path,inode),
    cgroupChildren:path=>cgroups.children(path),
    cgroupCpu:path=>liveCgroupCpu(path,cgroups),
    ownCpu:liveOwnCpu,
    ownScopeMemoryPeak:()=>liveScopeMemoryPeak(cgroups),
    scopeMemoryPeak:group=>liveScopeMemoryPeak(cgroups,group),
    machineWidth:()=>cpus().length,
    availableWidth:()=>availableParallelism(),
    now:()=>performance.now(),
    wallNow:()=>Date.now(),
    ownCgroup:liveOwnCgroup,
    machinePressure:()=>livePressure(cgroups),
    cgroupPressure:group=>livePressure(cgroups,group),
    loopDelay:liveLoopDelay,
  };
}

function liveProcessCharge(pid:number):number { return parseProcessCharge(readFileSync(`/proc/${pid}/status`,'utf8')); }
/** A fixture names every cgroup it has as a key; a parent exists through its
 * descendants' keys, and an unknown parent is a missing observation. */
export function fixtureCgroupChildren(keys:readonly string[],path:string):string[]{
  const prefix=path==='/'?'/':`${path}/`;let known=path==='/'||keys.includes(path);const children=new Set<string>();
  for(const key of keys){
    if(!key.startsWith(prefix))continue;
    known=true;
    const rest=key.slice(prefix.length);if(!rest)continue;
    children.add(prefix+rest.split('/')[0]);
  }
  if(!known)throw new HostObservationError(`host observation resident.cgroups has no cgroup ${path}`);
  return [...children].sort();
}
/** Only this owned grant crosses a sampler boundary; its data paths live in the grant. */
export function hostObservationEnvironment(env:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv {
  hostObservations(env);
  return env[HOST_OBSERVATIONS]?{[HOST_OBSERVATIONS]:env[HOST_OBSERVATIONS]}:{};
}
