// Project discovery and parsed config inputs have one owner for selectors and staging.
import {createRequire} from 'node:module';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {captureToolchain,toolchainFact,toolchainDescriptor,type Capture,type InstalledTypeScript} from '../differential/oracle-toolchain.ts';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';
import {type HostObservation} from '../differential/oracle-runtime.ts';
import {prepareGeneratedProject,generatedProjectFact,type GeneratedProjectCapability} from './generated-project.ts';
import {projectMatch,type ProjectMatch,type ProjectRequest} from './project-discovery.ts';
import {projectAncestorAbsence,type ProjectEnvironmentAbsence,type ProjectProgramProvenance} from './project-environment.ts';
import {projectDependencies,type InstalledProjectDependency} from './project-dependencies.ts';
import type {DependencyCatalogTrust} from '../inputs/dependency-catalog.ts';

export type ProjectInputs={configs:string[];roots:string[];modules:{path:string;imports:string[]}[];observations:HostObservation[];installedObservations:{observation:HostObservation;capability:InstalledTypeScript}[];
  hostObservations:{observation:HostObservation;environment:ProjectEnvironmentAbsence}[];
  dependencyObservations:{observation:HostObservation;dependency:InstalledProjectDependency}[];pinObservations:HostObservation[];
  generatedObservations:{observation:HostObservation;capability:GeneratedProjectCapability}[];
  /** Present only while the installation catalog is pending: the installed
   * packages this Program itself classifies as external libraries. Their reads
   * stay ordinary observations; a materializing consumer owes the catalog. */
  installationReach?:InstallationReach;
  matches:ProjectMatch[];matchingEntries:string[]};
/** The Program's own external-library classification, named by its resolved
 * package identity where an import supplies one, else its package directory. */
export type InstallationReach={reason:string;packages:{package:string;file:string}[]};
/** One graph owns one lazy SDK process. Every read still constructs a fresh
 * Program and filesystem transaction; no result or observation is cached. */
export function projectInputOwner(source:string,installed?:()=>Capture,generatedTemporaryParent?:string,dependencyCatalog:DependencyCatalogTrust|null=null){
  const require=createRequire(import.meta.url);
  let api:import('typescript/sync').API|undefined,closed=false;
  let active:{filesystem:OracleFilesystem;configs:Set<string>;readingConfig:boolean;generated:ReturnType<typeof prepareGeneratedProject>[];matchingEntries:Set<string>;ordinaryEntries:Set<string>} |undefined;
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
      getAccessibleEntries:path=>{
        const transaction=state();(transaction.readingConfig?transaction.matchingEntries:transaction.ordinaryEntries).add(path);
        return {...transaction.filesystem.getAccessibleEntries(path),symlinks:undefined};
      },
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
    }),configs:new Set<string>(),readingConfig:false,generated:[] as ReturnType<typeof prepareGeneratedProject>[],matchingEntries:new Set<string>(),ordinaryEntries:new Set<string>()};active=transaction;
    const matches:ProjectMatch[]=[];
    const {filesystem,configs}=transaction,roots=new Set<string>(),modules=new Map<string,Set<string>>();
    const externalFiles=new Map<string,string>(),externalPackages=new Map<string,string>();
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
            if(dependencies.state==='pending'&&!externalFiles.has(name)){
              const metadata=program.getSourceFileMetadata(file);
              if(metadata?.isFromExternalLibrary)externalFiles.set(name,metadata.packageJsonDirectory?owned(metadata.packageJsonDirectory):name);
            }
            const edges=modules.get(name)??new Set<string>();modules.set(name,edges);
            for(const usage of sourceFile.imports){
              if(!ast.isStringLiteralLikeNode(usage))throw Error('compiled project import is not literal: '+file);
              const resolved=program.getResolvedModuleFromModuleSpecifier(usage,file),target=resolved?.resolvedFileName;
              if(!target){provenance.imports.push({source:name,specifier:usage.text});continue;}
              const fact=byteFacts.get(target);
              if(fact&&toolchainFact(captured,fact))continue;
              if(fact&&dependencies.state==='current'&&dependencies.match(fact))continue;
              const edge=owned(target);
              if(dependencies.state==='pending'&&resolved.isExternalLibraryImport&&resolved.packageId?.name)
                externalPackages.set(edge,resolved.packageId.version?resolved.packageId.name+'@'+resolved.packageId.version:resolved.packageId.name);
              edges.add(edge);
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
        const generated=transaction.generated.find(row=>row.config===project);
        matches.push(projectMatch(source,generated?request:{kind:'config',path:owned(project)},parsed.fileNames));
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
      // A package is named by an import's resolved identity when any of its
      // files has one; types and triple-slash reach keep the package directory.
      const labels=new Map<string,string>(),reached=new Map<string,string>();
      const external=[...externalFiles].sort(([a],[b])=>a.localeCompare(b));
      for(const [file,directory]of external){const label=externalPackages.get(file);if(label&&!labels.has(directory))labels.set(directory,label);}
      for(const [file,directory]of external){const label=labels.get(directory)??directory;if(!reached.has(label))reached.set(label,file);}
      const installationReach:InstallationReach|undefined=dependencies.state==='pending'&&reached.size
        ?{reason:dependencies.reason,packages:[...reached].map(([name,file])=>({package:name,file}))}:undefined;
      return {configs:[...configs],roots:[...roots],modules:[...modules].map(([path,imports])=>({path,imports:[...imports]})),observations,installedObservations,generatedObservations,hostObservations,dependencyObservations,pinObservations:pinFilesystem.captured(),matches,
        matchingEntries:[...transaction.matchingEntries].filter(path=>!transaction.ordinaryEntries.has(path)),
        ...(installationReach?{installationReach}:{})};
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
