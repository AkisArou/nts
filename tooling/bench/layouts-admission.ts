// Observe refused admission. Never signal a sampled PID, alter affinity, or
// substitute these diagnostics for the reserved-core guard's own decision.
import {spawnSync} from 'node:child_process';
import {closeSync,mkdirSync,openSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {coreTicks} from '../gate/measurement.ts';

export function taskStat(pid:number,tid:number,text:string){
  const end=text.lastIndexOf(')'),begin=text.indexOf('('),fields=text.slice(end+2).trim().split(/\s+/);
  const numbers=[Number(fields[11]),Number(fields[12]),Number(fields[19]),Number(fields[36])];
  if(begin<0||end<=begin||numbers.some(n=>!Number.isSafeInteger(n)||n<0))throw Error('invalid task stat');
  return {pid,tid,comm:text.slice(begin+1,end),ticks:numbers[0]+numbers[1],birth:numbers[2],cpu:numbers[3]};
}

function snapshot(){
  const tasks=new Map<string,ReturnType<typeof taskStat>>();let unreadable=0;
  for(const pid of readdirSync('/proc'))if(/^\d+$/.test(pid)){
    try {for(const tid of readdirSync(`/proc/${pid}/task`)){
      if(tasks.size>=100000)throw Error('offender snapshot task bound exceeded');
      try {tasks.set(pid+':'+tid,taskStat(Number(pid),Number(tid),readFileSync(`/proc/${pid}/task/${tid}/stat`,'utf8')));}
      catch(e){if(e.code==='ENOENT'||e.code==='ESRCH'||e.code==='EACCES')unreadable++;else throw e;}
    }}catch(e){if(e.code==='ENOENT'||e.code==='ESRCH'||e.code==='EACCES')unreadable++;else throw e;}
  }
  return {utc:new Date().toISOString(),tasks,unreadable,cpus:Object.fromEntries(coreTicks(readFileSync('/proc/stat','utf8'))),
    interrupts:interrupts(readFileSync('/proc/interrupts','utf8')),softirqs:interrupts(readFileSync('/proc/softirqs','utf8'))};
}

export function interrupts(text:string){
  const lines=text.trim().split('\n'),header=lines.shift()?.trim().split(/\s+/)??[];
  const columns=[header.indexOf('CPU4'),header.indexOf('CPU5')];
  if(columns.some(n=>n<0))throw Error('reserved interrupt columns missing');
  const result:Record<string,{cpu4:number;cpu5:number;description:string}>={};
  for(const line of lines){const m=/^\s*(\S+):\s+(.*)$/.exec(line);if(!m)continue;const fields=m[2].split(/\s+/);
    const [cpu4,cpu5]=columns.map(i=>Number(fields[i]));if(!Number.isSafeInteger(cpu4)||!Number.isSafeInteger(cpu5)||cpu4<0||cpu5<0)continue;
    result[m[1]]={cpu4,cpu5,description:fields.slice(header.length).join(' ')};
  }
  return result;
}

function interruptDeltas(before:ReturnType<typeof interrupts>,after:ReturnType<typeof interrupts>){
  return Object.entries(after).flatMap(([irq,row])=>{
    const old=before[irq];if(!old)return [{irq,...row,newlyObserved:true}];
    const cpu4=row.cpu4-old.cpu4,cpu5=row.cpu5-old.cpu5;
    return cpu4||cpu5?[{irq,cpu4,cpu5,description:row.description}]:[];
  });
}

export async function sampleOffenders(){
  const before=snapshot();await delay(3000);const after=snapshot();const offenders=[];
  for(const [key,current]of after.tasks){
    const previous=before.tasks.get(key);
    if(!previous||previous.birth!==current.birth)continue;
    const ticks=current.ticks-previous.ticks;
    if(ticks<=0||(![4,5].includes(previous.cpu)&&![4,5].includes(current.cpu)))continue;
    let allowed:string|null=null;
    try {allowed=/^Cpus_allowed_list:\s*(.+)$/m.exec(readFileSync(`/proc/${current.pid}/task/${current.tid}/status`,'utf8'))?.[1]??null;}catch{}
    offenders.push({pid:current.pid,tid:current.tid,comm:current.comm,ticks,cpuBefore:previous.cpu,cpuAfter:current.cpu,allowed});
  }
  return {start:before.utc,end:after.utc,tasksBefore:before.tasks.size,tasksAfter:after.tasks.size,
    unreadable:before.unreadable+after.unreadable,cpusBefore:before.cpus,cpusAfter:after.cpus,offenders,
    interrupts:interruptDeltas(before.interrupts,after.interrupts),softirqs:interruptDeltas(before.softirqs,after.softirqs),
    interpretation:'Positive per-task tick delta with a reserved-CPU endpoint: candidate offenders, not attribution of every tick to that CPU. Sample follows refusal.'};
}

export async function withLayoutLock(command:string[],stem:string,timeout=1_500_000){
  mkdirSync(dirname(stem),{recursive:true});
  const stdout=openSync(stem+'.stdout','wx'),stderr=openSync(stem+'.stderr','wx');
  const start=new Date().toISOString();
  const r=spawnSync('sh',[join(import.meta.dirname,'../gate/with-lock.sh'),'--wait',...command],{stdio:['ignore',stdout,stderr],timeout});
  closeSync(stdout);closeSync(stderr);
  const refused=r.status===75&&readFileSync(stem+'.stderr','utf8').includes('CPUs 4-5 did not become quiet');
  let sample:any=null;
  if(refused){try {sample=await sampleOffenders();}catch(error){sample={error:String(error)};}}
  const record={start,end:new Date().toISOString(),command,status:r.status,signal:r.signal,error:r.error?.message,
    admission:refused?'refused':r.status===0?'accepted':'command-failed-or-unknown',sample};
  writeFileSync(stem+'.admission.json',JSON.stringify(record,null,2)+'\n');
  return record;
}
