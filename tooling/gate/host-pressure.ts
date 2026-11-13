// Linux PSI is cumulative elapsed stall time, not CPU use or a causal charge.
import {HostObservationError} from './host-observation-error.ts';

export const PRESSURE_RESOURCES=['cpu','memory','io'] as const;
export type PressureLine={avg10:number;totalUsec:number};
export type Pressure={some:PressureLine;full:PressureLine};
export type PressureReading={identity:string;resources:Record<(typeof PRESSURE_RESOURCES)[number],Pressure>};
export type LoopDelay={count:number;maxMs:number|null;p99Ms:number|null};
export type LoopDelayMeter={read():LoopDelay;reset():void;close():void};

export function parsePressure(text:string,name:string):Pressure{
  const read=(kind:'some'|'full'):PressureLine=>{
    const lines=text.trim().split('\n').filter(line=>line.startsWith(kind+' '));
    if(lines.length!==1)throw new HostObservationError(`host observation ${name}.${kind} is missing or duplicated`);
    const fields=new Map<string,string>();
    for(const part of lines[0]!.split(/\s+/).slice(1)){
      const match=/^([a-z0-9]+)=(\d+(?:\.\d+)?)$/.exec(part);
      if(!match||fields.has(match[1]!))throw new HostObservationError(`host observation ${name}.${kind} is malformed`);
      fields.set(match[1]!,match[2]!);
    }
    const avg10=Number(fields.get('avg10')),totalUsec=Number(fields.get('total'));
    if(!fields.has('avg10')||!fields.has('total')||!Number.isFinite(avg10)||avg10<0||avg10>100||!Number.isSafeInteger(totalUsec)||totalUsec<0)
      throw new HostObservationError(`host observation ${name}.${kind} has invalid avg10 or total`);
    return {avg10,totalUsec};
  };
  return {some:read('some'),full:read('full')};
}

export function pressureReading(value:unknown,name:string):PressureReading{
  const row=value as Partial<PressureReading>|undefined;
  if(!row||typeof row.identity!=='string'||!row.identity||!row.resources)throw new HostObservationError(`host observation ${name} is missing or invalid`);
  const resources={} as PressureReading['resources'];
  for(const resource of PRESSURE_RESOURCES){
    const pressure=row.resources[resource];
    if(!pressure)throw new HostObservationError(`host observation ${name}.${resource} is missing`);
    const lines={} as Pressure;
    for(const kind of ['some','full'] as const){
      const line=pressure[kind];
      if(!line||!Number.isFinite(line.avg10)||line.avg10<0||line.avg10>100||!Number.isSafeInteger(line.totalUsec)||line.totalUsec<0)
        throw new HostObservationError(`host observation ${name}.${resource}.${kind} is missing or invalid`);
      lines[kind]={avg10:line.avg10,totalUsec:line.totalUsec};
    }
    resources[resource]=lines;
  }
  return {identity:row.identity,resources};
}

export function loopDelay(value:unknown):LoopDelay{
  const row=value as Partial<LoopDelay>|undefined;
  if(!row||!Number.isSafeInteger(row.count)||row.count!<0
    ||(row.count===0?(row.maxMs!==null||row.p99Ms!==null):
      (typeof row.maxMs!=='number'||!Number.isFinite(row.maxMs)||row.maxMs<0||typeof row.p99Ms!=='number'||!Number.isFinite(row.p99Ms)||row.p99Ms<0||row.p99Ms>row.maxMs)))
    throw new HostObservationError('host observation loopDelay is missing or invalid');
  return {count:row.count!,maxMs:row.maxMs!,p99Ms:row.p99Ms!};
}
