// Project discovery and parsed config inputs have one owner for selectors and staging.
import {createRequire} from 'node:module';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {captureToolchain,toolchainFact,toolchainDescriptor,type Capture,type InstalledTypeScript} from '../differential/oracle-toolchain.ts';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';
import {type HostObservation} from '../differential/oracle-runtime.ts';
import {prepareGeneratedProject,generatedProjectFact,type GeneratedProjectCapability,type GeneratedInclude} from './generated-project.ts';
import {projectAncestorAbsence,type ProjectEnvironmentAbsence,type ProjectProgramProvenance} from './project-environment.ts';
import {projectDependencies,type InstalledProjectDependency} from './project-dependencies.ts';
import type {DependencyCatalogTrust} from '../inputs/dependency-catalog.ts';

export type ProjectInputs={configs:string[];roots:string[];modules:{path:string;imports:string[]}[];observations:HostObservation[];installedObservations:{observation:HostObservation;capability:InstalledTypeScript}[];
  hostObservations:{observation:HostObservation;environment:ProjectEnvironmentAbsence}[];
  dependencyObservations:{observation:HostObservation;dependency:InstalledProjectDependency}[];pinObservations:HostObservation[];
  generatedObservations:{observation:HostObservation;capability:GeneratedProjectCapability}[]};
export type ProjectRequest={kind:'config';path:string}|{kind:'generated';path:string;directory:string;include:GeneratedInclude};
/** One graph owns one lazy SDK process. Every read still constructs a fresh
 * Program and filesystem transaction; no result or observation is cached. */
export function projectInputOwner(source:string,installed?:()=>Capture,generatedTemporaryParent?:string,dependencyCatalog:DependencyCatalogTrust|null=null){
  const require=createRequire(import.meta.url);
  let api:import('typescript/sync').API|undefined,closed=false;
  let active:{filesystem:OracleFilesystem;configs:Set<string>;readingConfig:boolean;generated:ReturnType<typeof prepareGeneratedProject>[]} |undefined;
  const state=()=>{if(!active)throw Error('project input API has no active filesystem transaction');return active;};
  const owned=(path:string):string=>{
    const name=relative(source,path);
    if(name==='..'||name.startsWith('..'+sep)||resolve(source,name)!==path)throw Error('project input escapes source root: '+path);
    return name.split(sep).join('/');
  };
  function acquire(){
    if(api)return api;
    const {API}=require('typescript/sync') as typeof import('typescript/sync');
    const {serverFS}=require('typescript/fs') as typeof import('typescript/fs');
    return api=new API({cwd:source,fs:{
      directoryExists:path=>state().filesystem.directoryExists(path),fileExists:path=>state().filesystem.fileExists(path),
      getAccessibleEntries:path=>({...state().filesystem.getAccessibleEntries(path),symlinks:undefined}),
      realpath:path=>state().filesystem.realpath(path),stat:path=>state().filesystem.stat(path),writeFile:serverFS.error,removeFile:serverFS.error,
      readFile(path){
        const transaction=state(),bytes=transaction.filesystem.readFile(path);
        if(transaction.readingConfig&&bytes!==null&&!path.split(sep).includes('node_modules')&&!transaction.generated.some(row=>row.config===path))transaction.configs.add(owned(path));
        return bytes??undefined;
      },
    }});
  }
  return {read(entries:readonly ProjectRequest[]):ProjectInputs{
    if(closed)throw Error('project input owner is closed');
    if(active)throw Error('project input owner already has an active transaction');
    let programContext:ProjectProgramProvenance|undefined;
    const hostContexts=new Map<string,Set<ProjectProgramProvenance>>();
    const transaction={filesystem:new OracleFilesystem(observation=>{
      if(!programContext||!projectAncestorAbsence(source,observation))return;
      const key=JSON.stringify([observation.kind,observation.path]),contexts=hostContexts.get(key)??new Set();
      contexts.add(programContext);hostContexts.set(key,contexts);
    }),configs:new Set<string>(),readingConfig:false,generated:[] as ReturnType<typeof prepareGeneratedProject>[]};active=transaction;
    const {filesystem,configs}=transaction,roots=new Set<string>(),modules=new Map<string,Set<string>>();
    let captured:Capture|undefined;
    const toolchain=()=>captured??=installed?.()??captureToolchain(dirname(require.resolve('typescript/package.json')));
    let failure:{error:unknown}|undefined;
    try{
      const dependencies=projectDependencies(source,dependencyCatalog);
      const api=acquire(),ast=require('typescript/ast') as typeof import('typescript/ast');
      const projects = new Set<string>();
      function compile(parsed:ReturnType<typeof api.parseConfigFile>,selected:readonly string[],description:string,request:ProjectRequest):void {
        if (parsed.errors.length) throw new Error("compiled input cannot be parsed: " + description + "\n" +
          parsed.errors.map(error => `TS${error.code}: ${error.text}`).join("\n"));
        for (const file of selected) roots.add(owned(file));
        // The pinned Program, with the original options, owns each usage's mode,
        // package goal, type attributes, ambient roots and actual resolved edges.
        // Installed SDK facts are retained below as a separate authenticated capability.
        const provenance:ProjectProgramProvenance={request:structuredClone(request),config:transaction.generated.some(row=>row.config===description)?request.path:owned(description),imports:[],types:[...(parsed.options.types??[])]};
        programContext=provenance;
        let program:ReturnType<typeof api.createProgram>|undefined;
        try{
        program=api.createProgram(selected,parsed.options as import('typescript/sync').RawCompilerOptions,
          {configFileParsingDiagnostics:parsed.errors,projectReferences:parsed.projectReferences});
          const captured=toolchain();
          const sourceFiles=program.getSourceFileNames(),byteFacts=new Map(filesystem.captured().filter(row=>row.kind==='file').map(row=>[row.path,row]));
          for(const file of sourceFiles){
            const byteFact=byteFacts.get(file);
            if(byteFact&&toolchainFact(captured,byteFact))continue;
            if(byteFact&&dependencies.state==='current'&&dependencies.match(byteFact))continue;
            const name=owned(file),sourceFile=program.getSourceFile(file);
            if(!sourceFile)throw Error('compiled Program source disappeared: '+file);
            const edges=modules.get(name)??new Set<string>();modules.set(name,edges);
            for(const usage of sourceFile.imports){
              if(!ast.isStringLiteralLikeNode(usage))throw Error('compiled project import is not literal: '+file);
              const target=program.getResolvedModuleFromModuleSpecifier(usage,file)?.resolvedFileName;
              if(!target){provenance.imports.push({source:name,specifier:usage.text});continue;}
              const fact=byteFacts.get(target);
              if(fact&&toolchainFact(captured,fact))continue;
              if(fact&&dependencies.state==='current'&&dependencies.match(fact))continue;
              edges.add(owned(target));
            }
            for(const reference of sourceFile.referencedFiles){
              const target=resolve(dirname(file),reference.fileName);
              if(program.getSourceFile(target))edges.add(owned(target));
            }
          }
        }finally{try{program?.dispose();}finally{programContext=undefined;}}
      }
      function add(project: string,request:ProjectRequest): void {
        if (projects.has(project)) return;
        projects.add(project); if(!transaction.generated.some(row=>row.config===project))configs.add(owned(project));
        let parsed:ReturnType<typeof api.parseConfigFile>;
        transaction.readingConfig=true;try{parsed=api.parseConfigFile(project);}finally{transaction.readingConfig=false;}
        compile(parsed,parsed.fileNames,project,request);
        for (const reference of parsed.projectReferences ?? []) {
          const path = filesystem.runtimeKind(reference.path)==='directory' ? join(reference.path, "tsconfig.json") : reference.path;
          add(path,request);
        }
      }
      for(const entry of entries){
        const path=resolve(source,entry.path);owned(path);
        const generated=entry.kind==='generated'?prepareGeneratedProject({source,extends:entry.path,directory:entry.directory,include:entry.include,parent:generatedTemporaryParent}):undefined;
        if(generated)transaction.generated.push(generated);
        add(generated?.config??path,entry);
      }
      const capability=toolchainDescriptor(toolchain()),observations:HostObservation[]=[],installedObservations:ProjectInputs['installedObservations']=[],generatedObservations:ProjectInputs['generatedObservations']=[],hostObservations:ProjectInputs['hostObservations']=[],dependencyObservations:ProjectInputs['dependencyObservations']=[];
      for(const observation of filesystem.captured()){
        const generated=transaction.generated.find(row=>observation.path===row.capability.root||observation.path.startsWith(row.capability.root+sep));
        if(generated){
          if(!generatedProjectFact(generated.capability,observation))throw Error('unsupported generated project callback: '+observation.kind+' '+observation.path);
          generatedObservations.push({observation:structuredClone(observation),capability:structuredClone(generated.capability)});
        }else if(hostContexts.has(JSON.stringify([observation.kind,observation.path]))){
          // directoryExists=false alone also describes an ordinary file.
          // Require genuine absence, and retain that independent kind query.
          if(filesystem.runtimeKind(observation.path)!==null)throw Error('declared project external package path is present: '+observation.path);
          const environment:ProjectEnvironmentAbsence={kind:'project-environment-absence',source,programs:structuredClone([...hostContexts.get(JSON.stringify([observation.kind,observation.path]))!])};
          hostObservations.push({observation:structuredClone(observation),environment},
            {observation:{kind:'runtimeKind',path:observation.path,value:null},environment:structuredClone(environment)});
        }else if(toolchainFact(toolchain(),observation))installedObservations.push({observation:structuredClone(observation),capability});
        else if(dependencies.state==='current'){
          const dependency=dependencies.match(observation);
          if(dependency)dependencyObservations.push({observation:structuredClone(observation),dependency});
          else observations.push(structuredClone(observation));
        }
        else observations.push(structuredClone(observation));
      }
      const pinFilesystem=new OracleFilesystem();
      if(dependencyObservations.length&&dependencies.state==='current')for(const path of dependencies.pins)pinFilesystem.readFile(resolve(source,path));
      return {configs:[...configs],roots:[...roots],modules:[...modules].map(([path,imports])=>({path,imports:[...imports]})),observations,installedObservations,generatedObservations,hostObservations,dependencyObservations,pinObservations:pinFilesystem.captured()};
    }catch(error){failure={error};throw error;}
    finally{active=undefined;const failures:unknown[]=[];for(const generated of transaction.generated)try{generated.close();}catch(error){failures.push(error);}if(failures.length)throw new AggregateError(failure?[failure.error,...failures]:failures,'generated project cleanup failed',failure?{cause:failure.error}:undefined);}
  },close(){
    if(active)throw Error('project input owner cannot close an active transaction');
    if(closed)return;closed=true;api?.close();
  }};
}

/** A standalone call still gets an explicitly scoped owner. */
export function projectInputs(entries:readonly ProjectRequest[],source:string,installed?:()=>Capture):ProjectInputs{
  const owner=projectInputOwner(source,installed);
  try{return owner.read(entries);}finally{owner.close();}
}
