// Completed run-owned answers. Snapshots have already finalized and been
// removed; every use replays the original facts behind the selected answer.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readOracleSnapshotIndex,validateHostObservations,type HostObservation,type OracleSnapshotReference} from './oracle-filesystem.ts';
import {oracleRecipeIdentity,checkNodeResolutionSession,type NodeResolutionSession} from './oracle-runtime.ts';
import {runtimeAssets} from './runtime-paths/main.ts';
import type {OracleBudget} from './oracle-runtime.ts';
import type {OracleIdentity,OraclePrepared} from './oracle-emit.ts';

export const resultHash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export type ProgramAnswer={version:1;subject:string;project:string;entry:string}&(
  {kind:'calls';driverSha256:string;count:number;rows:string[];stdout:number[];stderr:number[];replay?:OraclePrepared}
  // A planned population's budget names its driver. A planner past its bound
  // planned no population, so its budget names none.
  |{kind:'budget';driverSha256:string;budget:OracleBudget&{phase:'prepare'|'execute'}}
  |{kind:'budget';driverSha256?:never;budget:OracleBudget&{phase:'plan'}}
  |{kind:'observation';observation:{result:string;printed:{stdout:string;stderr:string};complete:true}});
export type ProgramCapture={observations:HostObservation[];dependencyObservations?:HostObservation[];session:NodeResolutionSession};
export type ProgramOracleHandoff={file:string;sha256:string};
export type ReaderRuntime={version:2;entry:'oracle-results.mjs';directory:string;bootstrapSha256:string;assets:Record<string,string>};
export type ProgramOracleRoot={runtime:ReaderRuntime;version:1;directory:string;identity:OracleIdentity;readerSha256:string;index:OracleSnapshotReference;count:number};
export const readerSourceHash=()=>resultHash(readFileSync(new URL('./oracle-results.ts',import.meta.url)));
const uriBytes=(value:string)=>[...Buffer.from(value)].map(byte=>'%'+byte.toString(16).toUpperCase().padStart(2,'0')).join('');
/** The native entry constructs this same pinned bootstrap from its embedded
 * source. Every imported module returns exactly the bytes checked by its hash. */
export function programOracleRuntimeArguments(root:ProgramOracleRoot):string[]{
  const runtime=root.runtime,bootstrap=readFileSync(new URL('./oracle-result-bootstrap.ts',import.meta.url),'utf8');
  if(!runtime||runtime.version!==2||runtime.entry!=='oracle-results.mjs'||runtime.directory!==join(root.directory,'reader')||runtime.bootstrapSha256!==resultHash(bootstrap)||!runtimeAssets(runtime.assets,['oracle-results.mjs']))invalid('reader runtime identity changed');
  const files=Object.fromEntries(Object.entries(runtime.assets).map(([name,sha])=>{if(!/^[a-f0-9]{64}$/.test(sha))invalid('reader asset identity changed');return [join(runtime.directory,name),sha];}));
  return ['--import','data:text/javascript,'+uriBytes(bootstrap)+'#'+uriBytes(JSON.stringify(files)),join(runtime.directory,'oracle-results.mjs')];
}

const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function invalid(why:string):never{throw Error('program oracle reference '+why);}
export function measured(value:ProgramAnswer):void{
  if(value?.version!==1||typeof value.subject!=='string'||!value.subject||!isAbsolute(value.project)||!isAbsolute(value.entry))invalid('has an invalid source identity');
  if(value.kind==='calls'){
    if(!digest(value.driverSha256)||!Number.isSafeInteger(value.count)||value.count<0||!Array.isArray(value.rows)||value.rows.length!==value.count||value.rows.some(row=>typeof row!=='string')||
      [value.stdout,value.stderr].some(bytes=>!Array.isArray(bytes)||bytes.some(byte=>!Number.isInteger(byte)||byte<0||byte>255)))invalid('has an incomplete call result: '+value.subject);
  }else if(value.kind==='budget'){
    if((value.budget?.phase==='plan'?'driverSha256' in value:!digest(value.driverSha256))||!['plan','prepare','execute'].includes(value.budget?.phase)||!['timeout','memory-cap'].includes(value.budget?.outcome)||!Number.isFinite(value.budget.bound)||value.budget.bound<=0||typeof value.budget.reason!=='string'||!value.budget.reason)invalid('has an invalid case budget: '+value.subject);
    if('rows' in value||'count' in value||'complete' in value)invalid('budget cannot claim Node coverage');
  }else if(value.kind==='observation'){
    if(value.observation?.complete!==true||typeof value.observation.result!=='string'||typeof value.observation.printed?.stdout!=='string'||typeof value.observation.printed.stderr!=='string')invalid('cannot store an unmeasured observation: '+value.subject);
  }else invalid('has an unknown answer kind');
}


export function programOracleHandoff(directory:string):ProgramOracleHandoff{
  const file=join(directory,'ready.json');return {file,sha256:resultHash(readFileSync(file))};
}

export function openProgramOracleResults(handoff:ProgramOracleHandoff,expected:OracleIdentity){
  if(!handoff||!isAbsolute(handoff.file)||!digest(handoff.sha256))invalid('handoff is invalid');
  const bytes=readFileSync(handoff.file);if(resultHash(bytes)!==handoff.sha256)invalid('root changed');
  const root=JSON.parse(bytes.toString('utf8')) as ProgramOracleRoot;
  if(root?.version!==1||!isAbsolute(root.directory)||join(root.directory,'ready.json')!==handoff.file||!Number.isSafeInteger(root.count)||root.count<0||
    JSON.stringify(root.identity)!==JSON.stringify(expected)||root.readerSha256!==readerSourceHash())invalid('reader or root identity changed');
  const index=readOracleSnapshotIndex(root.directory,root.index);
  const descriptor=index.get('descriptor') as {version:number;identity:OracleIdentity;readerSha256:string;session?:NodeResolutionSession;count:number}|undefined;
  if(descriptor?.version!==1||JSON.stringify(descriptor.identity)!==JSON.stringify(root.identity)||descriptor.readerSha256!==root.readerSha256||descriptor.count!==root.count)invalid('descriptor changed');
  const selected=(subject:string)=>{
    const record=index.get('case\0'+subject) as {value:ProgramAnswer;facts:string[]}|undefined;
    if(!record||!Array.isArray(record.facts)||record.value?.subject!==subject)invalid('has no measured project: '+subject);
    measured(record.value);return record;
  };
  return {
    identity:root.identity,count:root.count,
    project(subject:string):string{return selected(subject).value.project;},
    forProject(project:string):ProgramAnswer{
      const subject=index.get('project\0'+project);
      if(typeof subject!=='string')invalid('has no measured source project: '+project);
      return this.get(subject);
    },
    get(subject:string):ProgramAnswer{
      const record=selected(subject);
      if(!descriptor.session)invalid('has no Node identity');checkNodeResolutionSession(descriptor.session,descriptor.session.options);
      const observations=record.facts.map(key=>{
        if(typeof key!=='string'||!key.startsWith('fact\0'))invalid('has an invalid input fact');
        const observation=index.get(key) as HostObservation|undefined;
        if(!observation||'fact\0'+resultHash(JSON.stringify(observation))!==key)invalid('input fact changed');
        return observation;
      });
      validateHostObservations(observations);
      return record.value;
    },
    calls(project:string,entry:string,driverSha256:string):Extract<ProgramAnswer,{kind:'calls'|'budget'}>{
      const value=this.forProject(project);
      // A planner past its bound planned no driver: its budget answers each driver of its entry.
      const unplanned=value.kind==='budget'&&value.budget.phase==='plan';
      if((value.kind!=='calls'&&value.kind!=='budget')||value.project!==project||value.entry!==entry||!unplanned&&value.driverSha256!==driverSha256)invalid('call population changed: '+project);
      return value;
    },
  };
}


export function readProgramOracleReference(request:{handoff:ProgramOracleHandoff;project:string;entry:string;driverSha256:string}){
  return openProgramOracleResults(request.handoff,oracleRecipeIdentity()).calls(request.project,request.entry,request.driverSha256);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv[2]==='--read-program-reference'&&process.argv[3]){
  process.stdout.write(JSON.stringify(readProgramOracleReference(JSON.parse(process.argv[3])))+'\n');
}


if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv[2]==='--project-subject'&&process.argv[3]){
  const raw=process.env.NTS_PROGRAM_ORACLE;
  if(!raw)invalid('handoff is missing');
  const value=openProgramOracleResults(JSON.parse(raw),oracleRecipeIdentity()).get(process.argv[3]);
  process.stdout.write(value.project+'\n');
}
