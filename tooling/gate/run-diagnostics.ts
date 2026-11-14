// One run owns these meters. Pressure is shared elapsed exposure; overlapping
// step deltas must not be added or interpreted as a causal resource charge.
import {CgroupDeparted,HostObservationError,type HostObservations,type LoopDelay,type LoopDelayMeter,type PressureReading} from './host-observations.ts';
import {PRESSURE_RESOURCES} from './host-pressure.ts';

export type PressureDelta={identity:string;stallUsec:Record<(typeof PRESSURE_RESOURCES)[number],{some:number;full:number}>};
type PressureSet={machine:PressureReading;runner:PressureReading;workers:PressureReading|null};
export type PressureExposure={machine:PressureDelta;runner:PressureDelta;workers:PressureDelta|null};
type WorkerPressure={observedAt:string;observedOffsetMs:number;departedAt:string|null;reading:PressureReading};
type WorkerInterval={startedAt:string;finishedAt:string;departedAt:string|null};
type Endpoint={offsetMs:number;at:string;pressure:PressureSet;workersPressure:WorkerPressure|null};
export type StepDiagnostics={version:1;sourceRun:string;startedAt:string;finishedAt:string;elapsedMs:number;
  loopDelay:LoopDelay;pressureExposure:PressureExposure;workersPressureInterval:WorkerInterval|null;pressureBasis:'shared-scope-endpoints-overlap'};
export type DiagnosticsSummary={version:1;sourceRun:string;state:'running'|'complete'|'incomplete';error:string|null;
  sampleIntervalMs:1000;loopResolutionMs:20;runnerGroup:string;workersGroup:string|null;workersStartedAt:string|null;timeline:string;
  startedAt:string;finishedAt:string|null;loopDelay:LoopDelay|null;pressureExposure:PressureExposure|null;
  workersPressure:WorkerPressure|null;
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
function workerInterval(before:Endpoint,after:Endpoint):WorkerInterval|null{
  const first=before.pressure.workers,last=after.workersPressure;
  if(!first||!last||last.observedOffsetMs<before.offsetMs)return null;
  return {startedAt:before.at,finishedAt:last.observedAt,departedAt:last.departedAt};
}
function exposure(before:Endpoint,after:Endpoint):PressureExposure{
  return {machine:pressureDelta(before.pressure.machine,after.pressure.machine),runner:pressureDelta(before.pressure.runner,after.pressure.runner),
    workers:workerInterval(before,after)?pressureDelta(before.pressure.workers!,after.workersPressure!.reading):null};
}
type Options={host:HostObservations;sourceRun:string;workersGroup?:string;startedAt:number;
  emit:(row:unknown)=>void;log:(line:string)=>void;failed:(error:unknown)=>void};

export class RunDiagnostics{
  private readonly options:Options;
  private readonly runnerGroup:string;
  private workersGroup:string|null;
  private firstWorker:Endpoint|null=null;
  private workersPressure:WorkerPressure|null=null;
  private workerDeparture:(()=>boolean)|undefined;
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
    this.options=options;this.origin=options.host.now();this.runnerGroup=options.host.ownCgroup();this.workersGroup=options.workersGroup??null;
    try{
      this.runDelay=this.meter();this.minuteDelay=this.meter();this.intervalDelay=this.meter();
      this.first=this.endpoint();this.last=this.first;this.minuteStart=this.first;
      if(this.workersGroup)this.firstWorker=this.first;
      options.emit({kind:'run-diagnostics-start',version:1,sourceRun:options.sourceRun,runnerGroup:this.runnerGroup,workersGroup:this.workersGroup,...this.first});
    }catch(error){
      const failures=[error];for(const meter of this.meters)try{meter.close();}catch(cleanup){failures.push(cleanup);}
      throw failures.length===1?error:new AggregateError(failures,'run diagnostics setup and meter cleanup failed');
    }
  }
  private meter():LoopDelayMeter{const meter=this.options.host.loopDelay();this.meters.push(meter);return meter;}
  private endpoint():Endpoint{
    const {host,startedAt}=this.options,offsetMs=host.now()-this.origin;
    if(offsetMs<0)throw new HostObservationError('host observation diagnostics clock moved backwards');
    const at=new Date(startedAt+offsetMs).toISOString();
    const machine=host.machinePressure(),runner=host.cgroupPressure(this.runnerGroup);
    let workers:PressureReading|null=null;
    if(this.workersGroup&&(this.workersPressure===null||this.workersPressure.departedAt===null)){
      const retire=()=>{
        if(!this.workersPressure)throw new HostObservationError('host observation worker root departed before its pressure endpoint was acquired');
        this.workersPressure={...this.workersPressure,departedAt:at};
        this.options.emit({kind:'run-diagnostics-workers-departed',version:1,group:this.workersGroup,...this.workersPressure});
      };
      if(this.workerDeparture?.())retire();
      else try{
        workers=host.cgroupPressure(this.workersGroup);
        if(this.workersPressure)pressureDelta(this.workersPressure.reading,workers);
        this.workersPressure={observedAt:at,observedOffsetMs:offsetMs,departedAt:null,reading:workers};
      }catch(error){
        if(!(error instanceof CgroupDeparted)||error.group!==this.workersGroup||!this.workerDeparture?.())throw error;
        retire();
      }
    }
    return {offsetMs,at,pressure:{machine,runner,workers},workersPressure:structuredClone(this.workersPressure)};
  }
  attachWorkers(group:string,departed?:()=>boolean):void{
    if(this.workersGroup!==null)throw Error('run diagnostics worker root already attached');
    this.workersGroup=group;this.workerDeparture=departed;this.firstWorker=this.sample();
    this.options.emit({kind:'run-diagnostics-workers',version:1,group,...this.firstWorker});
  }
  start():void{
    if(this.timer||this.closed||this.error!==null)throw Error('run diagnostics sampler already started, failed or closed');
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
    exposure(this.last,next);
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
    if(this.workersGroup===null)throw Error('step diagnostics require the attached worker root');
    if(this.steps.has(name))throw Error('duplicate step diagnostics: '+name);
    const start=this.sample();
    if(this.workersPressure?.departedAt!==null)throw new HostObservationError('step cannot start after the owned worker root departed');
    this.steps.set(name,{start,delay:this.meter()});
  }
  endStep(name:string):StepDiagnostics{
    const step=this.steps.get(name);if(!step)throw Error('missing step diagnostics: '+name);
    try{
      const end=this.sample();
      return {version:1,sourceRun:this.options.sourceRun,startedAt:step.start.at,finishedAt:end.at,elapsedMs:end.offsetMs-step.start.offsetMs,
        loopDelay:step.delay.read(),pressureExposure:exposure(step.start,end),workersPressureInterval:workerInterval(step.start,end),pressureBasis:'shared-scope-endpoints-overlap'};
    }finally{try{step.delay.close();}finally{this.steps.delete(name);}}
  }
  close():void{
    if(this.closed)return;clearInterval(this.timer);this.timer=undefined;
    let snapshot:DiagnosticsSummary|undefined;
    try{
      if(this.error===null){this.sample();this.finishMinute(this.last);}
      snapshot=this.report();
    }catch(error){this.fail(error);}
    finally{
      this.closed=true;for(const meter of this.meters)try{meter.close();}catch(error){this.fail(error);}
    }
    this.result={...(snapshot??this.report()),finishedAt:this.last.at,error:this.error,state:this.error===null?'complete':'incomplete'};
    try{this.options.emit({kind:'run-diagnostics-complete',...this.result});}catch(error){this.fail(error);this.result.state='incomplete';this.result.error=this.error;}
    if(this.error!==null)throw new HostObservationError('run diagnostics incomplete: '+this.error);
  }
  report():DiagnosticsSummary{
    if(this.result)return structuredClone({...this.result,error:this.error});
    return {version:1,sourceRun:this.options.sourceRun,state:this.error!==null?'incomplete':this.closed?'complete':'running',error:this.error,
      sampleIntervalMs:1000,loopResolutionMs:20,runnerGroup:this.runnerGroup,workersGroup:this.workersGroup,workersStartedAt:this.firstWorker?.at??null,timeline:'diagnostics.jsonl',
      startedAt:this.first.at,finishedAt:this.closed?this.last.at:null,loopDelay:this.closed?null:this.runDelay.read(),
      pressureExposure:{...exposure(this.first,this.last),workers:this.firstWorker?exposure(this.firstWorker,this.last).workers:null},
      workersPressure:structuredClone(this.last.workersPressure),minutes:structuredClone(this.minutes)};
  }
}
