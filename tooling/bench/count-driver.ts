// One definition of --count for native and host columns. Neither sizing nor
// subtraction consults elapsed time: raw brackets remain beside the net count.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {closeSync,mkdirSync,openSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {durableRecord} from '../gate/durable-record.ts';
import {FIXED_AMBIENT,hostEnvironment} from '../gate/canonical-environment.ts';
import {runAsCommand} from '../differential/command-entry/main.ts';

export const COUNT_INSTRUMENT='instruction-calibrated-empty-subtracted-v1';
// Count enough work to amortize residual counter resolution, without making
// the chosen work depend on machine load. The existing driver bound remains.
export const COUNT_TARGET_INSTRUCTIONS=100_000_000;
const MAX_REPETITIONS=50_000_000;
type Value={checksum:string;n:number;warmup:number;nsPerOp:number;[key:string]:unknown};
type Bracket={instructions:number;value:Value;receipt?:unknown};
type Sample=(n:number,warmup:number,arm:string)=>Promise<Bracket>;
function positive(value:number,what:string):number{
  assert.ok(Number.isSafeInteger(value)&&value>0,'count driver: invalid '+what);return value;
}
export function instructionCount(csv:string):number{
  const counters=csv.split('\n').map(line=>line.split(',').map(field=>field.trim()))
    .filter(fields=>/^(?:cpu_(?:core|atom)\/instructions\/u|instructions:u)$/.test(fields[2]??'')&&fields[0]!=='<not counted>');
  assert.ok(counters.length===1&&/^\d+$/.test(counters[0]![0]!)&&Number(counters[0]![4])>=99,'count driver: instructions must run on one pinned PMU');
  return positive(Number(counters[0]![0]),'raw instructions');
}
export async function netCount(sample:Sample){
  const brackets:Record<string,Bracket>={};
  const take=async(n:number,warmup:number,arm:string)=>{
    const row=await sample(n,warmup,arm);positive(row.instructions,'raw instructions');
    assert.equal(row.value.n,n,'count driver: driver changed the requested work');
    assert.equal(row.value.warmup,warmup,'count driver: driver changed the requested warmup');
    assert.ok(typeof row.value.checksum==='string'&&row.value.checksum.length>0,'count driver: driver named no checksum');
    if(brackets['probe-empty'])assert.equal(row.value.checksum,brackets['probe-empty'].value.checksum,'count driver: checksums disagree');
    brackets[arm]=row;return row;
  };
  const probeEmpty=await take(0,0,'probe-empty'),probe=await take(1,0,'probe');
  const perOperation=positive(probe.instructions-probeEmpty.instructions,'one-operation net instructions');
  const reps=Math.min(MAX_REPETITIONS,Math.max(1,Math.ceil(COUNT_TARGET_INSTRUCTIONS/perOperation)));
  // Exactly the same warmup in the empty and work processes. Its size comes
  // from instructions too; no wall-clock calibration survives in count mode.
  const empty=await take(0,reps,'empty'),work=await take(reps,reps,'work');
  const instructions=positive(work.instructions-empty.instructions,'empty-subtracted instructions');
  assert.ok(Number.isFinite(work.value.nsPerOp)&&work.value.nsPerOp>0,'count driver: invalid driver timing');
  return {instrument:COUNT_INSTRUMENT,instructions,counted:work.value,
    calibration:{reps,warmup:reps,target_instructions:COUNT_TARGET_INSTRUCTIONS,one_operation_instructions:perOperation},brackets};
}

function capture(command:string[],cwd:string,env:NodeJS.ProcessEnv){
  return new Promise<{command:string[];cwd:string;status:number|null;signal:NodeJS.Signals|null;stdout:string;stderr:string}>((resolve,reject)=>{
    const child=spawn(command[0]!,command.slice(1),{cwd,env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',part=>{stdout+=part;});child.stderr.on('data',part=>{stderr+=part;});
    child.once('error',reject);child.once('close',(status,signal)=>resolve({command,cwd,status,signal,stdout,stderr}));
  });
}
export async function countDriver(options:{program:string;args:string[];cwd:string;folder:string;cpu:number;env:NodeJS.ProcessEnv}){
  const {program,args,cwd,folder,cpu}=options;
  assert.ok(Number.isSafeInteger(cpu)&&cpu>=0&&![4,5].includes(cpu),'count driver: CPU must be outside 4-5');
  mkdirSync(folder,{recursive:true});
  const environment={...options.env};delete environment.NTS_BENCH_STARTUP;
  for(const name of Object.keys(environment))if(name.startsWith('NTS_BENCH_COUNT_'))delete environment[name];
  const result=await netCount(async(n,warmup,arm)=>{
    const directory=join(folder,arm);mkdirSync(directory,{recursive:true});
    const control=join(directory,'control'),ack=join(directory,'ack'),csv=join(directory,'perf.csv');
    for(const path of [control,ack])rmSync(path,{force:true});
    const made=spawnSync('mkfifo',[control,ack],{env:environment,encoding:'utf8',timeout:120_000});
    assert.equal(made.status,0,'count driver: mkfifo failed: '+(made.error?.message??made.stderr));
    const held=[openSync(control,'r+'),openSync(ack,'r+')];
    try{
      const env={...environment,NTS_BENCH_COUNT_MODE:'count',NTS_BENCH_COUNT_N:String(n),NTS_BENCH_COUNT_WARMUP:String(warmup),
        NTS_BENCH_COUNT_CONTROL:control,NTS_BENCH_COUNT_ACK:ack};
      const event=cpu<16?'cpu_core/instructions/u':'instructions:u';
      const receipt=await capture(['timeout','-k','5','120','perf','stat','-D','-1','--control',`fifo:${control},${ack}`,'-x,','-o',csv,
        '-e',event,'--','taskset','-c',String(cpu),program,...args],cwd,env);
      assert.equal(receipt.status,0,'count driver: counted run failed: '+(receipt.stderr||receipt.signal));
      const line=receipt.stdout.trim().split('\n').at(-1);assert.ok(line,'count driver: driver printed nothing');
      const value=JSON.parse(line) as Value;
      return {instructions:instructionCount(readFileSync(csv,'utf8')),value,receipt};
    }finally{held.forEach(closeSync);}
  });
  durableRecord(join(folder,'net-count.json'),result);return result;
}

runAsCommand(import.meta.url,async()=>{
  const [cpu,folder,separator,program,...args]=process.argv.slice(2);
  assert.ok(cpu&&/^\d+$/.test(cpu)&&folder&&separator==='--'&&program,'usage: count-driver.ts <cpu> <folder> -- <program> [args...]');
  // These are benchmark programs, not tooling children: only declared host
  // tools, fixed ambient values and this counter's own temporary cross over.
  const env={...hostEnvironment(process.env),...FIXED_AMBIENT,TMPDIR:folder};
  console.log(JSON.stringify(await countDriver({cpu:Number(cpu),folder,program,args,cwd:process.cwd(),env})));
});
