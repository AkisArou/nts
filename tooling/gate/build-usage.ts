// Build telemetry has no verdict authority. A killed observer cannot provide
// final waited CPU; the supervisor's bound sample has a different, named basis.
import {readChildUsage,type ChildUsage} from './child-usage.ts';

export type BuildUsage={version:1;command:string;args:string[];status:number;reason:string|null;
  waited:ChildUsage|null;unavailable:string|null;sampledAtBound:{pid:number;cpu_s:number}|null};

export function readBuildUsage(value:unknown):BuildUsage{
  if(!value||typeof value!=='object')throw Error('build usage: missing receipt');
  const row=value as BuildUsage;
  if(row.version!==1||typeof row.command!=='string'||!row.command||!Array.isArray(row.args)||row.args.some(arg=>typeof arg!=='string')
    ||!Number.isSafeInteger(row.status)||row.status<0||row.status>255
    ||!(row.reason===null||typeof row.reason==='string'&&row.reason.length>0)
    ||!(row.unavailable===null||typeof row.unavailable==='string'&&row.unavailable.length>0)
    ||(row.waited===null)!==(row.unavailable!==null)
    ||!(row.sampledAtBound===null||row.sampledAtBound&&Number.isSafeInteger(row.sampledAtBound.pid)&&row.sampledAtBound.pid>0
      &&Number.isFinite(row.sampledAtBound.cpu_s)&&row.sampledAtBound.cpu_s>=0))throw Error('build usage: invalid receipt');
  return {...row,args:[...row.args],waited:row.waited===null?null:{...readChildUsage(row.waited)},
    sampledAtBound:row.sampledAtBound===null?null:{...row.sampledAtBound}};
}
