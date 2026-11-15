import {readBuildUsage,type BuildUsage} from '../gate/build-usage.ts';

export type BuildStage={kind:'external';column:string;phase:string;receipt:BuildUsage}
  |{kind:'thread';column:string;phase:string;cpu_s:number;basis:'getrusage-RUSAGE_THREAD-v1; shared checker CPU excluded';complete:boolean};
export type BuildDetails={version:1;stages:BuildStage[]};

export function readBuildDetails(value:unknown):BuildDetails{
  const row=value as BuildDetails;
  if(!row||row.version!==1||!Array.isArray(row.stages))throw Error('invalid benchmark build details');
  return {version:1,stages:row.stages.map(stage=>{
    if(!stage||typeof stage.column!=='string'||!stage.column||typeof stage.phase!=='string'||!stage.phase)throw Error('invalid benchmark build stage');
    if(stage.kind==='external')return {...stage,receipt:readBuildUsage(stage.receipt)};
    if(stage.kind!=='thread'||stage.basis!=='getrusage-RUSAGE_THREAD-v1; shared checker CPU excluded'
      ||typeof stage.complete!=='boolean'||!Number.isFinite(stage.cpu_s)||stage.cpu_s<0)throw Error('invalid benchmark thread CPU');
    return {...stage};
  })};
}

export function describeBuilds(details:BuildDetails):string[]{
  return details.stages.map(stage=>{
    const lead=stage.column+', '+stage.phase+': ';
    if(stage.kind==='thread')return lead+stage.cpu_s.toFixed(6)+' CPU s (RUSAGE_THREAD; shared checker CPU excluded)'+(stage.complete?'':' [failed]');
    const r=stage.receipt,u=r.waited;
    return lead+(u?(u.user_s+u.sys_s).toFixed(6)+' CPU s (wait4; user '+u.user_s.toFixed(6)+', system '+u.sys_s.toFixed(6)+', includes waited descendants)'
      :'final waited CPU unavailable: '+r.unavailable)+(r.sampledAtBound?'; '+r.sampledAtBound.cpu_s.toFixed(3)+' CPU s sampled at bound (process '+r.sampledAtBound.pid+')':'')
      +(r.reason?'; '+r.reason:'')+'; status '+r.status;
  });
}
