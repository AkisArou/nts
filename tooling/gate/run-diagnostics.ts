// One run owns these meters. Pressure is shared elapsed exposure; overlapping
// step deltas must not be added or interpreted as a causal resource charge.
import {HostObservationError,type HostObservations,type LoopDelay,type LoopDelayMeter,type PressureReading} from './host-observations.ts';
import {PRESSURE_RESOURCES} from './host-pressure.ts';

export type PressureDelta={identity:string;stallUsec:Record<(typeof PRESSURE_RESOURCES)[number],{some:number;full:number}>};
type PressureSet={machine:PressureReading;runner:PressureReading;workers:PressureReading};
export type PressureExposure={machine:PressureDelta;runner:PressureDelta;workers:PressureDelta};
type Endpoint={offsetMs:number;at:string;pressure:PressureSet};
export type StepDiagnostics={version:1;sourceRun:string;startedAt:string;finishedAt:string;elapsedMs:number;
  loopDelay:LoopDelay;pressureExposure:PressureExposure;pressureBasis:'shared-scope-endpoints-overlap'};
export type DiagnosticsSummary={version:1;sourceRun:string;state:'running'|'complete'|'incomplete';error:string|null;
  sampleIntervalMs:1000;loopResolutionMs:20;runnerGroup:string;workersGroup:string;timeline:string;
  startedAt:string;finishedAt:string|null;loopDelay:LoopDelay|null;pressureExposure:PressureExposure|null;
  minutes:{startedAt:string;finishedAt:string;elapsedMs:number;loopDelay:LoopDelay}[]};

export function pressureDelta(before:PressureReading,after:PressureReading):PressureDelta{
  if(before.identity!==after.identity)throw new HostObservationError(`host observation pressure scope changed: ${before.identity} -> ${after.identity}`);
  const stallUsec={} as PressureDelta['stallUsec'];
  for(const resource of PRESSURE_RESOURCES){
    const pair={some:0,full:0};
    for(const kind of ['some','full'] as const){
      const delta=after.resources[resource][kind].totalUsec-before.resources[resource][kind].totalUsec;
      if(delta<0)throw new HostObservationError(`host observation pressure counter reset: ${after.identity}.${resource}.${kind}`);
      pair[kind]=delta;
    }
    stallUsec[resource]=pair;
  }
  return {identity:after.identity,stallUsec};
}
function exposure(before:PressureSet,after:PressureSet):PressureExposure{
  return {machine:pressureDelta(before.machine,after.machine),runner:pressureDelta(before.runner,after.runner),workers:pressureDelta(before.workers,after.workers)};
}
type Options={host:HostObservations;sourceRun:string;workersGroup:string;startedAt:number;
  emit:(row:unknown)=>void;log:(line:string)=>void;failed:(error:unknown)=>void};

export class RunDiagnostics{
  private readonly options:Options;
  private readonly runnerGroup:string;
  private readonly origin:number;
  private readonly meters:LoopDelayMeter[]=[];
  private readonly steps=new Map<string,{start:Endpoint;delay:LoopDelayMeter}>();
  private readonly runDelay:LoopDelayMeter;
  private readonly minuteDelay:LoopDelayMeter;
  private readonly intervalDelay:LoopDelayMeter;
  private readonly first:Endpoint;
  private last:Endpoint;
  private minuteStart:Endpoint;
  private readonly minutes:DiagnosticsSummary['minutes']=[];
  private timer:ReturnType<typeof setInterval>|undefined;
  private error:string|null=null;
  private closed=false;
  private result:DiagnosticsSummary|undefined;
  constructor(options:Options){
    this.options=options;this.origin=options.host.now();this.runnerGroup=options.host.ownCgroup();
    try{
      this.runDelay=this.meter();this.minuteDelay=this.meter();this.intervalDelay=this.meter();
      this.first=this.endpoint();this.last=this.first;this.minuteStart=this.first;
      options.emit({kind:'run-diagnostics-start',version:1,sourceRun:options.sourceRun,runnerGroup:this.runnerGroup,workersGroup:options.workersGroup,...this.first});
    }catch(error){
      const failures=[error];for(const meter of this.meters)try{meter.close();}catch(cleanup){failures.push(cleanup);}
      throw failures.length===1?error:new AggregateError(failures,'run diagnostics setup and meter cleanup failed');
    }
  }
  private meter():LoopDelayMeter{const meter=this.options.host.loopDelay();this.meters.push(meter);return meter;}
  private endpoint():Endpoint{
    const {host,workersGroup,startedAt}=this.options,offsetMs=host.now()-this.origin;
    if(offsetMs<0)throw new HostObservationError('host observation diagnostics clock moved backwards');
    return {offsetMs,at:new Date(startedAt+offsetMs).toISOString(),pressure:{machine:host.machinePressure(),runner:host.cgroupPressure(this.runnerGroup),workers:host.cgroupPressure(workersGroup)}};
  }
  start():void{
    if(this.timer||this.closed)throw Error('run diagnostics sampler already started or closed');
    this.timer=setInterval(()=>{try{this.sample();}catch(error){this.fail(error);}},1000);this.timer.unref();
  }
  private fail(error:unknown):void{
    if(this.error!==null){this.error+='; '+String(error);return;}
    this.error=String(error);clearInterval(this.timer);this.timer=undefined;this.options.failed(error);
  }
  sample():Endpoint{
    if(this.closed)throw new HostObservationError('host observation diagnostics sampler is closed');
    const next=this.endpoint();
    if(next.offsetMs<this.last.offsetMs)throw new HostObservationError('host observation diagnostics clock moved backwards');
    exposure(this.last.pressure,next.pressure);
    const loopDelay=this.intervalDelay.read();this.intervalDelay.reset();
    this.options.emit({kind:'run-diagnostics-sample',version:1,sourceRun:this.options.sourceRun,from:this.last.at,...next,loopDelay,steps:[...this.steps.keys()]});
    if(loopDelay.maxMs!==null&&loopDelay.maxMs>1000){
      this.options.emit({kind:'event-loop-block',version:1,detectedAt:next.at,windowStartedAt:this.last.at,windowFinishedAt:next.at,loopDelay});
      this.options.log(`event-loop delay: ${loopDelay.maxMs.toFixed(3)} ms observed at ${next.at} (sample window ${this.last.at} .. ${next.at})`);
    }
    this.last=next;
    if(next.offsetMs-this.minuteStart.offsetMs>=60_000)this.finishMinute(next);
    return next;
  }
  private finishMinute(end:Endpoint):void{
    const row={startedAt:this.minuteStart.at,finishedAt:end.at,elapsedMs:end.offsetMs-this.minuteStart.offsetMs,loopDelay:this.minuteDelay.read()};
    this.options.emit({kind:'event-loop-minute',version:1,...row});this.minutes.push(row);
    this.minuteDelay.reset();this.minuteStart=end;
  }
  beginStep(name:string):void{
    if(this.steps.has(name))throw Error('duplicate step diagnostics: '+name);
    const start=this.sample();this.steps.set(name,{start,delay:this.meter()});
  }
  endStep(name:string):StepDiagnostics{
    const step=this.steps.get(name);if(!step)throw Error('missing step diagnostics: '+name);
    try{
      const end=this.sample();
      return {version:1,sourceRun:this.options.sourceRun,startedAt:step.start.at,finishedAt:end.at,elapsedMs:end.offsetMs-step.start.offsetMs,
        loopDelay:step.delay.read(),pressureExposure:exposure(step.start.pressure,end.pressure),pressureBasis:'shared-scope-endpoints-overlap'};
    }finally{try{step.delay.close();}finally{this.steps.delete(name);}}
  }
  close():void{
    if(this.closed)return;clearInterval(this.timer);this.timer=undefined;
    try{
      if(this.error===null){this.sample();this.finishMinute(this.last);}
      this.result={...this.report(),finishedAt:this.last.at,state:this.error===null?'complete':'incomplete'};
      this.options.emit({kind:'run-diagnostics-complete',...this.result});
    }catch(error){this.fail(error);}
    finally{
      this.closed=true;for(const meter of this.meters)try{meter.close();}catch(error){this.fail(error);}
      if(this.result)this.result.state=this.error===null?'complete':'incomplete';
    }
    if(this.error!==null)throw new HostObservationError('run diagnostics incomplete: '+this.error);
  }
  report():DiagnosticsSummary{
    if(this.result)return structuredClone({...this.result,error:this.error});
    return {version:1,sourceRun:this.options.sourceRun,state:this.error!==null?'incomplete':this.closed?'complete':'running',error:this.error,
      sampleIntervalMs:1000,loopResolutionMs:20,runnerGroup:this.runnerGroup,workersGroup:this.options.workersGroup,timeline:'diagnostics.jsonl',
      startedAt:this.first.at,finishedAt:this.closed?this.last.at:null,loopDelay:this.closed?null:this.runDelay.read(),
      pressureExposure:exposure(this.first.pressure,this.last.pressure),minutes:structuredClone(this.minutes)};
  }
}
