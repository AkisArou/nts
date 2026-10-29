// A command's exit decides its result. Silence can only leave it unmeasured.
import {spawn, type SpawnOptions} from "node:child_process";
import {readFileSync,readdirSync} from "node:fs";
import {publishHung,publishToolingFailure,ToolingInstrumentError} from "./step-result.ts";

export const COMMAND_IDLE_GUARD_MS=5*60_000;
export const COMMAND_ACTIVITY_POLL_MS=1000;

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
function groupCpu(group:number,started:number) {
  const leader=processAt(group);
  if(leader&&(leader.started!==started||leader.group!==group||leader.session!==group))throw new Error("command process-group identity changed");
  let ticks=0;
  for(const name of readdirSync("/proc")){
    if(!/^\d+$/.test(name))continue;
    let record;
    try{record=processAt(Number(name));}catch(error){if(error.code==="EACCES"||error.code==="EPERM")continue;throw error;}
    if(record?.group===group&&record.session===group)ticks+=record.cpu;
  }
  return ticks;
}

export type ActiveResult={status:number|null;signal:NodeJS.Signals|null;out:string;error?:Error;hung?:string;elapsedMs:number};
type Options={cwd:string;env:NodeJS.ProcessEnv;idleMs?:number;pollMs?:number;
  onActivity?:(event:{cpu:number;elapsedMs:number;pid:number})=>void};

/** Own one process group while retaining the caller's cgroup and resource caps.
 * Group identity comes from spawn, never from a process search. /proc is read
 * only for activity; termination addresses that one directly owned group.
 */
export function activeCommand(command:string,args:readonly string[],options:Options):Promise<ActiveResult>{
  return new Promise((resolve,reject)=>{
    const began=performance.now(),idle=options.idleMs??COMMAND_IDLE_GUARD_MS;
    if(!Number.isFinite(idle)||idle<=0)throw new Error("command idle guard must be positive");
    const child=spawn(command,args,{cwd:options.cwd,env:options.env,detached:true,stdio:["ignore","pipe","pipe"]} satisfies SpawnOptions);
    let out="",last=began,cpu=0,started:number|undefined,error:Error|undefined,hung:string|undefined,instrument:ToolingInstrumentError|undefined;
    let timer:ReturnType<typeof setInterval>|undefined;
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
      if(timer)clearInterval(timer);
      try{stop();}catch(error){instrument=new ToolingInstrumentError("tooling-cleanup",`${instrument.message}; ${String(error)}`);publishToolingFailure(instrument,options.env);}
      child.stdout.destroy();child.stderr.destroy();
    };
    child.stdout.on("data",part=>{out+=part;last=performance.now();});
    child.stderr.on("data",part=>{out+=part;last=performance.now();});
    child.on("error",caught=>{error=caught;});
    child.on("close",(status,signal)=>{
      if(timer)clearInterval(timer);
      if(instrument)reject(instrument);
      else resolve({status,signal,out,error,hung,elapsedMs:performance.now()-began});
    });
    if(!child.pid)return; // spawn's error/close events retain their ordinary meaning.
    try{
      // Capture birth identity synchronously, before the event loop can reap a
      // fast child. Descendants can retain this group after its leader exits.
      const leader=processAt(child.pid);
      if(!leader||leader.group!==child.pid||leader.session!==child.pid)throw new Error("spawned command has no owned process group");
      started=leader.started;cpu=leader.cpu;
      timer=setInterval(()=>{
        try{
          const now=performance.now(),measured=groupCpu(child.pid!,started!);
          // Membership/reaping races can lower a sampled group total. Reset
          // its baseline too, rather than hiding subsequent real CPU work.
          if(measured!==cpu){cpu=measured;last=now;options.onActivity?.({cpu,elapsedMs:now-began,pid:child.pid!});}
          if(now-last<idle)return;
          hung=`command NOT RUN (hung): ${command}; no output or process-group CPU activity for ${idle} ms`;
          publishHung(hung,options.env);clearInterval(timer);stop();child.stdout.destroy();child.stderr.destroy();
        }catch(error){broken(error);}
      },options.pollMs??COMMAND_ACTIVITY_POLL_MS);
    }catch(error){broken(error);}
  });
}
