import {spawn,spawnSync} from 'node:child_process';
import {closeSync,openSync,readFileSync,statfsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {trainOwner} from '../lanes/train-service.ts';
import {heapCommand,heapReport} from './layouts-heap.ts';
import type {Adapter,Arm,Cell} from './layouts-sitting.ts';
import {parseUserEvents} from '../gate/cputime.mjs';

export function nativeResult(raw:string,n:number,warmup:number,checksum:string) {
  if(!Number.isSafeInteger(n)||n<1||n>50_000_000)throw Error('invalid bounded repetition count');
  if(raw.trim().split('\n').length!==1)throw Error('one JSON output line required');
  const value=JSON.parse(raw);
  if(value.checksum!==checksum||!/^[0-9a-f]{16}$/.test(value.checksum)||value.n!==n||value.warmup!==warmup
    ||!Number.isFinite(value.nsPerOp)||value.nsPerOp<=0||!Number.isFinite(value.elapsedNs)||value.elapsedNs<=0)
    throw Error('invalid output/work protocol');
  const result=Buffer.from(checksum,'hex').readDoubleBE(0);
  let expected=result;for(let i=0;i<n;i++)expected+=result;
  if(!Number.isFinite(result)||!Number.isFinite(expected)||!Number.isFinite(value.sink)||!Object.is(value.sink,expected)||Math.abs(value.nsPerOp*n-value.elapsedNs)>1+n*1e-6)
    throw Error('aggregate/time consistency failed');
  return value;
}

export function conditions(directory:string) {
  const memory=/^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync('/proc/meminfo','utf8'));
  if(!memory)throw Error('MemAvailable missing');
  const disk=statfsSync(directory);
  const owner=trainOwner(join(homedir(),'.cache/nts-land'));
  let frozen:any=null;
  try{frozen=JSON.parse(readFileSync(join(homedir(),'.cache/nts-land/frozen-train.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const train=owner?{id:owner.id,ownerPhase:owner.phase,gatePhase:frozen?.phase??null}:null;
  return {utc:new Date().toISOString(),memGiB:Number(memory[1])/1024**2,diskGiB:disk.bavail*disk.bsize/1024**3,
    load:readFileSync('/proc/loadavg','utf8').trim(),train};
}

export async function admitted(directory:string) {
  for(;;){const c=conditions(directory);if(c.diskGiB<40)throw Error('40 GiB disk floor');if(c.memGiB>=14)return c;await new Promise(r=>setTimeout(r,10000));}
}

export function nativeAdapter(binaries:Map<string,Record<Arm,string>>,library:string,n:number,checksum:string,directory:string):Adapter {
  return {admit:()=>admitted(directory),run:async(cell:Cell)=>{
    const counted=cell.phase==='paired',count=counted?n:2,warmup=1;
    const binary=binaries.get(cell.trial.id)?.[cell.arm];if(!binary)throw Error('missing layout executable');
    const report=join(cell.folder,'heap.jsonl');
    const command=heapCommand([binary,String(count)],library,cell.trial.heapSeed[cell.arm],report);
    const env={...process.env,NTS_BENCH_COUNT_MODE:'count',NTS_BENCH_COUNT_N:String(count),NTS_BENCH_COUNT_WARMUP:String(warmup)};
    delete env.NTS_BENCH_COUNT_CONTROL;delete env.NTS_BENCH_COUNT_ACK;
    const held:number[]=[];
    let argv=['taskset','-c','4',...command];
    if(counted){
      const control=join(cell.folder,'control'),ack=join(cell.folder,'ack');
      const made=spawnSync('mkfifo',[control,ack],{encoding:'utf8'});if(made.status!==0||made.error)throw Error('mkfifo: '+made.stderr);
      held.push(openSync(control,'r+'),openSync(ack,'r+'));
      env.NTS_BENCH_COUNT_CONTROL=control;env.NTS_BENCH_COUNT_ACK=ack;
      env.NTS_PROGRAM_STDERR=join(cell.folder,'program.stderr');
      argv=['taskset','-c','4','perf','stat','-D','-1','--control',`fifo:${control},${ack}`,'-x,','-o',join(cell.folder,'perf.csv'),'-e',
        'cpu_core/cycles/u,cpu_core/instructions/u,cpu_core/branches/u,cpu_core/branch-misses/u','--',
        '/usr/bin/time','-f','%M','-o',join(cell.folder,'rss-kib'),'sh','-c','exec "$@" 2>"$NTS_PROGRAM_STDERR"','bench',...command];
    }
    const stdout=openSync(join(cell.folder,'stdout'),'wx'),stderr=openSync(join(cell.folder,'stderr'),'wx');
    const invoked=['timeout','-k','5','120',...argv],start=conditions(directory);
    writeFileSync(join(cell.folder,'command.json'),JSON.stringify({argv:invoked,start},null,2));
    const child=spawn(invoked[0],invoked.slice(1),{cwd:directory,env,stdio:['ignore',stdout,stderr]});
    held.forEach(closeSync);closeSync(stdout);closeSync(stderr);
    const exit=await new Promise<any>(resolve=>{child.on('error',e=>resolve({error:e.message}));child.on('close',(status,signal)=>resolve({status,signal}));});
    const end=conditions(directory);writeFileSync(join(cell.folder,'exit.json'),JSON.stringify({...exit,end},null,2));
    if(exit.status!==0||exit.signal||exit.error)throw Error('execution failed; raw outputs retained');
    if(readFileSync(join(cell.folder,counted?'program.stderr':'stderr'),'utf8'))throw Error('program stderr is not empty');
    const value=nativeResult(readFileSync(join(cell.folder,'stdout'),'utf8'),count,warmup,checksum);
    const heap=heapReport(report,cell.trial.heapSeed[cell.arm]);
    // Threads created inside a hot call would include their prefix in the
    // window. This adapter currently accepts single-thread native rows only.
    if(heap.length!==1)throw Error('native hot adapter requires one main-thread heap report');
    if(!counted)return {signature:checksum,metrics:{},details:{value,heap,start,end,argv:invoked}};
    const events=parseUserEvents(readFileSync(join(cell.folder,'perf.csv'),'utf8'),['cycles','instructions','branches','branch-misses']);
    const rss=Number(readFileSync(join(cell.folder,'rss-kib'),'utf8').trim());
    if(!Number.isSafeInteger(rss)||rss<=0)throw Error('invalid peak RSS');
    return {signature:checksum,metrics:{nanoseconds:value.nsPerOp,cycles:events.cycles.value/n,instructions:events.instructions.value/n},
      details:{scope:'acknowledged-native-hot-window-v1',value,events,rssKiB:rss,heap,start,end,argv:invoked}};
  }};
}
