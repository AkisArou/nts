// Completed run-owned answers. Snapshots have already finalized and been
// removed; every use replays the original facts behind the selected answer.
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
import {readOracleSnapshotIndex,writeOracleSnapshotIndex,validateHostObservations,type HostObservation,type OracleSnapshotReference} from './oracle-filesystem.ts';
import {oracleRecipeIdentity,checkNodeResolutionSession,type NodeResolutionSession} from './oracle-runtime.ts';
import type {OracleIdentity,OraclePrepared} from './oracle-emit.ts';

export const resultHash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export type ProgramAnswer={version:1;subject:string;project:string;entry:string}&(
  {kind:'calls';driverSha256:string;count:number;rows:string[];stdout:number[];stderr:number[];replay?:OraclePrepared}
  |{kind:'observation';observation:{result:string;printed:{stdout:string;stderr:string};complete:true}});
export type ProgramCapture={observations:HostObservation[];dependencyObservations?:HostObservation[];session:NodeResolutionSession};
export type ProgramOracleHandoff={file:string;sha256:string};
type ReaderRuntime={version:1;directory:string;bootstrapSha256:string;assets:Record<string,string>};
type Root={runtime:ReaderRuntime;version:1;directory:string;identity:OracleIdentity;readerSha256:string;index:OracleSnapshotReference;count:number};
const READER_MODULES=['oracle-results','oracle-filesystem','oracle-runtime'] as const;
const RECIPE_SOURCES=['oracle-emit.ts','oracle-loader.ts','oracle-assets.ts','oracle-filesystem.ts','oracle-runtime.ts','oracle-resolution.ts','oracle-toolchain.json','oracle-results.ts','oracle-result-bootstrap.ts'];
const readerSourceHash=()=>resultHash(readFileSync(new URL('./oracle-results.ts',import.meta.url)));
function publishReaderRuntime(directory:string):ReaderRuntime{
  const here=dirname(fileURLToPath(import.meta.url)),runtime=join(directory,'reader');mkdirSync(runtime,{recursive:true});
  for(const name of RECIPE_SOURCES)writeFileSync(join(runtime,name),readFileSync(join(here,name)),{flag:'wx',mode:0o444});
  writeFileSync(join(runtime,'package.json'),'{"type":"module"}\n',{flag:'wx',mode:0o444});
  const assets:Record<string,string>={};
  for(const name of READER_MODULES){
    const bytes=readFileSync(join(here,name+'.ts'),'utf8');
    const text=stripTypeScriptTypes(bytes,{mode:'strip'}).replace(/(\bfrom\s*['"]\.\/oracle-(?:runtime|filesystem))\.ts(['"])/g,'$1.mjs$2');
    const file=name+'.mjs';writeFileSync(join(runtime,file),text,{flag:'wx',mode:0o444});assets[file]=resultHash(text);
  }
  const bootstrapSha256=resultHash(readFileSync(join(here,'oracle-result-bootstrap.ts')));
  return {version:1,directory:runtime,bootstrapSha256,assets};
}
const uriBytes=(value:string)=>[...Buffer.from(value)].map(byte=>'%'+byte.toString(16).toUpperCase().padStart(2,'0')).join('');
/** The native entry constructs this same pinned bootstrap from its embedded
 * source. Every imported module returns exactly the bytes checked by its hash. */
export function programOracleRuntimeArguments(root:Root):string[]{
  const runtime=root.runtime,bootstrap=readFileSync(new URL('./oracle-result-bootstrap.ts',import.meta.url),'utf8');
  if(!runtime||runtime.version!==1||runtime.directory!==join(root.directory,'reader')||runtime.bootstrapSha256!==resultHash(bootstrap)||Object.keys(runtime.assets).sort().join(',')!==READER_MODULES.map(name=>name+'.mjs').sort().join(','))invalid('reader runtime identity changed');
  const files=Object.fromEntries(Object.entries(runtime.assets).map(([name,sha])=>{if(!/^[a-f0-9]{64}$/.test(sha))invalid('reader asset identity changed');return [join(runtime.directory,name),sha];}));
  return ['--import','data:text/javascript,'+uriBytes(bootstrap)+'#'+uriBytes(JSON.stringify(files)),join(runtime.directory,'oracle-results.mjs')];
}

const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function invalid(why:string):never{throw Error('program oracle reference '+why);}
function measured(value:ProgramAnswer):void{
  if(value?.version!==1||typeof value.subject!=='string'||!value.subject||!isAbsolute(value.project)||!isAbsolute(value.entry))invalid('has an invalid source identity');
  if(value.kind==='calls'){
    if(!digest(value.driverSha256)||!Number.isSafeInteger(value.count)||value.count<0||!Array.isArray(value.rows)||value.rows.length!==value.count||value.rows.some(row=>typeof row!=='string')||
      [value.stdout,value.stderr].some(bytes=>!Array.isArray(bytes)||bytes.some(byte=>!Number.isInteger(byte)||byte<0||byte>255)))invalid('has an incomplete call result: '+value.subject);
  }else if(value.kind==='observation'){
    if(value.observation?.complete!==true||typeof value.observation.result!=='string'||typeof value.observation.printed?.stdout!=='string'||typeof value.observation.printed.stderr!=='string')invalid('cannot store an unmeasured observation: '+value.subject);
  }else invalid('has an unknown answer kind');
}

export function createProgramOracleResults(directory:string,identity:OracleIdentity){
  if(!isAbsolute(directory))invalid('directory must be absolute');
  const cases=new Map<string,unknown>(),projects=new Map<string,string>();
  const facts=new Map<string,{key:string;observation:HostObservation}>();
  let session:NodeResolutionSession|undefined,published=false;
  return {
    add(value:ProgramAnswer,capture:ProgramCapture):void{
      if(published)invalid('was already published');measured(value);
      if(cases.has(value.subject)||projects.has(value.project))invalid('has a duplicate project: '+value.subject);
      checkNodeResolutionSession(capture.session,capture.session.options);
      if(session&&JSON.stringify(session)!==JSON.stringify(capture.session))invalid('Node identity changed between projects');
      session=capture.session;
      const keys=[...capture.observations,...capture.dependencyObservations??[]].map(observation=>{
        const text=JSON.stringify(observation);let fact=facts.get(text);
        if(!fact){fact={key:'fact\0'+resultHash(text),observation};facts.set(text,fact);}
        return fact.key;
      });
      cases.set(value.subject,{value,facts:[...new Set(keys)]});projects.set(value.project,value.subject);
    },
    publish():Root{
      if(published)invalid('was already published');
      if(session)checkNodeResolutionSession(session,session.options);
      validateHostObservations([...facts.values()].map(fact=>fact.observation));
      const readerSha256=readerSourceHash();
      const index=writeOracleSnapshotIndex(directory,[['descriptor',{version:1,identity,readerSha256,session,count:cases.size}],
        ...[...cases].map(([key,value])=>['case\0'+key,value] as const),
        ...[...projects].map(([key,value])=>['project\0'+key,value] as const),
        ...[...facts.values()].map(({key,observation})=>[key,observation] as const)]);
      const root:Root={version:1,directory,identity,readerSha256,index,count:cases.size,runtime:publishReaderRuntime(directory)};
      const file=join(directory,'ready.json'),temporary=file+'.'+process.pid;
      writeFileSync(temporary,JSON.stringify(root)+'\n',{flag:'wx',mode:0o444});renameSync(temporary,file);published=true;
      return root;
    },
  };
}

export function programOracleHandoff(directory:string):ProgramOracleHandoff{
  const file=join(directory,'ready.json');return {file,sha256:resultHash(readFileSync(file))};
}

export function openProgramOracleResults(handoff:ProgramOracleHandoff,expected:OracleIdentity){
  if(!handoff||!isAbsolute(handoff.file)||!digest(handoff.sha256))invalid('handoff is invalid');
  const bytes=readFileSync(handoff.file);if(resultHash(bytes)!==handoff.sha256)invalid('root changed');
  const root=JSON.parse(bytes.toString('utf8')) as Root;
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
    calls(project:string,entry:string,driverSha256:string):Extract<ProgramAnswer,{kind:'calls'}>{
      const value=this.forProject(project);
      if(value.kind!=='calls'||value.project!==project||value.entry!==entry||value.driverSha256!==driverSha256)invalid('call population changed: '+project);
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
