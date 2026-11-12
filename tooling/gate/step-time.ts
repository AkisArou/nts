import type {CgroupCpu} from './host-observations.ts';

export const STEP_CPU_MEASURE='cgroup-v2-scope-v1';
export const GNU_CPU_MEASURE='wait4-rusage-v1';
export type GnuTime={version:1;cpu_measure:typeof GNU_CPU_MEASURE;wall:number;cpu:number;user:number;sys:number;maxrss_kb:number};
export type StepTime={version:1;cpu_measure:typeof STEP_CPU_MEASURE;wall:number;cpu:number;user:number;sys:number;cpu_counters:CgroupCpu;gnu_time?:GnuTime;maxrss_kb?:number};
export type BaselineTime={wall:number;cpu:number;slots:number;cpu_measure:string};
const nonnegative=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;

/** GNU time remains a named comparison; it cannot substitute for scope CPU. */
export function parseGnuTime(text:string):GnuTime|undefined {
  const values=text.trim().split('\n').at(-1)?.trim().split(/\s+/).map(Number);
  if(!values||values.length!==4||!values.every(nonnegative))return;
  const [wall,user,sys,maxrss_kb]=values as [number,number,number,number];
  return {version:1,cpu_measure:GNU_CPU_MEASURE,wall,cpu:user+sys,user,sys,maxrss_kb};
}

export function measuredStepTime(cpu:CgroupCpu,wall:number,gnu_time?:GnuTime):StepTime {
  if(!nonnegative(wall)||![cpu.usageUsec,cpu.userUsec,cpu.systemUsec].every(n=>Number.isSafeInteger(n)&&n>=0))throw new Error('invalid step CPU or wall measurement');
  return {version:1,cpu_measure:STEP_CPU_MEASURE,wall,cpu:cpu.usageUsec/1e6,user:cpu.userUsec/1e6,sys:cpu.systemUsec/1e6,
    cpu_counters:cpu,...(gnu_time?{gnu_time,maxrss_kb:gnu_time.maxrss_kb}:{})};
}

/** A fifth column identifies the CPU instrument. Four-column rows are legacy. */
export function readStepBaseline(text:string):Map<string,BaselineTime> {
  const rows=new Map<string,BaselineTime>();
  for(const line of text.split('\n')){
    if(!line||line.startsWith('#'))continue;
    const [name,wall,cpu,slots,measure]=line.split('\t');
    if(!name||!wall||cpu===undefined||!cpu.trim()||![Number(wall),Number(cpu),Number(slots??0)].every(nonnegative))continue;
    rows.set(name,{wall:Number(wall),cpu:Number(cpu),slots:Number(slots??0),cpu_measure:measure||GNU_CPU_MEASURE});
  }
  return rows;
}
export function currentStepCpu(row:{cpu?:number;cpu_measure?:string}|undefined):number|undefined {
  return row?.cpu_measure===STEP_CPU_MEASURE&&nonnegative(row.cpu)?row.cpu:undefined;
}

export function validGnuTime(value:unknown):value is GnuTime {
  if(typeof value!=='object'||value===null)return false;
  const row=value as Record<string,unknown>;
  return row.version===1&&row.cpu_measure===GNU_CPU_MEASURE&&['wall','cpu','user','sys','maxrss_kb'].every(key=>nonnegative(row[key]));
}
export function zeroGnuTime():GnuTime { return {version:1,cpu_measure:GNU_CPU_MEASURE,wall:0,cpu:0,user:0,sys:0,maxrss_kb:0}; }
export function cpuByMeasure(rows:readonly {cpu?:number;cpu_measure?:string;verdict?:string}[]):Record<string,number>|null {
  const totals:Record<string,number>={};
  for(const row of rows){
    if(row.cpu===undefined&&row.verdict==='SKIPPED')continue;
    if(!nonnegative(row.cpu))return null;
    const measure=row.cpu_measure??GNU_CPU_MEASURE;
    totals[measure]=(totals[measure]??0)+row.cpu;
  }
  return totals;
}
