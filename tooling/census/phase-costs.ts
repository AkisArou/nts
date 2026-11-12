// Exclusive worker phases. Child CPU is added only from that child's wait4.
// A clock/CPU observation is replaceable as a whole in arithmetic controls.
import {execFileSync,spawnSync,type ExecFileSyncOptionsWithStringEncoding,type SpawnSyncOptionsWithStringEncoding,type SpawnSyncReturns} from 'node:child_process';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {appendFileSync,existsSync} from 'node:fs';
import {hostObservations} from '../gate/host-observations.ts';
import {observedSpawnSync,type ChildObserver} from '../gate/child-rusage.ts';

export type WorkerPhase='materialization'|'host_compile_link'|'execution'|'comparison';
export type PhaseCost={phase:WorkerPhase;wall_s:number;self_cpu_s:number;child_cpu_s:number};
export type CensusPhaseFrame={version:1;project:string;backend:string;step:string;compiler_observations:string[];phases:PhaseCost[];unmeasured:string[]};
export type PhaseSample={wall:number;user:number;sys:number};
export type PhaseClock=()=>PhaseSample;

export function readCensusPhaseFrame(value:unknown):CensusPhaseFrame{
  const row=value as CensusPhaseFrame;
  if(!row||row.version!==1||!['project','backend','step'].every(key=>typeof (row as unknown as Record<string,unknown>)[key]==='string')
    ||!Array.isArray(row.compiler_observations)||row.compiler_observations.some(id=>typeof id!=='string'||!id)
    ||!Array.isArray(row.unmeasured)||row.unmeasured.some(error=>typeof error!=='string')||!Array.isArray(row.phases)
    ||row.phases.some(phase=>!phase||!['materialization','host_compile_link','execution','comparison'].includes(phase.phase)
      ||![phase.wall_s,phase.self_cpu_s,phase.child_cpu_s].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0)))
    throw Error('invalid census phase frame');
  return row;
}

export function recordCensusPhaseFrame(value:unknown,env:NodeJS.ProcessEnv=process.env):void{
  if(!env.NTS_GATE_CASE_COSTS_DIR)return;
  try{
    const frame=readCensusPhaseFrame(value);
    appendFileSync(join(env.NTS_GATE_CASE_COSTS_DIR,`census-${process.pid}.jsonl`),JSON.stringify(frame)+'\n');
  }catch{/* Missing telemetry is reported by the summary, never a program verdict. */}
}

export class CensusPhaseCosts {
  readonly frame:CensusPhaseFrame;
  #clock:PhaseClock;
  #observer:ChildObserver|undefined;
  #current:WorkerPhase|undefined;
  #last:PhaseSample|undefined;
  constructor(project:string,backend:string,step:string,clock:PhaseClock,observer?:ChildObserver){
    this.frame={version:1,project,backend,step,compiler_observations:[],phases:[],unmeasured:[]};this.#clock=clock;this.#observer=observer;
  }
  #row(phase:WorkerPhase):PhaseCost{
    let row=this.frame.phases.find(row=>row.phase===phase);
    if(!row){row={phase,wall_s:0,self_cpu_s:0,child_cpu_s:0};this.frame.phases.push(row);}
    return row;
  }
  #advance():void{
    const now=this.#clock();
    if(this.#current&&this.#last){
      const row=this.#row(this.#current),wall=now.wall-this.#last.wall,cpu=(now.user-this.#last.user)+(now.sys-this.#last.sys);
      if(wall<0||cpu<0||![wall,cpu].every(Number.isFinite))this.frame.unmeasured.push('worker phase clock or CPU moved backwards');
      else{row.wall_s+=wall;row.self_cpu_s+=cpu;}
    }
    this.#last=now;
  }
  span(phase:WorkerPhase):()=>void{
    this.#advance();const previous=this.#current;this.#current=phase;this.#row(phase);
    return ()=>{this.#advance();this.#current=previous;};
  }
  measure<T>(phase:WorkerPhase,work:()=>T):T{
    const close=this.span(phase);try{return work();}finally{close();}
  }
  finish():CensusPhaseFrame{this.#advance();this.#current=undefined;return this.frame;}
  compilerEnvironment():NodeJS.ProcessEnv{
    const id=randomUUID();this.frame.compiler_observations.push(id);return {NTS_GATE_COMPILER_OBSERVATION:id};
  }
  spawn(command:string,args:readonly string[],options:SpawnSyncOptionsWithStringEncoding):SpawnSyncReturns<string>{
    if(!this.#observer){this.frame.unmeasured.push(`wait4 observer missing: ${command}`);return spawnSync(command,[...args],options);}
    return observedSpawnSync(command,args,options,this.#observer,(usage,error)=>{
      if(!usage||!this.#current){this.frame.unmeasured.push(error??`child outside a phase: ${command}`);return;}
      this.#row(this.#current).child_cpu_s+=usage.user_s+usage.sys_s;
    });
  }
  exec(command:string,args:readonly string[],options:ExecFileSyncOptionsWithStringEncoding):string{
    if(!this.#observer){this.frame.unmeasured.push(`wait4 observer missing: ${command}`);return execFileSync(command,[...args],options);}
    const result=this.spawn(command,args,{...options,encoding:options.encoding??'utf8'});
    if(result.error)throw Object.assign(result.error,result);
    if(result.status!==0)throw Object.assign(Error(`Command failed: ${command} ${args.join(' ')}\n${result.stderr??''}`),result);
    return result.stdout;
  }
}

export function censusPhaseCosts(project:string,backend:string,env:NodeJS.ProcessEnv=process.env):CensusPhaseCosts|undefined{
  const directory=env.NTS_GATE_CASE_COSTS_DIR,step=env.NTS_GATE_STEP;
  if(!directory||!step)return;
  const host=hostObservations(env);
  return new CensusPhaseCosts(project,backend,step,()=>{
    const cpu=host.ownCpu();return {wall:host.now()/1000,user:cpu.userUsec/1e6,sys:cpu.systemUsec/1e6};
  },existsSync(join(directory,'phase-child'))?{directory,binary:join(directory,'phase-child')}:undefined);
}
