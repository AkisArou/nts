// A liveness verdict depends only on this command's supplied observations.
// Process ownership, pipes and publishing belong to active-process.ts.
export const COMMAND_IDLE_GUARD_MS=5*60_000;
export const COMMAND_CPU_BUDGET_SECONDS=30*60;
// Scope setup includes DBus and cgroup work under shared-host load. A minute
// allows slow launches; absence of bounded entry beyond it means the launcher
// is wedged. This is a tooling-setup failure, never a compiled-case outcome.
export const COMMAND_STARTUP_BOUND_MS=60_000;
export type CommandPolicy={idleMs?:number;cpuBudgetSeconds?:number;ownCpuSeconds?:number;eachProcessCpuSeconds?:number;startupMs?:number};
export type CommandSample={now:number;cpu:number;own:number;busy:boolean;processOwn:{pid:number;cpu:number};entered?:boolean};
export type CommandDecision={kind:'hung'|'runaway'|'timeout'|'startup';reason:string};
const positive=(value:number,name:string)=>{if(!Number.isFinite(value)||value<=0)throw Error(name+' must be positive');return value;};
const observation=(value:number,name:string)=>{if(!Number.isFinite(value)||value<0)throw Error('command observation '+name+' is missing or invalid');return value;};

export function validateCommandPolicy(policy:CommandPolicy):void{
  positive(policy.idleMs??COMMAND_IDLE_GUARD_MS,'command idle guard');
  positive(policy.cpuBudgetSeconds??COMMAND_CPU_BUDGET_SECONDS,'command CPU budget');
  if(policy.ownCpuSeconds!==undefined)positive(policy.ownCpuSeconds,'command own CPU bound');
  if(policy.eachProcessCpuSeconds!==undefined)positive(policy.eachProcessCpuSeconds,'build process CPU bound');
  if(policy.startupMs!==undefined)positive(policy.startupMs,'bounded-entry startup bound');
}

export class CommandLiveness {
  readonly began:number;
  readonly idle:number;
  readonly budget:number;
  readonly frequency:number;
  readonly ownBound:number|undefined;
  readonly processBound:number|undefined;
  private readonly command:string;
  private last:number;
  private clock:number;
  private used=0;
  private entered:boolean;
  private readonly startup:number|undefined;
  get cpu():number{return this.used;}
  constructor(command:string,policy:CommandPolicy,began:number,frequency:number){
    validateCommandPolicy(policy);
    this.startup=policy.startupMs;this.entered=this.startup===undefined;
    this.command=command;this.began=observation(began,'clock');this.last=began;this.clock=began;
    this.frequency=positive(frequency,'command observation CPU clock frequency');
    this.idle=policy.idleMs??COMMAND_IDLE_GUARD_MS;
    this.budget=policy.cpuBudgetSeconds??COMMAND_CPU_BUDGET_SECONDS;
    this.ownBound=policy.ownCpuSeconds;this.processBound=policy.eachProcessCpuSeconds;
  }
  elapsed(now:number):number{
    observation(now,'clock');if(now<this.clock)throw Error('command observation clock moved backwards');
    this.clock=now;return now-this.began;
  }
  baseline(cpu:number):void{this.used=observation(cpu,'initial CPU');}
  output(now:number):void{this.elapsed(now);this.last=now;}
  sample(reading:CommandSample):CommandDecision|undefined{
    const {now,cpu:measured,own,busy,processOwn}=reading;
    this.elapsed(now);observation(measured,'CPU');observation(own,'own CPU');observation(processOwn?.cpu,'process CPU');
    if(!Number.isSafeInteger(processOwn.pid)||processOwn.pid<1)throw Error('command observation process identity is missing or invalid');
    if(typeof busy!=='boolean')throw Error('command observation busy state is missing or invalid');
    if(!this.entered){
      if(typeof reading.entered!=='boolean')throw Error('command observation bounded entry is missing or invalid');
      if(!reading.entered){
        this.used=measured;
        if(now-this.began>=this.startup!)return {kind:'startup',reason:`${this.command}: bounded worker did not enter within its ${this.startup} ms startup bound`};
        return;
      }
      this.entered=true;this.last=now;this.used=measured;
    }
    const command=this.command,frequency=this.frequency;
    if(this.ownBound!==undefined&&own/frequency>=this.ownBound)return {kind:'timeout',reason:`${command} used its ${this.ownBound} s CPU bound: its own CPU reached ${(own/frequency).toFixed(3)} s`};
    if(this.processBound!==undefined&&processOwn.cpu/frequency>=this.processBound)return {kind:'timeout',reason:`${command} used its ${this.processBound} s CPU bound: process ${processOwn.pid} own CPU reached ${(processOwn.cpu/frequency).toFixed(3)} s`};
    if(measured/frequency>=this.budget)return {kind:'runaway',reason:`command NOT RUN (runaway): ${command}; process-group user+sys CPU ${(measured/frequency).toFixed(3)} s reached its ${this.budget} s budget`};
    // Reaping may lower the total; that still establishes a new baseline.
    if(measured!==this.used){this.used=measured;this.last=now;}
    else if(busy)this.last=now;
    if(now-this.last<this.idle)return;
    return {kind:'hung',reason:`command NOT RUN (hung): ${command}; no output, process-group CPU activity or busy thread for ${this.idle} ms`};
  }
}
