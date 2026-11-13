// Preparation owns parsing and publication. Completed readers import only the
// SDK-free runtime, never this producer or its compiler dependencies.
import {mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ORACLE_RUNTIME_FILES,checkNodeResolutionSession,type NodeResolutionSession} from './oracle-runtime.ts';
import {writeOracleSnapshotIndex,validateHostObservations,type HostObservation} from './oracle-filesystem.ts';
import {resultHash,readerSourceHash,invalid,measured,type ProgramAnswer,type ProgramCapture,type ProgramOracleRoot,type ReaderRuntime} from './oracle-results.ts';
import type {OracleIdentity} from './oracle-emit.ts';
import {compileRuntimeModules} from './oracle-runtime-modules.ts';

export const RECIPE_SOURCES=[...ORACLE_RUNTIME_FILES,'oracle-results.ts','oracle-result-bootstrap.ts'];
function publishReaderRuntime(directory:string):ReaderRuntime{
  const here=dirname(fileURLToPath(import.meta.url)),runtime=join(directory,'reader');mkdirSync(runtime,{recursive:true});
  for(const name of RECIPE_SOURCES){
    const file=join(runtime,name);mkdirSync(dirname(file),{recursive:true});
    writeFileSync(file,readFileSync(join(here,name)),{flag:'wx',mode:0o444});
  }
  writeFileSync(join(runtime,'package.json'),'{"type":"module"}\n',{flag:'wx',mode:0o444});
  const graph=compileRuntimeModules(here,'oracle-results.ts'),assets:Record<string,string>={};
  for(const module of graph.modules){
    const file=join(runtime,module.name);mkdirSync(dirname(file),{recursive:true});
    writeFileSync(file,module.text,{flag:'wx',mode:0o444});assets[module.name]=resultHash(module.text);
  }
  const bootstrapSha256=resultHash(readFileSync(join(here,'oracle-result-bootstrap.ts')));
  return {version:2,entry:'oracle-results.mjs',directory:runtime,bootstrapSha256,assets};
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
    publish():ProgramOracleRoot{
      if(published)invalid('was already published');
      if(session)checkNodeResolutionSession(session,session.options);
      validateHostObservations([...facts.values()].map(fact=>fact.observation));
      const readerSha256=readerSourceHash();
      const index=writeOracleSnapshotIndex(directory,[['descriptor',{version:1,identity,readerSha256,session,count:cases.size}],
        ...[...cases].map(([key,value])=>['case\0'+key,value] as const),
        ...[...projects].map(([key,value])=>['project\0'+key,value] as const),
        ...[...facts.values()].map(({key,observation})=>[key,observation] as const)]);
      const root:ProgramOracleRoot={version:1,directory,identity,readerSha256,index,count:cases.size,runtime:publishReaderRuntime(directory)};
      const file=join(directory,'ready.json'),temporary=file+'.'+process.pid;
      writeFileSync(temporary,JSON.stringify(root)+'\n',{flag:'wx',mode:0o444});renameSync(temporary,file);published=true;
      return root;
    },
  };
}

