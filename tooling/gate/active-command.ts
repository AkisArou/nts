// A command's exit decides its result. Silence can only leave it unmeasured.
import {execFileSync,spawn, type SpawnOptions} from "node:child_process";
import {readFileSync,readdirSync} from "node:fs";
import {publishHung,publishRunaway,publishToolingFailure,ToolingInstrumentError} from "./step-result.ts";

export const COMMAND_IDLE_GUARD_MS=5*60_000;
export const COMMAND_ACTIVITY_POLL_MS=5000;
export const COMMAND_CPU_BUDGET_SECONDS=30*60;
let ticksPerSecond:number|undefined;
function clockTicks(){
  if(ticksPerSecond!==undefined)return ticksPerSecond;
  const value=Number(execFileSync("getconf",["CLK_TCK"],{encoding:"utf8"}));
  if(!Number.isSafeInteger(value)||value<1)throw new Error("invalid process CPU clock frequency");
  return ticksPerSecond=value;
}

export function processActivity(text:string) {
  const end=text.lastIndexOf(")");
  if(end<0)throw new Error("invalid process activity record");
  const fields=text.slice(end+2).trim().split(/\s+/);
  const values=[2,3,11,12,13,14,19].map(at=>Number(fields[at]));
  if(values.some(value=>!Number.isSafeInteger(value)||value<0))throw new Error("invalid process activity counters");
  return {group:values[0],session:values[1],cpu:values.slice(2,6).reduce((sum,n)=>sum+n,0),started:values[6]};
}
function processAt(pid:number) {
  try{return processActivity(readFileSync(`/proc/${pid}/stat`,"utf8"));}
  catch(error){if(error.code==="ENOENT"||error.code==="ESRCH")return;throw error;}
}
type ProcessActivity=ReturnType<typeof processActivity>;
function activitySnapshot(owned:ReadonlySet<number>):ReadonlyMap<number,ProcessActivity> {
  const records=new Map<number,ProcessActivity>();
  for(const name of readdirSync("/proc")){
    if(!/^\d+$/.test(name))continue;
    let record;
    // A disappearing unrelated /proc entry cannot invalidate this command's
    // observer. An unreadable directly owned leader is an instrument failure.
    const pid=Number(name);
    try{record=processAt(pid);}catch(error){if(owned.has(pid))throw error;continue;}
    if(record&&owned.has(record.group))records.set(pid,record);
  }
  return records;
}

type ActivityWatch={group:number;started:number;pollMs:number;sample:(cpu:number)=>void;broken:(error:unknown)=>void};
/** One snapshot per tick for every live command; activity stays group-local. */
export class CommandActivitySampler {
  private readonly watches=new Set<ActivityWatch>();
  private timer:ReturnType<typeof setInterval>|undefined;
  private period:number|undefined;
  private readonly snapshot:typeof activitySnapshot;
  constructor(snapshot=activitySnapshot){this.snapshot=snapshot;}
  watch(watch:ActivityWatch):()=>void {
    if(!Number.isFinite(watch.pollMs)||watch.pollMs<=0)throw new Error("command activity interval must be positive");
    this.watches.add(watch);this.schedule();
    return ()=>{this.watches.delete(watch);this.schedule();};
  }
  private schedule():void {
    const period=this.watches.size?Math.min(...[...this.watches].map(watch=>watch.pollMs)):undefined;
    if(period===this.period)return;
    if(this.timer)clearInterval(this.timer);
    this.period=period;
    this.timer=period===undefined?undefined:setInterval(()=>this.sample(),period);
  }
  sample():void {
    const watches=[...this.watches];
    if(!watches.length)return;
    let records:ReadonlyMap<number,ProcessActivity>;
    try{records=this.snapshot(new Set(watches.map(watch=>watch.group)));}
    catch(error){for(const watch of watches)watch.broken(error);return;}
    const totals=new Map<number,number>();
    for(const record of records.values()){
      if(record.group===record.session)totals.set(record.group,(totals.get(record.group)??0)+record.cpu);
    }
    for(const watch of watches){
      if(!this.watches.has(watch))continue;
      try{
        const leader=records.get(watch.group);
        if(leader&&(leader.started!==watch.started||leader.group!==watch.group||leader.session!==watch.group))throw new Error("command process-group identity changed");
        watch.sample(totals.get(watch.group)??0);
      }catch(error){watch.broken(error);}
    }
  }
}
const activitySampler=new CommandActivitySampler();

export type ActiveResult={status:number|null;signal:NodeJS.Signals|null;out:string;stdout:string;stderr:string;error?:Error;hung?:string;runaway?:string;elapsedMs:number};
type Options={cwd:string;env:NodeJS.ProcessEnv;idleMs?:number;pollMs?:number;cpuBudgetSeconds?:number;
  onActivity?:(event:{cpu:number;elapsedMs:number;pid:number})=>void};

/** Own one process group while retaining the caller's cgroup and resource caps.
 * Group identity comes from spawn, never from a process search. /proc is read
 * only for activity; termination addresses that one directly owned group.
 */
export function activeCommand(command:string,args:readonly string[],options:Options):Promise<ActiveResult>{
  return new Promise((resolve,reject)=>{
    const began=performance.now(),idle=options.idleMs??COMMAND_IDLE_GUARD_MS;
    if(!Number.isFinite(idle)||idle<=0)throw new Error("command idle guard must be positive");
    const budget=options.cpuBudgetSeconds??COMMAND_CPU_BUDGET_SECONDS;
    if(!Number.isFinite(budget)||budget<=0)throw new Error("command CPU budget must be positive");
    let frequency;
    try{frequency=clockTicks();}catch(error){const failure=new ToolingInstrumentError("tooling-setup",`cannot observe command CPU time: ${String(error)}`);publishToolingFailure(failure,options.env);reject(failure);return;}
    const child=spawn(command,args,{cwd:options.cwd,env:options.env,detached:true,stdio:["ignore","pipe","pipe"]} satisfies SpawnOptions);
    let out="",stdout="",stderr="",last=began,cpu=0,started:number|undefined,error:Error|undefined,hung:string|undefined,runaway:string|undefined,instrument:ToolingInstrumentError|undefined;
    let cancelActivity=()=>{};
    const stop=()=>{
      if(!child.pid||child.pid<=1)return;
      // A re-used leader PID can never authorize signalling its new group.
      const leader=processAt(child.pid);
      if(started!==undefined&&leader&&(leader.started!==started||leader.group!==child.pid||leader.session!==child.pid))throw new Error("refusing to stop a changed command group");
      try{process.kill(-child.pid,"SIGKILL");}catch(error){if(error.code!=="ESRCH")throw error;}
    };
    const broken=(cause:unknown)=>{
      if(instrument)return;
      instrument=new ToolingInstrumentError("tooling-setup",`cannot observe activity for ${command}: ${String(cause)}`);
      publishToolingFailure(instrument,options.env);
      cancelActivity();
      try{stop();}catch(error){instrument=new ToolingInstrumentError("tooling-cleanup",`${instrument.message}; ${String(error)}`);publishToolingFailure(instrument,options.env);}
      child.stdout.destroy();child.stderr.destroy();
    };
    child.stdout.on("data",part=>{stdout+=part;out+=part;last=performance.now();});
    child.stderr.on("data",part=>{stderr+=part;out+=part;last=performance.now();});
    child.on("error",caught=>{error=caught;});
    child.on("close",(status,signal)=>{
      cancelActivity();
      // A helper can detach its stdio and outlive the leader without delaying
      // close. The directly owned group must finish with its command.
      try{stop();}catch(cause){
        instrument=new ToolingInstrumentError("tooling-cleanup",`cannot finish command group for ${command}: ${String(cause)}`);
        publishToolingFailure(instrument,options.env);
      }
      if(instrument)reject(instrument);
      else resolve({status,signal,out,stdout,stderr,error,hung,runaway,elapsedMs:performance.now()-began});
    });
    if(!child.pid)return; // spawn's error/close events retain their ordinary meaning.
    try{
      // Capture birth identity synchronously, before the event loop can reap a
      // fast child. Descendants can retain this group after its leader exits.
      const leader=processAt(child.pid);
      if(!leader||leader.group!==child.pid||leader.session!==child.pid)throw new Error("spawned command has no owned process group");
      started=leader.started;cpu=leader.cpu;
      cancelActivity=activitySampler.watch({group:child.pid,started,pollMs:options.pollMs??COMMAND_ACTIVITY_POLL_MS,broken,sample:measured=>{
        try{
          const now=performance.now();
          if(measured/frequency>=budget){
            runaway=`command NOT RUN (runaway): ${command}; process-group user+sys CPU ${(measured/frequency).toFixed(3)} s reached its ${budget} s budget`;
            publishRunaway(runaway,options.env);cancelActivity();stop();child.stdout.destroy();child.stderr.destroy();return;
          }
          // Membership/reaping races can lower a sampled group total. Reset
          // its baseline too, rather than hiding subsequent real CPU work.
          if(measured!==cpu){cpu=measured;last=now;options.onActivity?.({cpu,elapsedMs:now-began,pid:child.pid!});}
          if(now-last<idle)return;
          hung=`command NOT RUN (hung): ${command}; no output or process-group CPU activity for ${idle} ms`;
          publishHung(hung,options.env);cancelActivity();stop();child.stdout.destroy();child.stderr.destroy();
        }catch(error){broken(error);}
      }});
    }catch(error){broken(error);}
  });
}
