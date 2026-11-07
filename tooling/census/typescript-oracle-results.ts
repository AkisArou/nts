// One authenticated reference execution per case, shared by the backends of
// this run. Inputs are replayed on every read; this stores no host answers.
import { createHash } from 'node:crypto';
import { isAbsolute,join } from 'node:path';
import { readFileSync,writeFileSync,renameSync } from 'node:fs';
import { readOracleSnapshotIndex,writeOracleSnapshotIndex,validateHostObservations,type HostObservation,type OracleSnapshotReference } from '../differential/oracle-filesystem.ts';
import { checkNodeResolutionSession,type NodeResolutionSession } from '../differential/oracle-runtime.ts';
import { ToolingInstrumentError } from '../gate/step-result.ts';
import type { OracleVerdict } from './suites/typescript.ts';
import type { PrintedOutput } from '../conformance/output-prefix.ts';

export const oracleResultHash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export type TypeScriptOracleResult={
  version:1;path:string;sourceSha256:string;verdict:OracleVerdict;printed:PrintedOutput;
  observations:HostObservation[];dependencyObservations?:HostObservation[];
};
export type TypeScriptOracleResults={version:1;directory:string;index:OracleSnapshotReference;identity:string;count:number};
export type TypeScriptOracleHandoff={file:string;sha256:string};

function invalid(reason:string):never{throw new ToolingInstrumentError('tooling-setup','TypeScript oracle reference '+reason);}
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function measured(row:TypeScriptOracleResult){
  if(row?.version!==1||typeof row.path!=='string'||!row.path||!digest(row.sourceSha256)||
    typeof row.printed?.stdout!=='string'||typeof row.printed.stderr!=='string'||!Array.isArray(row.observations)||
    row.dependencyObservations!==undefined&&!Array.isArray(row.dependencyObservations))invalid('has an invalid case record');
  const verdict=row.verdict;
  if(verdict?.ok===true)return;
  if(verdict?.ok!==false||typeof verdict.why!=='string'||!verdict.rejection||!Number.isInteger(verdict.rejection.exit)||
    verdict.rejection.exit<0||verdict.rejection.exit>255||typeof verdict.rejection.error!=='string')invalid('cannot publish an unmeasured case: '+row.path);
}

/** Intern exact facts while cases finish, so shared libraries and package
 * catalogs occupy one record rather than one copy per case. */
export function createTypeScriptOracleResults(directory:string,identity:string){
  if(!isAbsolute(directory)||!digest(identity))invalid('publication identity is invalid');
  let session:NodeResolutionSession|undefined,published=false;
  const cases=new Map<string,unknown>(),facts=new Map<string,{key:string;observation:HostObservation}>();
  return {
    add(row:TypeScriptOracleResult,node:NodeResolutionSession){
      if(published)invalid('was already published');
      measured(row);if(cases.has(row.path))invalid('has a duplicate case: '+row.path);
      checkNodeResolutionSession(node,node.options);
      if(session&&JSON.stringify(session)!==JSON.stringify(node))invalid('Node identity changed between cases');
      session=node;
      const keys=[...row.observations,...row.dependencyObservations??[]].map(observation=>{
        const text=JSON.stringify(observation);let fact=facts.get(text);
        if(!fact){fact={key:'fact\0'+oracleResultHash(text),observation};facts.set(text,fact);}
        return fact.key;
      });
      const {observations:_,dependencyObservations:__,...value}=row;
      cases.set(row.path,{...value,facts:[...new Set(keys)]});
    },
    /** Called only after all process trees and their snapshots finalized. */
    publish():TypeScriptOracleResults{
      if(published)invalid('was already published');
      if(session)checkNodeResolutionSession(session,session.options);
      // Replay the complete union before publishing, including facts from
      // early cases whose outputs have already been released.
      validateHostObservations([...facts.values()].map(fact=>fact.observation));
      const index=writeOracleSnapshotIndex(directory,[['descriptor',{version:1,identity,session,count:cases.size}],
        ...[...cases].map(([path,value])=>['case\0'+path,value] as const),
        ...[...facts.values()].map(({key,observation})=>[key,observation] as const)]);
      const result:TypeScriptOracleResults={version:1,directory,index,identity,count:cases.size};
      const file=join(directory,'ready.json'),pending=file+'.'+process.pid;
      writeFileSync(pending,JSON.stringify(result)+'\n',{flag:'wx',mode:0o444});renameSync(pending,file);published=true;
      return result;
    },
  };
}

export function publishTypeScriptOracleResults(directory:string,identity:string,session:NodeResolutionSession|undefined,rows:TypeScriptOracleResult[]):TypeScriptOracleResults{
  if(rows.length&&!session)invalid('publication has no Node identity');
  const writer=createTypeScriptOracleResults(directory,identity);
  for(const row of rows)writer.add(row,session!);
  return writer.publish();
}

/** The runner pins this small root after the producer step succeeds. */
export function typeScriptOracleHandoff(directory:string):TypeScriptOracleHandoff{
  const file=join(directory,'ready.json');return {file,sha256:oracleResultHash(readFileSync(file))};
}

export function openTypeScriptOracleResults(handoff:TypeScriptOracleHandoff,identity:string){
  if(!handoff||!isAbsolute(handoff.file)||!digest(handoff.sha256))invalid('handoff is invalid');
  const bytes=readFileSync(handoff.file);if(oracleResultHash(bytes)!==handoff.sha256)invalid('root changed');
  const root=JSON.parse(bytes.toString('utf8')) as TypeScriptOracleResults;
  if(root?.version!==1||!isAbsolute(root.directory)||join(root.directory,'ready.json')!==handoff.file||root.identity!==identity||
    !Number.isSafeInteger(root.count)||root.count<0)invalid('identity does not match this run');
  const index=readOracleSnapshotIndex(root.directory,root.index);
  const descriptor=index.get('descriptor') as {version:number;identity:string;session?:NodeResolutionSession;count:number}|undefined;
  if(descriptor?.version!==1||descriptor.identity!==identity||descriptor.count!==root.count)invalid('descriptor changed');
  return {count:root.count,get(path:string,sourceSha256:string):{verdict:OracleVerdict;printed:PrintedOutput}{
    if(!descriptor.session)invalid('has no Node identity');
    checkNodeResolutionSession(descriptor.session,descriptor.session.options);
    const row=index.get('case\0'+path) as Omit<TypeScriptOracleResult,'observations'|'dependencyObservations'>&{facts:string[]}|undefined;
    if(!row)invalid('has no measured case: '+path);
    if(!Array.isArray(row.facts)||row.facts.some(key=>typeof key!=='string'||!key.startsWith('fact\0')))invalid('has an invalid input proof: '+path);
    const observations=row.facts.map(key=>{
      const observation=index.get(key) as HostObservation|undefined;
      if(!observation||'fact\0'+oracleResultHash(JSON.stringify(observation))!==key)invalid('input proof changed: '+path);
      return observation;
    });
    measured({...row,observations});
    if(row.path!==path||row.sourceSha256!==sourceSha256)invalid('source changed: '+path);
    // Include failed lookups and listings. A result is immutable; live facts
    // never come from a previous consumer's validation.
    validateHostObservations(observations);
    return {verdict:row.verdict,printed:row.printed};
  }};
}
