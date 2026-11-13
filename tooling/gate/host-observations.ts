// Resource observations are a capability of a run. Tests provide a complete
// owned view, including observations made by dependencies and child processes.
import {closeSync,existsSync,openSync,readFileSync,readSync,statSync,statfsSync,writeSync} from 'node:fs';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {HostObservationError} from './host-observation-error.ts';
export {HostObservationError} from './host-observation-error.ts';
import {PRESSURE_RESOURCES,loopDelay,parsePressure,pressureReading,type PressureReading,type LoopDelay,type LoopDelayMeter} from './host-pressure.ts';
export type {PressureReading,LoopDelay,LoopDelayMeter} from './host-pressure.ts';
import {availableParallelism,cpus,loadavg} from 'node:os';
import {FIXTURE_ENVIRONMENT} from './cache-capabilities.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {dirname,resolve} from 'node:path';

export const HOST_OBSERVATIONS = 'NTS_HOST_OBSERVATIONS';
export const HOST_OBSERVATION_ENVIRONMENT = [HOST_OBSERVATIONS,'NTS_MEMINFO','NTS_VMSTAT','NTS_MEMORY_LEDGER','NTS_GATE_COSTS_DIR','NTS_DISK_CAPACITY'] as const;
/** A cgroup counter's object has ended. Only an owner which already opened
 * that exact group may interpret this as retirement rather than failure. */
export class CgroupDeparted extends HostObservationError {
  readonly group:string;
  constructor(group:string,cause:unknown){super(`host observation cgroup has departed: ${group}`,{cause});this.group=group;}
}
export type MachineMemory = {availableBytes:number;totalBytes:number};
export type DiskSpace = {freeBytes:number;freeInodes:number};
export type CgroupCpu = {usageUsec:number;userUsec:number;systemUsec:number};
export type OwnCpu = {userUsec:number;systemUsec:number};
export type ScopeMemoryPeak = {readonly resettable:boolean;reset():void;read():number;close():void};
export type HostObservationFixture = {
  version:1;
  memory:{file:string};
  paging:{file:string};
  disk:DiskSpace;
  allocated:{kind:'fixed';defaultBytes:number;paths?:Record<string,number>}|{kind:'live'};
  cpu:{kind:'fixed';default:CgroupCpu;cgroups?:Record<string,CgroupCpu>}|{kind:'live'};
  selfCpu:{kind:'fixed';value:OwnCpu}|{kind:'live'};
  resident:{kind:'fixed';defaultBytes:number;processes?:Record<string,number>;cgroups?:Record<string,number>}|{kind:'live'};
  scopePeak:{kind:'fixed';bytes:number;resettable:boolean}|{kind:'live'};
  width:{logical:number;available:number};
  load:[number,number,number];
  clock:{kind:'live'}|{kind:'fixed';now:number}|{kind:'file';file:string};
  pressure:{kind:'live'}|{kind:'fixed';ownGroup:string;machine:PressureReading;default:PressureReading;cgroups?:Record<string,PressureReading>};
  loopDelay:{kind:'live'}|{kind:'fixed';value:LoopDelay};
};

export interface HostObservations {
  memory():MachineMemory;
  swap():{totalBytes:number;freeBytes:number};
  load():[number,number,number];
  paging():{inputPages:number;outputPages:number};
  disk(path:string):DiskSpace;
  allocatedBytes(path:string):number;
  processCharge(pid:number):number;
  cgroupCharge(path:string):number;
  cgroupCpu(path:string):CgroupCpu;
  ownCpu():OwnCpu;
  ownScopeMemoryPeak():ScopeMemoryPeak;
  scopeMemoryPeak(group:string):ScopeMemoryPeak;
  machineWidth():number;
  availableWidth():number;
  now():number;
  ownCgroup():string;
  machinePressure():PressureReading;
  cgroupPressure(group:string):PressureReading;
  loopDelay():LoopDelayMeter;
}

function checkedGroup(group:string):string{
  if(!group.startsWith('/')||group.split('/').includes('..')||group.includes('\n')||group.includes('\0'))throw new HostObservationError('host observation pressure cgroup path is invalid');
  return group;
}
function liveOwnCgroup():string{
  const match=/^0::(\/.*)$/m.exec(textFile('/proc/self/cgroup','pressure.ownCgroup'));
  if(!match)throw new HostObservationError('host observation pressure.ownCgroup is missing');
  return checkedGroup(match[1]!);
}
function livePressure(group?:string):PressureReading{
  const root=group===undefined?'/proc/pressure':`/sys/fs/cgroup${checkedGroup(group)}`;
  try{
    const identity=statSync(root,{bigint:true}),resources={} as PressureReading['resources'];
    for(const resource of PRESSURE_RESOURCES)resources[resource]=parsePressure(readFileSync(`${root}/${resource}${group===undefined?'':'.pressure'}`,'utf8'),`pressure.${root}.${resource}`);
    const after=statSync(root,{bigint:true});
    if(identity.dev!==after.dev||identity.ino!==after.ino)throw Error('scope identity changed during sampling');
    return {identity:`${root}:${identity.dev}:${identity.ino}`,resources};
  }catch(error){throw new HostObservationError(`host observation pressure ${root} failed: ${String(error)}`);}
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
function liveCgroupCpu(path:string):CgroupCpu { return parseCgroupCpu(readFileSync(`/sys/fs/cgroup${path}/cpu.stat`,'utf8')); }

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
function liveScopeMemoryPeak(requestedGroup?:string):ScopeMemoryPeak {
  let fd:number,group:string;
  try {
    const current=requestedGroup===undefined?readFileSync('/proc/self/cgroup','utf8').trim():'';
    group=requestedGroup??(current.startsWith('0::/')?current.slice(3):'');
    if(!group||group==='/'||group.split('/').includes('..')||group.includes('\n'))throw Error('own scope identity is invalid');
    fd=openSync(`/sys/fs/cgroup${group}/memory.peak`,'r+');
  } catch(error) {throw new HostObservationError(`host observation scopePeak cannot open own memory.peak: ${String(error)}`);}
  let resettable=false,closed=false;
  try{writeSync(fd,'reset\n');resettable=true;}catch{}
  const opened=()=>{if(closed)throw new HostObservationError('host observation scopePeak meter is closed');};
  return {resettable,
    reset:()=>{opened();if(!resettable)throw new HostObservationError('host observation scopePeak meter cannot reset');try{writeSync(fd,'reset\n');}catch(error){throw new HostObservationError(`host observation scopePeak reset failed: ${String(error)}`);}},
    read:()=>{opened();const buffer=Buffer.alloc(32);let size:number;try{size=readSync(fd,buffer,0,buffer.length,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ENODEV')throw new CgroupDeparted(group,error);throw new HostObservationError(`host observation scopePeak read failed: ${String(error)}`);}const text=buffer.toString('utf8',0,size).trim();if(!/^\d+$/.test(text))throw new HostObservationError('host observation scopePeak counter is invalid');return number(Number(text),'scopePeak.bytes');},
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
      if(value.pressure?.kind==='fixed'){
        checkedGroup(value.pressure.ownGroup);pressureReading(value.pressure.machine,'pressure.machine');pressureReading(value.pressure.default,'pressure.default');
      }else if(value.pressure?.kind!=='live')throw new HostObservationError('host observation pressure is missing or invalid');
      if(value.loopDelay?.kind==='fixed')loopDelay(value.loopDelay.value);
      else if(value.loopDelay?.kind!=='live')throw new HostObservationError('host observation loopDelay is missing or invalid');
      return value;
    };
    read();
    const charge=(kind:'processes'|'cgroups',key:string)=>{
      const resident=read().resident;
      if(resident?.kind==='live')return kind==='processes'?liveProcessCharge(Number(key)):liveCgroupCharge(key);
      if(resident?.kind!=='fixed')throw new HostObservationError('host observation resident is missing or invalid');
      return number(resident[kind]?.[key]??resident.defaultBytes,`resident.${kind}.${key}`);
    };
    const scopePeak=(group?:string):ScopeMemoryPeak=>{
      const initial=read().scopePeak;
      if(initial.kind==='live')return liveScopeMemoryPeak(group);
      let closed=false;
      const current=()=>{if(closed)throw new HostObservationError('host observation scopePeak meter is closed');const value=read().scopePeak;if(value.kind!=='fixed'||value.resettable!==initial.resettable)throw new HostObservationError('host observation scopePeak meter changed its kind or resettability');return value;};
      return {resettable:initial.resettable,reset:()=>{current();if(!initial.resettable)throw new HostObservationError('host observation scopePeak meter cannot reset');},read:()=>number(current().bytes,'scopePeak.bytes'),close:()=>{closed=true;}};
    };
    return {
      memory:()=>{const value=read();const contents=textFile(value.memory?.file,'memory.file');const parsed=parseMemory(contents);if(parsed===null)throw new HostObservationError('host observation memory has no MemAvailable and MemTotal');return parsed;},
      swap:()=>swap(read().memory.file),
      load:()=>read().load,
      paging:()=>paging(read().paging?.file??''),
      disk:()=>{const value=read().disk;return {freeBytes:number(value?.freeBytes,'disk.freeBytes'),freeInodes:number(value?.freeInodes,'disk.freeInodes')};},
      allocatedBytes:path=>{const value=read().allocated;return value.kind==='live'?liveAllocatedBytes(path,env):number(value.paths?.[path]??value.defaultBytes,'allocated.paths.'+path);},
      processCharge:pid=>charge('processes',String(pid)),
      cgroupCharge:path=>charge('cgroups',path),
      cgroupCpu:path=>{const cpu=read().cpu;if(cpu.kind==='live')return liveCgroupCpu(path);return cpuCounters(cpu.cgroups?.[path]??cpu.default,`cpu.cgroups.${path}`);},
      ownCpu:()=>{const value=read().selfCpu;return value.kind==='live'?liveOwnCpu():ownCpu(value.value);},
      ownScopeMemoryPeak:()=>scopePeak(),
      scopeMemoryPeak:group=>scopePeak(group),
      machineWidth:()=>number(read().width?.logical,'width.logical'),
      availableWidth:()=>number(read().width?.available,'width.available'),
      now:()=>{const value=read().clock;if(value?.kind==='live')return performance.now();if(value?.kind==='fixed')return number(value.now,'clock.now');if(value?.kind==='file'){const text=textFile(value.file,'clock.file').trim();if(!text)throw new HostObservationError('host observation clock.now is missing or invalid');return number(Number(text),'clock.now');}throw new HostObservationError('host observation clock is missing or invalid');},
      ownCgroup:()=>{const value=read().pressure;return value.kind==='live'?liveOwnCgroup():checkedGroup(value.ownGroup);},
      machinePressure:()=>{const value=read().pressure;return value.kind==='live'?livePressure():pressureReading(value.machine,'pressure.machine');},
      cgroupPressure:group=>{checkedGroup(group);const value=read().pressure;return value.kind==='live'?livePressure(group):pressureReading(value.cgroups?.[group]??{...value.default,identity:group+':'+value.default.identity},'pressure.cgroups.'+group);},
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
    swap:()=>swap('/proc/meminfo'),
    load:()=>loadavg() as [number,number,number],
    disk:path=>{let existing=resolve(path);while(!existsSync(existing))existing=dirname(existing);const value=statfsSync(existing);return {freeBytes:value.bavail*value.bsize,freeInodes:value.ffree};},
    allocatedBytes:path=>liveAllocatedBytes(path,env),
    processCharge:liveProcessCharge,
    cgroupCharge:liveCgroupCharge,
    cgroupCpu:liveCgroupCpu,
    ownCpu:liveOwnCpu,
    ownScopeMemoryPeak:liveScopeMemoryPeak,
    scopeMemoryPeak:liveScopeMemoryPeak,
    machineWidth:()=>cpus().length,
    availableWidth:()=>availableParallelism(),
    now:()=>performance.now(),
    ownCgroup:liveOwnCgroup,
    machinePressure:()=>livePressure(),
    cgroupPressure:livePressure,
    loopDelay:liveLoopDelay,
  };
}

function liveProcessCharge(pid:number):number { return parseProcessCharge(readFileSync(`/proc/${pid}/status`,'utf8')); }
function liveCgroupCharge(path:string):number {
  try{return parseCgroupCharge(readFileSync(`/sys/fs/cgroup${path}/memory.current`,'utf8'),readFileSync(`/sys/fs/cgroup${path}/memory.stat`,'utf8'));}
  catch(error){if(['ENOENT','ENODEV'].includes((error as NodeJS.ErrnoException).code??''))throw new CgroupDeparted(path,error);throw error;}
}

/** Only this owned grant crosses a sampler boundary; its data paths live in the grant. */
export function hostObservationEnvironment(env:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv {
  hostObservations(env);
  return env[HOST_OBSERVATIONS]?{[HOST_OBSERVATIONS]:env[HOST_OBSERVATIONS]}:{};
}
