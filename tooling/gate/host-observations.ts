// Resource observations are a capability of a run. Tests provide a complete
// owned view, including observations made by dependencies and child processes.
import {closeSync,openSync,readFileSync,readSync,statfsSync,writeSync} from 'node:fs';
import {availableParallelism,cpus,loadavg} from 'node:os';
import {FIXTURE_ENVIRONMENT} from './cache-capabilities.ts';

export const HOST_OBSERVATIONS = 'NTS_HOST_OBSERVATIONS';
export const HOST_OBSERVATION_ENVIRONMENT = [HOST_OBSERVATIONS,'NTS_MEMINFO','NTS_VMSTAT','NTS_MEMORY_LEDGER','NTS_GATE_COSTS_DIR'] as const;
export class HostObservationError extends Error { override name='HostObservationError'; }
export type MachineMemory = {availableBytes:number;totalBytes:number};
export type DiskSpace = {freeBytes:number;freeInodes:number};
export type CgroupCpu = {usageUsec:number;userUsec:number;systemUsec:number};
export type ScopeMemoryPeak = {readonly resettable:boolean;reset():void;read():number;close():void};
export type HostObservationFixture = {
  version:1;
  memory:{file:string};
  paging:{file:string};
  disk:DiskSpace;
  cpu:{kind:'fixed';default:CgroupCpu;cgroups?:Record<string,CgroupCpu>}|{kind:'live'};
  resident:{kind:'fixed';defaultBytes:number;processes?:Record<string,number>;cgroups?:Record<string,number>}|{kind:'live'};
  scopePeak:{kind:'fixed';bytes:number;resettable:boolean}|{kind:'live'};
  width:{logical:number;available:number};
  load:[number,number,number];
  clock:{kind:'live'}|{kind:'fixed';now:number}|{kind:'file';file:string};
};

export interface HostObservations {
  memory():MachineMemory;
  swap():{totalBytes:number;freeBytes:number};
  load():[number,number,number];
  paging():{inputPages:number;outputPages:number};
  disk(path:string):DiskSpace;
  processCharge(pid:number):number;
  cgroupCharge(path:string):number;
  cgroupCpu(path:string):CgroupCpu;
  ownScopeMemoryPeak():ScopeMemoryPeak;
  machineWidth():number;
  availableWidth():number;
  now():number;
}

function number(value:unknown,name:string):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new HostObservationError(`host observation ${name} is missing or invalid`);
  return value;
}
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

/** memory.peak resets belong to an open descriptor, not to a cgroup path.
 * Retain the descriptor for the whole case stream and discover reset support
 * before a caller can mistake a whole-scope peak for a per-case measurement. */
function liveScopeMemoryPeak():ScopeMemoryPeak {
  let fd:number;
  try {
    const current=readFileSync('/proc/self/cgroup','utf8').trim(),group=current.startsWith('0::/')?current.slice(3):'';
    if(!group||group==='/'||group.split('/').includes('..')||group.includes('\n'))throw Error('own scope identity is invalid');
    fd=openSync(`/sys/fs/cgroup${group}/memory.peak`,'r+');
  } catch(error) {throw new HostObservationError(`host observation scopePeak cannot open own memory.peak: ${String(error)}`);}
  let resettable=false,closed=false;
  try{writeSync(fd,'reset\n');resettable=true;}catch{}
  const opened=()=>{if(closed)throw new HostObservationError('host observation scopePeak meter is closed');};
  return {resettable,
    reset:()=>{opened();if(!resettable)throw new HostObservationError('host observation scopePeak meter cannot reset');try{writeSync(fd,'reset\n');}catch(error){throw new HostObservationError(`host observation scopePeak reset failed: ${String(error)}`);}},
    read:()=>{opened();const buffer=Buffer.alloc(32);let size:number;try{size=readSync(fd,buffer,0,buffer.length,0);}catch(error){throw new HostObservationError(`host observation scopePeak read failed: ${String(error)}`);}const text=buffer.toString('utf8',0,size).trim();if(!/^\d+$/.test(text))throw new HostObservationError('host observation scopePeak counter is invalid');return number(Number(text),'scopePeak.bytes');},
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
      if(value.resident?.kind==='fixed')number(value.resident.defaultBytes,'resident.defaultBytes');
      else if(value.resident?.kind!=='live')throw new HostObservationError('host observation resident is missing or invalid');
      if(value.scopePeak?.kind==='fixed'){
        number(value.scopePeak.bytes,'scopePeak.bytes');
        if(typeof value.scopePeak.resettable!=='boolean')throw new HostObservationError('host observation scopePeak.resettable is missing or invalid');
      } else if(value.scopePeak?.kind!=='live')throw new HostObservationError('host observation scopePeak is missing or invalid');
      if(value.clock?.kind==='fixed')number(value.clock.now,'clock.now');
      else if(value.clock?.kind==='file'){if(!value.clock.file)throw new HostObservationError('host observation clock.file is missing or invalid');}
      else if(value.clock?.kind!=='live')throw new HostObservationError('host observation clock is missing or invalid');
      return value;
    };
    read();
    const charge=(kind:'processes'|'cgroups',key:string)=>{
      const resident=read().resident;
      if(resident?.kind==='live')return kind==='processes'?liveProcessCharge(Number(key)):liveCgroupCharge(key);
      if(resident?.kind!=='fixed')throw new HostObservationError('host observation resident is missing or invalid');
      return number(resident[kind]?.[key]??resident.defaultBytes,`resident.${kind}.${key}`);
    };
    return {
      memory:()=>{const value=read();const contents=textFile(value.memory?.file,'memory.file');const parsed=parseMemory(contents);if(parsed===null)throw new HostObservationError('host observation memory has no MemAvailable and MemTotal');return parsed;},
      swap:()=>swap(read().memory.file),
      load:()=>read().load,
      paging:()=>paging(read().paging?.file??''),
      disk:()=>{const value=read().disk;return {freeBytes:number(value?.freeBytes,'disk.freeBytes'),freeInodes:number(value?.freeInodes,'disk.freeInodes')};},
      processCharge:pid=>charge('processes',String(pid)),
      cgroupCharge:path=>charge('cgroups',path),
      cgroupCpu:path=>{const cpu=read().cpu;if(cpu.kind==='live')return liveCgroupCpu(path);return cpuCounters(cpu.cgroups?.[path]??cpu.default,`cpu.cgroups.${path}`);},
      ownScopeMemoryPeak:()=>{
        const initial=read().scopePeak;
        if(initial.kind==='live')return liveScopeMemoryPeak();
        let closed=false;
        const current=()=>{if(closed)throw new HostObservationError('host observation scopePeak meter is closed');const value=read().scopePeak;if(value.kind!=='fixed'||value.resettable!==initial.resettable)throw new HostObservationError('host observation scopePeak meter changed its kind or resettability');return value;};
        return {resettable:initial.resettable,reset:()=>{current();if(!initial.resettable)throw new HostObservationError('host observation scopePeak meter cannot reset');},read:()=>number(current().bytes,'scopePeak.bytes'),close:()=>{closed=true;}};
      },
      machineWidth:()=>number(read().width?.logical,'width.logical'),
      availableWidth:()=>number(read().width?.available,'width.available'),
      now:()=>{const value=read().clock;if(value?.kind==='live')return performance.now();if(value?.kind==='fixed')return number(value.now,'clock.now');if(value?.kind==='file'){const text=textFile(value.file,'clock.file').trim();if(!text)throw new HostObservationError('host observation clock.now is missing or invalid');return number(Number(text),'clock.now');}throw new HostObservationError('host observation clock is missing or invalid');},
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
    disk:path=>{const value=statfsSync(path);return {freeBytes:value.bavail*value.bsize,freeInodes:value.ffree};},
    processCharge:liveProcessCharge,
    cgroupCharge:liveCgroupCharge,
    cgroupCpu:liveCgroupCpu,
    ownScopeMemoryPeak:liveScopeMemoryPeak,
    machineWidth:()=>cpus().length,
    availableWidth:()=>availableParallelism(),
    now:()=>performance.now(),
  };
}

function liveProcessCharge(pid:number):number { return parseProcessCharge(readFileSync(`/proc/${pid}/status`,'utf8')); }
function liveCgroupCharge(path:string):number { return parseCgroupCharge(readFileSync(`/sys/fs/cgroup${path}/memory.current`,'utf8'),readFileSync(`/sys/fs/cgroup${path}/memory.stat`,'utf8')); }

/** Only this owned grant crosses a sampler boundary; its data paths live in the grant. */
export function hostObservationEnvironment(env:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv {
  hostObservations(env);
  return env[HOST_OBSERVATIONS]?{[HOST_OBSERVATIONS]:env[HOST_OBSERVATIONS]}:{};
}
