import {gitArguments} from "./git-arguments/main.ts";
// Module membership, read from each source tree's own declarations.
// Literal relative import() is followed like a static import; computed imports
// (variables or interpolated templates) must be named as another entry.
import {lstatSync, readFileSync, realpathSync} from "node:fs";
import {isAbsolute, join, relative, resolve, sep} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import {createHash} from 'node:crypto';
import {SourceFacts} from './source-facts.ts';
import {captureToolchain,type Capture,type InstalledTypeScript} from '../differential/oracle-toolchain.ts';
import type {BuildModuleInputs} from './rust-modules.ts';
import {projectInputOwner,type ProjectInputs} from './project-inputs.ts';
import type {ProjectMatch,ProjectRequest} from './project-discovery.ts';
import {projectRole,executableModuleSource,fixtureNamespaces,moduleMemberName,projectMemberPrefix,relativeProjectInput,matchesModuleMember,directoryCandidates,type DataNamespaces,type DirectoryDeclaration,type ModuleDeclarations,type ReaderInput,type InputEntry,type OptionalFileDeclaration,type MembershipDeclaration,type ReaderContext,type ReaderProtocol} from './reader-inputs/main.ts';
import {directoryEntries,metadataParents,membershipIndex} from './reader-metadata.ts';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';
import {oracleNodePackageScopes,ORACLE_NODE_RESOLUTION_RECIPE,type HostObservation} from '../differential/oracle-runtime.ts';
import {captureReaderObservations,validateReaderBatchObservations} from './reader-observations.ts';
import {projectOwnerAncestorAbsence,type ProjectEnvironmentAbsence} from './project-environment.ts';
import type {InstalledProjectDependency} from './project-dependencies.ts';
import {readDependencyCatalog,type DependencyCatalogTrust} from '../inputs/dependency-catalog.ts';
import {cargoInputNames} from './cargo-input-population.ts';
import {dependencySourceCandidates} from '../inputs/dependency-source-candidates.ts';
import {gitStatusInputPopulation,installationStatusCandidates} from '../inputs/dependency-input-names.ts';
import type {GeneratedProjectCapability} from './generated-project.ts';
export type {DirectoryDeclaration,ModuleDeclarations} from './reader-inputs/main.ts';
export type ReaderObservation={reader:string;context:ReaderContext;protocol:ReaderProtocol;observation:HostObservation;
  observationOnly?:true;
  environment?:ProjectEnvironmentAbsence;
  dependency?:InstalledProjectDependency;selectorOnly?:true;
  capability?:InstalledTypeScript|GeneratedProjectCapability;causes:{kind:HostObservation['kind'];path:string}[]};
/** The canonical graph owns derived facts; the declaration leaf has no parser
 * or oracle dependency in either import direction. */
/** An input population the graph cannot authenticate: a declared installation
 * population, or the installed packages a declared Program reaches, while the
 * installation catalog is unavailable. */
export type UnavailableInput={kind:'installation-inputs';reader:string;context:ReaderContext;reason:string}
  |{kind:'installed-package-reach';reader:string;context:ReaderContext;project:string;package:string;reason:string};
export type InstalledPackageReach=Extract<UnavailableInput,{kind:'installed-package-reach'}>;
/** The one wording of an unmet installed-package obligation; a materializing
 * consumer appends the remedy its own source owns. */
export function installedPackageReachMessage(row:Pick<InstalledPackageReach,'project'|'reader'|'package'|'reason'>):string{
  return 'fixture closure needs the installation catalog: declared Program '+row.project+' ('+row.reader+') reaches installed package '+row.package+'; '+row.reason;
}
/** Refused under 'refuse' before any source-parent check, carrying its rows. */
export class InstalledPackageReachUnavailable extends Error{
  readonly rows:readonly InstalledPackageReach[];
  constructor(rows:readonly InstalledPackageReach[]){super(installedPackageReachMessage(rows[0]!));this.name='InstalledPackageReachUnavailable';this.rows=rows;}
}
/** files selects committed changes; runtimeFiles also claims reads made only
 * by superset race guards. Placement and fixture reproduction are independent. */
export type InputSnapshot={files:string[];runtimeFiles?:string[];ownedFiles:string[];moduleFiles:string[];hostFiles:string[];placingFiles:string[];stagingFiles:string[];directories:DirectoryDeclaration[];
  unavailableInputs?:UnavailableInput[];
  optionalFiles:OptionalFileDeclaration[];memberships:MembershipDeclaration[];observations:ReaderObservation[];
  projectMatches:(ProjectMatch&{reader:string;context:ReaderContext})[]};

const SOURCE = fileURLToPath(new URL("../..", import.meta.url));
export type ByteInputDeclaration={reader:string;path:string};
export type ModuleDescriptionRequest={entries:readonly InputEntry[];buildModules?:BuildModuleInputs};
export type ModuleDescription={snapshot:InputSnapshot;byteInputs:ByteInputDeclaration[]};
export type ModuleClosureOptions = {sourceRoot?: string; directory?: (declaration: DirectoryDeclaration) => void;
  dependencyCatalog?:DependencyCatalogTrust|null;
  /** Fixture project roots whose local type source closure is reproduced in
   * addition to ordinary runtime inputs; never resolves installed packages. */
  localTypeEntries?:readonly string[];
  /** A selector retains an explicit any-change obligation. Every materializing
   * consumer instead refuses inputs whose population it cannot authenticate. */
  unavailableInputs?:'conservative'|'refuse';
  generatedTemporaryParent?:string;
  byteInput?:(declaration:ByteInputDeclaration)=>void;
  /** Only an actual Node invocation owner selects this versioned protocol. */
  nodeMajor?:26;
  /** A caller which already owns parsed source facts supplies detached edges. */
  declarations?:ReadonlyMap<string,ModuleDeclarations>};
const inside = (root: string, path: string) => {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(".." + sep) && !isAbsolute(part);
};

/** Close only acquired owners; one cleanup failure cannot replace another. */
export function closeModuleGraphOwners(owners:readonly ({name:string;close:()=>void}|undefined)[]):void{
  const errors:Error[]=[];
  for(const owner of owners)if(owner)try{owner.close();}catch(error){errors.push(new Error('module graph '+owner.name+' close failed: '+String(error),{cause:error}));}
  if(errors.length)throw new AggregateError(errors,'module graph cleanup failed');
}

/** Runtime declarations, including re-exports and literal relative
 * import() calls. Data strings,
 * computed imports and package resolution cannot invent file inputs. Each
 * graph reads fresh bytes; closures share only this graph's parsed references.
 * Module-relative URL assets are declarations too. Dot-only positions are
 * anchors, while a directory asset declares its tracked files. Exact fileInput
 * bytes stay owned but do not enter imports; moduleFiles records that separate
 * traversal, including a later real module edge into previously owned bytes.
 * placingFiles retains every declared role except inspection-only membership,
 * including immutable project configs and inherited configs. */
export function moduleGraph(options: ModuleClosureOptions = {}) {
  // Input provisioning imports this module before node_modules exists. Only a
  // caller actually walking a graph needs the already provisioned parser.
  const require = createRequire(import.meta.url);
  const {API} = require("typescript/sync") as typeof import("typescript/sync");
  const root = realpathSync(options.sourceRoot ?? SOURCE);
  if(options.nodeMajor!==undefined&&!ORACLE_NODE_RESOLUTION_RECIPE.nodeMajors.includes(options.nodeMajor))
    throw Error('unsupported host module Node recipe: '+String(options.nodeMajor));
  const references = new Map<string,ModuleDeclarations>();
  const sourceInputs=new Map<string,string>();
  const sourceTexts=new Map<string,string>();
  // The same graph owns parsed source bytes and their source-file identity.
  // Namespace/host promotion reuses that identity without repeating realpath.
  // Captured protocol observations have their own fresh read/validation path.
  const ownedSources=new Set<string>();
  const hostImports=new Map<string,Set<string>>();
  const localTypeImports=new Map<string,readonly string[]>();
  let tracked: string[] | undefined;
  // A graph owns one tracked inventory. Contexts select from that inventory;
  // they never need to rescan every tracked path for the same directory.
  const directoryFiles=new Map<string,string[]>(),memberFiles=new Map<string,Map<string,string[]>>();
  let metadataIndex:ReturnType<typeof membershipIndex>|undefined;
  const sourceFiles=()=>tracked??=execFileSync("git",gitArguments(["ls-files","-z","--cached"]),{cwd:root,encoding:"utf8",maxBuffer:64<<20}).split("\0").filter(Boolean);
  function membersOf(directory:string,member?:string):string[]{
    let files=directoryFiles.get(directory);
    if(!files){
      tracked=sourceFiles();
      const prefix=directory?directory+'/':'';
      files=prefix?tracked.filter(file=>file.startsWith(prefix)):tracked;
      directoryFiles.set(directory,files);
    }
    if(!member)return files;
    let selections=memberFiles.get(directory);
    if(!selections){selections=new Map();memberFiles.set(directory,selections);}
    let selected=selections.get(member);
    if(!selected){
      selected=files.filter(file=>matchesModuleMember(directory?file.slice(directory.length+1):file,member));
      selections.set(member,selected);
    }
    return selected;
  }
  let api:import('typescript/sync').API|undefined,toolchain:Capture|undefined,projects:ReturnType<typeof projectInputOwner>|undefined;
  let closed=false,batching=false;
  const installed=()=>toolchain??=captureToolchain(resolve(require.resolve('typescript/package.json'),'..'));
  function parseSource<T>(path:string,read:(facts:SourceFacts)=>T):T{
    let source=sourceTexts.get(path);
    if(source===undefined){
      const bytes=readFileSync(path);source=bytes.toString('utf8');sourceTexts.set(path,source);
      sourceInputs.set(relative(root,path).split(sep).join('/'),createHash('sha256').update(bytes).digest('hex'));
    }
    api??=new API({cwd:root});
    const lease=api.createSourceFile(path,source);
    try{return read(new SourceFacts(relative(root,path).split(sep).join('/'),source,lease.sourceFile));}
    finally{lease.dispose();}
  }
  function localImports(path:string):readonly string[]{
    const known=localTypeImports.get(path);if(known)return known;
    if(options.declarations?.has(relative(root,path).split(sep).join('/')))throw Error('local type inputs require parsed source facts: '+path);
    return parseSource(path,facts=>{const imports=facts.localTypeImports();localTypeImports.set(path,imports);return imports;});
  }
  function parsed(path: string) {
    const known = references.get(path);
    if (known) return known;
    const supplied=options.declarations?.get(relative(root,path).split(sep).join('/'));
    if(supplied){references.set(path,supplied);hostImports.set(path,new Set(supplied.imports));return supplied;}
    return parseSource(path,facts=>{
      const result=facts.moduleDeclarations();
      hostImports.set(path,new Set(facts.hostModuleImports()));
      localTypeImports.set(path,facts.localTypeImports());
      references.set(path,result);return result;
    });
  }
  type ProjectRead=(request:ProjectRequest,context:ReaderContext)=>ProjectInputs;
  const readProject:ProjectRead=request=>(projects??=projectInputOwner(root,installed,options.generatedTemporaryParent,options.dependencyCatalog??null)).read([request]);
  function describe(entries:readonly InputEntry[],reportDirectory:ModuleClosureOptions['directory']=options.directory,reportByteInput:ModuleClosureOptions['byteInput']=options.byteInput,buildModules?:BuildModuleInputs):InputSnapshot {
    return describeUsing(entries,reportDirectory,reportByteInput,buildModules,readProject);
  }
  function describeUsing(entries:readonly InputEntry[],reportDirectory:ModuleClosureOptions['directory'],reportByteInput:ModuleClosureOptions['byteInput'],buildModules:BuildModuleInputs|undefined,projectRead:ProjectRead):InputSnapshot {
    if(closed)throw Error('module graph is closed');
    if(batching&&projectRead===readProject)throw Error('module graph already has an active batch');
    const runtimeFiles=new Set<string>();
    const files=new Set<string>(),owned=new Set<string>(),moduleFiles=new Set<string>(),hostFiles=new Set<string>(),placing=new Set<string>(),staging=new Set<string>(),directories:DirectoryDeclaration[]=[];
    const optionalFiles:OptionalFileDeclaration[]=[],memberships:MembershipDeclaration[]=[];
    const observations:ReaderObservation[]=[];
    const projectMatches:InputSnapshot['projectMatches']=[];
    const unavailableInputs:UnavailableInput[]=[];
    type Context={entry:string;namespaces:DataNamespaces;entered:Set<string>;host:Set<string>;owned:Set<string>;projects:Set<string>;data:Set<string>;
      localTypes?:true;projectRole?:import('./reader-inputs/main.ts').ProjectRole;compiledImports?:ReadonlyMap<string,readonly string[]>};
    const contexts=new Map<string,Context>();
    const nameOf=(path:string)=>relative(root,path).split(sep).join('/');
    const observe=(context:Context,reader:string,protocol:ReaderObservation['protocol'],rows:HostObservation[],matchingEntries:ReadonlySet<string>=new Set())=>{
      for(const captured of captureReaderObservations(root,rows)){
        if(captured.observation.kind==='file'&&captured.observation.value!==null&&inside(root,captured.observation.path))
          visit(context,captured.observation.path,false,false,false);
        const observationOnly=captured.causes.length>0&&captured.causes.every(cause=>cause.kind==='entries'&&matchingEntries.has(cause.path));
        observations.push({reader,context:{entry:context.entry,dataNamespaces:context.namespaces},protocol,...captured,...(observationOnly?{observationOnly:true as const}:{})});
      }
    };
    /** The Program and its emitter probes own one set of typed answers. One
     * capture merges their shared binding facts and unions the actual causes;
     * capturing twice retains a second copy of the same source identities. */
    function observeCompiledProject(context:Context,reader:string,project:ProjectInputs,request:ProjectRequest,config:string):void{
      const modules=project.modules.map(row=>row.path).filter(path=>! /\.d\.[cm]?ts$/.test(path)),lookups=new OracleFilesystem(),ancestorLookups:string[]=[];
      for(const module of modules){
        const physical=lookups.realpath(resolve(root,module));if(!inside(root,physical))throw Error('compiled project module resolves outside source: '+module);
        const nearest=lookups.projectFor(physical);
        if(nearest){
          if(!inside(root,nearest))throw Error('compiled project nearest config is outside source: '+nearest+' ('+module+')');
          lookups.readBytes(nearest);
        }else ancestorLookups.push(module);
      }
      const local:HostObservation[]=[];
      const environment:ProjectEnvironmentAbsence={kind:'project-environment-absence',source:root,programs:[{request:structuredClone(request),config,imports:[],types:[],ownerLookups:ancestorLookups}]};
      for(const observation of lookups.captured()){
        if(inside(root,observation.path)){local.push(observation);continue;}
        if(!projectOwnerAncestorAbsence(root,observation)||lookups.runtimeKind(observation.path)!==null)
          throw Error('compiled project owner lookup has no genuine ancestor absence: '+observation.path);
        for(const fact of [observation,{kind:'runtimeKind' as const,path:observation.path,value:null}])
          observations.push({reader,context:{entry:context.entry,dataNamespaces:context.namespaces},protocol:'project',observation:structuredClone(fact),environment,causes:[{kind:fact.kind,path:fact.path}]});
      }
      observe(context,reader,'project',[...project.observations,...local],new Set(project.matchingEntries));
    }
    function optionalPresence(context:Context,reader:string,path:string,inspectionOnly=false,observationOnly=false):boolean{
      metadataParents(root,path,'optional file');
      let stat:ReturnType<typeof lstatSync>|undefined;
      try{stat=lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      const name=nameOf(path);
      if(stat&&(!stat.isFile()||stat.isSymbolicLink()))throw Error('optional file input is not a regular file: '+name);
      optionalFiles.push({reader,path:name,present:!!stat,context:{entry:context.entry,dataNamespaces:context.namespaces},...(inspectionOnly?{inspectionOnly:true as const}:{}),...(observationOnly?{observationOnly:true as const}:{})});
      // Even an absent candidate may become bytes in the next source tree.
      if(!observationOnly)reportByteInput?.({reader,path:name});
      if(stat)visit(context,path,false,false,false,false,!inspectionOnly,!observationOnly);
      return !!stat;
    }
    function asset(context:Context,reader:string,path:string,input:ReaderInput,host=true):void {
      // Directory URLs may carry a trailing separator. These root descriptors
      // have one lexical representation before containment or equality checks.
      if(['installation-inputs','cargo-inputs','dependency-source-inputs','installation-status-inputs'].includes(input.kind))path=resolve(path);
      if (!inside(root, path)) throw new Error("asset escapes source root: " + path);
      const kind=input.kind;
      if(['project-config','project-choice','project-catalogue','project-members','generated-project'].includes(kind))projectRole(input.role);
      // Accepted main blobs have no candidate filesystem or staging role.
      if(kind==='accepted-revision')return;
      if(kind==='installation-inputs'||kind==='cargo-inputs'||kind==='dependency-source-inputs'||kind==='installation-status-inputs'){
        if(path!==root)throw Error(kind+' must name the canonical source root: '+reader);
        const statusPopulation=(paths:readonly string[],observationOnly=false)=>{
          const population=gitStatusInputPopulation(paths,sourceFiles());
          for(const name of population.files)optionalPresence(context,reader,resolve(root,name),reader!=='<entry>',observationOnly);
          for(const name of population.controls)optionalPresence(context,reader,resolve(root,name),reader!=='<entry>',observationOnly);
          for(const directory of population.directories){
            const row:DirectoryDeclaration={reader,directory,kind:'inspection',files:population.files.filter(file=>file.startsWith(directory+'/')),context:{entry:context.entry,dataNamespaces:{...context.namespaces}}};
            directories.push(row);reportDirectory?.(row);
          }
        };
        if(kind==='dependency-source-inputs'){
          statusPopulation(dependencySourceCandidates(root),true);
        }else if(kind==='installation-status-inputs'){
          statusPopulation(installationStatusCandidates(sourceFiles(),path=>readFileSync(resolve(root,path),'utf8')));
        }else if(kind==='cargo-inputs'){
          for(const name of cargoInputNames(sourceFiles().map(path=>({path}))))visit(context,resolve(root,name),false,false,false);
        }else{
          const installed=readDependencyCatalog(options.dependencyCatalog??null,root);
          if(installed.state!=='current'){
            if(options.unavailableInputs!=='conservative')throw Error('installation input population is unavailable: '+installed.reason);
            unavailableInputs.push({kind,reader,context:{entry:context.entry,dataNamespaces:{...context.namespaces}},reason:installed.reason});return;
          }
          for(const pin of [...installed.catalog.identity.inputs,...installed.catalog.recipes])optionalPresence(context,reader,resolve(root,pin.path));
        }
        return;
      }
      if(kind==='conservative'){
        if(path!==root)metadataParents(root,path,'conservative directory');
        const filesystem=new OracleFilesystem(),members:string[]=[];
        filesystem.inputIdentity(path,root,false);
        const walk=(directory:string,mayBeAbsent=false):void=>{
          const type=filesystem.runtimeKind(directory);
          if(type===null&&mayBeAbsent)return;
          if(type!=='directory')throw Error('conservative directory traversal is not an owned directory: '+nameOf(directory));
          const entries=directoryEntries(directory),names=filesystem.runtimeEntries(directory);
          if(JSON.stringify(entries.map(row=>row.name).sort())!==JSON.stringify([...names].sort()))throw Error('conservative directory changed during traversal: '+nameOf(directory));
          for(const entry of entries){
            const target=join(directory,entry.name),type=filesystem.runtimeKind(target);
            if(type!==entry.type)throw Error('conservative input changed during traversal: '+nameOf(target));
            if(type==='directory')walk(target);
            else if(type==='file'){visit(context,target,false,false,false);members.push(nameOf(target));}
            else throw Error('conservative traversal refuses symbolic or unsupported input: '+nameOf(target));
          }
        };
        walk(path,true);observe(context,reader,'filesystem',filesystem.captured());
        const row:DirectoryDeclaration={reader,directory:nameOf(path),kind:'conservative',files:members.sort(),context:{entry:context.entry,dataNamespaces:{...context.namespaces}}};
        directories.push(row);reportDirectory?.(row);return;
      }
      if(kind==='directory-candidates'){
        const candidates=directoryCandidates(pathToFileURL(path),input.candidates!).candidates;
        asset(context,reader,path,{kind:'membership',path:input.path},false);
        const entries=directoryEntries(path),filesystem=new OracleFilesystem();
        for(const entry of entries)if(filesystem.directoryExists(join(path,entry.name))){
          for(const candidate of candidates){
            const target=join(path,entry.name,candidate.name);
            if(candidate.kind==='optional-file')optionalPresence(context,reader,target);
            else if(candidate.kind==='file-exists')filesystem.fileExists(target);
            else if(candidate.kind==='directory-exists')filesystem.directoryExists(target);
            else{
              const identity=filesystem.inputIdentity(target,root);
              if(!inside(root,identity.path))throw Error('directory candidate resolves outside source root: '+target);
              // Path::exists follows links and accepts every existing kind;
              // fileExists deliberately answers the different is_file query.
              if(identity.state==='resolved')filesystem.runtimeKind(identity.path);
            }
          }
        }
        observe(context,reader,'filesystem',filesystem.captured());
        if(JSON.stringify(directoryEntries(path))!==JSON.stringify(entries))throw Error('directory candidate population changed during discovery: '+nameOf(path));
        return;
      }
      if(kind==='project-choice'){
        if(!Array.isArray(input.alternatives))throw Error('project choice has no relative alternatives: '+reader);
        const candidates=[path,...input.alternatives.map(value=>fileURLToPath(new URL(relativeProjectInput(value),pathToFileURL(path))))];
        if(candidates.some(candidate=>!inside(root,candidate)))throw Error('project choice escapes source root: '+reader);
        for(const candidate of candidates)if(optionalPresence(context,reader,candidate)){
          asset(context,reader,candidate,{kind:'project-config',path:'',role:input.role},false);return;
        }
        throw Error('project choice has no present config: '+reader);
      }
      if(kind==='project-catalogue'){
        if(typeof input.directory!=='string')throw Error('project catalogue has no directory: '+reader);
        asset(context,reader,path,{kind:'file',path:input.path},false);
        const directory=fileURLToPath(new URL(relativeProjectInput(input.directory),pathToFileURL(path)));
        if(!inside(root,directory))throw Error('project catalogue directory escapes source root: '+reader);
        // Catalogue bytes are immutable. Only the choosing source's parser
        // selects these configs; no adjacent directory becomes a byte grant.
        const text=readFileSync(path,'utf8'),names=new Set<string>();
        for(const [index,line]of text.split(/\r?\n/).entries()){
          if(!line||line.startsWith('#'))continue;
          const fields=line.split('\t');
          if(fields.length!==5)throw Error('project catalogue needs five columns: '+nameOf(path)+':'+(index+1));
          const name=moduleMemberName(fields[0]);
          if(names.has(name))throw Error('project catalogue repeats a project: '+name);names.add(name);
          asset(context,reader,join(directory,name,'tsconfig.json'),{kind:'project-config',path:'',role:input.role},false);
        }
        if(readFileSync(path,'utf8')!==text)throw Error('project catalogue changed during discovery: '+nameOf(path));
        return;
      }
      if(kind==='project-members'){
        const prefix=projectMemberPrefix(input.prefix);
        asset(context,reader,path,{kind:'membership',path:input.path},false);
        const entries=directoryEntries(path),filesystem=new OracleFilesystem();
        for(const entry of entries)if(entry.name.startsWith(prefix)){
          const config=join(path,entry.name,'tsconfig.json');
          if(!input.optional||filesystem.fileExists(config))asset(context,reader,config,{kind:'project-config',path:'',role:input.role},false);
        }
        if(input.optional)observe(context,reader,'project',filesystem.captured());
        if(JSON.stringify(directoryEntries(path))!==JSON.stringify(entries))throw Error('project member population changed during discovery: '+nameOf(path));
        return;
      }
      if(kind==='optional-file'||kind==='optional-module'){
        if(optionalPresence(context,reader,path)&&kind==='optional-module')visit(context,path,true,true,host||buildModules?.files.has(reader)===true);
        return;
      }
      if(kind==='membership'){
        if(path!==root)metadataParents(root,path,'membership input');
        const stat=lstatSync(path);
        if(!stat.isDirectory()||stat.isSymbolicLink()||!inside(root,realpathSync(path)))
          throw Error('membership input is not an owned directory: '+nameOf(path));
        memberships.push({reader,directory:nameOf(path),entries:directoryEntries(path),context:{entry:context.entry,dataNamespaces:context.namespaces}});
        return;
      }
      if(kind==='fixture'){
        const namespaces=fixtureNamespaces(input.dataNamespaces??{}),entry=nameOf(path);
        const key=JSON.stringify([entry,Object.entries(namespaces).sort(([a],[b])=>a.localeCompare(b))]);
        let child=contexts.get(key);
        if(!child){
          child={entry,namespaces,entered:new Set(),host:new Set(),owned:new Set(),projects:new Set(),data:new Set()};
          contexts.set(key,child);
        }
        visit(child,path,true,true,host);
        for(const directory of Object.keys(namespaces))if(!child.data.has(directory))
          throw Error('fixture data namespace is not a declared data input: '+directory+' ('+entry+')');
        return;
      }
      if(kind==='project-config'||kind==='generated-project'){
        const entry=nameOf(path);
        const role=projectRole(input.role);
        const key=JSON.stringify([kind,entry,input.directory,input.include,role]);
        if(context.projects.has(key))return;
        context.projects.add(key);
        let request:ProjectRequest={kind:'config',path:entry};
        if(kind==='generated-project'){
          if(typeof input.directory!=='string'||input.include!=='directory'&&input.include!=='typescript-tree')throw Error('generated project has no exact include recipe: '+reader);
          const directory=fileURLToPath(new URL(relativeProjectInput(input.directory),pathToFileURL(path)));
          if(!inside(root,directory))throw Error('generated project directory escapes source root: '+reader);
          const supplied=join(directory,'tsconfig.json');
          request=optionalPresence(context,reader,supplied)?{kind:'config',path:nameOf(supplied)}:{kind:'generated',path:entry,directory:nameOf(directory),include:input.include};
        }
        if(kind!=='generated-project'||request.kind==='generated')visit(context,path,false,true,false);
        const project=projectRead(request,{entry:context.entry,dataNamespaces:context.namespaces});
        if(role!=='compiled-program')observe(context,reader,'project',project.observations,new Set(project.matchingEntries));
        for(const match of project.matches)projectMatches.push({...structuredClone(match),reader,context:{entry:context.entry,dataNamespaces:structuredClone(context.namespaces)}});
        // Selection forces the reader's steps; a materializing consumer refuses
        // before any source-parent check; an unasked graph keeps its reads.
        if(project.installationReach&&options.unavailableInputs){
          const reached=project.installationReach,rows=reached.packages.map(row=>({kind:'installed-package-reach' as const,reader,
            context:{entry:context.entry,dataNamespaces:{...context.namespaces}},project:request.path,package:row.package,reason:reached.reason}));
          if(options.unavailableInputs==='refuse')throw new InstalledPackageReachUnavailable(rows);
          unavailableInputs.push(...rows);
        }
        if(role==='compiled-program')observeCompiledProject(context,reader,project,request,entry);
        for(const fact of project.dependencyObservations)observations.push({reader,context:{entry:context.entry,dataNamespaces:context.namespaces},protocol:'project',
          observation:structuredClone(fact.observation),dependency:structuredClone(fact.dependency),causes:[{kind:fact.observation.kind,path:fact.observation.path}]});
        for(const fact of captureReaderObservations(root,project.pinObservations)){
          if(fact.observation.kind==='file'&&fact.observation.value!==null)visit(context,fact.observation.path,false,false,false,true);
          observations.push({reader,context:{entry:context.entry,dataNamespaces:context.namespaces},protocol:'project',...fact,selectorOnly:true});
        }
        for(const fact of project.hostObservations)observations.push({reader,context:{entry:context.entry,dataNamespaces:context.namespaces},protocol:'project',
          observation:structuredClone(fact.observation),environment:structuredClone(fact.environment),causes:[{kind:fact.observation.kind,path:fact.observation.path}]});
        for(const fact of project.installedObservations)observations.push({reader,context:{entry:context.entry,dataNamespaces:context.namespaces},protocol:'project',
          observation:structuredClone(fact.observation),capability:structuredClone(fact.capability),causes:[{kind:fact.observation.kind,path:fact.observation.path}]});
        for(const fact of project.generatedObservations)observations.push({reader,context:{entry:context.entry,dataNamespaces:context.namespaces},protocol:'project',
          observation:structuredClone(fact.observation),capability:structuredClone(fact.capability),causes:[{kind:fact.observation.kind,path:fact.observation.path}]});
        for(const config of project.configs)visit(context,resolve(root,config),false);
        // A compiler project has its own resolution and visit state. Literal
        // host imports and another project's options cannot replace its edges.
        const compiled:Context={entry:context.entry,namespaces:context.namespaces,entered:new Set(),host:new Set(),owned:new Set(),projects:context.projects,data:context.data,
          projectRole:role,compiledImports:new Map(project.modules.map(row=>[row.path,row.imports]))};
        for(const entry of new Set([...project.roots,...project.modules.map(row=>row.path)]))visit(compiled,resolve(root,entry),true,true,false);

        return;
      }
      if (!lstatSync(path).isDirectory()) {
        if(kind==='data'||kind==='inspection')throw Error('declared '+kind+' input is not a directory: '+nameOf(path));
        if(kind==='members')throw Error('declared module members input is not a directory: '+nameOf(path));
        if(kind==='file')reportByteInput?.({reader,path:nameOf(path)});
        visit(context,path,kind!=='file',true,host);return;
      }
      if(kind==='file')throw Error('declared file input is not a file: '+nameOf(path));
      if (!inside(root, realpathSync(path))) throw new Error("asset is not an owned directory: " + path);
      const member=kind==='members'?moduleMemberName(input.member):undefined;
      const directory=nameOf(path);
      // One descriptor may retain a reader's existing metadata/data population
      // while entering only its named executable members. Private data grants
      // never remove the immutable member modules visited below.
      if(kind==='members'&&input.data)asset(context,reader,path,{path:input.path,kind:'data'},host);
      if(kind==='data')context.data.add(directory);
      const grant=kind==='data'?Object.keys(context.namespaces).find(name=>directory===name||directory.startsWith(name+'/')):undefined;
      const members=grant?[]:membersOf(directory,member);
      const row:DirectoryDeclaration={reader,directory,files:[...members],kind:kind==='members'?'module':kind,
        ...(member?{member}:{}),
        ...(grant?{fixture:{entry:context.entry,owner:context.namespaces[grant]!}}:{})};
      directories.push(row);reportDirectory?.(row);
      if(grant)return;
      for(const file of members){
        if(kind==='data'){files.add(file);runtimeFiles.add(file);placing.add(file);staging.add(file);}
        else visit(context,resolve(root,file),kind!=='inspection',kind!=='inspection',host);
      }
    }
    function visit(context:Context,path:string,enter=true,place=true,host=enter,compileOnly=false,stage=true,select=true):void {
      if (!inside(root, path)) throw new Error("module escapes source root: " + path);
      const name=nameOf(path);if(!compileOnly)runtimeFiles.add(name);if(stage){staging.add(name);owned.add(name);}if(select)files.add(name);
      if(enter?context.entered.has(name)&&(!host||context.host.has(name)):context.owned.has(name)){if(place)placing.add(name);return;}
      if(!ownedSources.has(path)){
        if (!lstatSync(path).isFile() || !inside(root, realpathSync(path))) throw new Error("module is not an owned source file: " + name);
        ownedSources.add(path);
      }
      context.owned.add(name);if(place)placing.add(name);
      if(!enter)return;
      context.entered.add(name);moduleFiles.add(name);
      if(host){
        context.host.add(name);hostFiles.add(name);
        if(options.nodeMajor!==undefined&&executableModuleSource(path)&&! /\.d\.[cm]?ts$/.test(path)){
          const filesystem=new OracleFilesystem(),physical=filesystem.realpath(path);
          for(const route of new Set([path,physical]))for(const candidate of oracleNodePackageScopes(route)){
            const bytes=filesystem.readBytes(candidate);
            if(bytes!==null){
              if(inside(root,candidate))visit(context,candidate,false,false,false);
              break;
            }
          }
          observe(context,name,'node26',filesystem.captured());
        }
      }
      // Aggregate ownership never suppresses another namespace context. A
      // later production import must still restore its real data membership.
      if(!executableModuleSource(path)&&!options.declarations?.has(name))return;
      if(context.localTypes){
        const imports=localImports(path);
        for(const specifier of imports){
          if(!/^\.\.?\//.test(specifier)||specifier.includes('\\'))throw Error('local type reference must name a relative source file: '+name+': '+specifier);
          const target=fileURLToPath(new URL(specifier,pathToFileURL(path)));
          if(nameOf(target).split('/').includes('node_modules'))throw Error('local type input enters an installed package: '+name+' -> '+specifier);
          visit(context,target,true,true,false,true);
        }
        return;
      }
      if(context.projectRole==='type-check')return;
      for(const target of buildModules?.imports.get(name)??[])visit(context,resolve(root,target),true,true,false,true);
      const {imports,assets}=parsed(path);
      const compiled=context.compiledImports?.get(name);
      if(compiled)for(const target of compiled)visit(context,resolve(root,target),true,true,false);
      else for(const specifier of imports)visit(context,fileURLToPath(new URL(specifier,pathToFileURL(path))),true,true,(host||buildModules?.files.has(name)===true)&&hostImports.get(path)!.has(specifier));
      for(const input of assets)asset(context,name,fileURLToPath(new URL(input.path,pathToFileURL(path))),input,host);
    }
    const production:Context={entry:'<entry>',namespaces:{},entered:new Set(),host:new Set(),owned:new Set(),projects:new Set(),data:new Set()};
    for(const entry of entries){
      if(typeof entry!=='string'){
        asset(production,'<entry>',fileURLToPath(entry.url),{path:entry.url.href,kind:entry.kind,
          ...('role' in entry?{role:entry.role}:{}),
          ...(entry.kind==='fixture'?{dataNamespaces:entry.dataNamespaces}:entry.kind==='members'?{member:entry.member,...(entry.data?{data:true}:{})}:entry.kind==='project-choice'?{alternatives:[...entry.alternatives]}:entry.kind==='project-catalogue'?{directory:entry.directory}:entry.kind==='project-members'?{prefix:entry.prefix,...(entry.optional?{optional:true}:{})}:entry.kind==='generated-project'?{directory:entry.directory,include:entry.include}:entry.kind==='directory-candidates'?{candidates:entry.candidates}:{})});
        continue;
      }
      if(isAbsolute(entry))throw Error('module entry must be repository-relative: '+entry);
      const path=resolve(root,entry);
      if(lstatSync(path).isDirectory())asset(production,'<entry>',path,{path:entry,kind:'module'});
      else visit(production,path,true,true,!buildModules?.files.has(nameOf(path)),buildModules?.files.has(nameOf(path))??false);
    }
    if(options.localTypeEntries?.length){
      const types:Context={entry:'<entry>',namespaces:{},entered:new Set(),host:new Set(),owned:new Set(),projects:new Set(),data:new Set(),localTypes:true};
      for(const entry of options.localTypeEntries){
        if(isAbsolute(entry)||entry.split('/').includes('node_modules'))throw Error('local type entry must be a repository-local source: '+entry);
        visit(types,resolve(root,entry),true,true,false,true);
      }
    }
    return {files:[...files].sort(),runtimeFiles:[...runtimeFiles].sort(),ownedFiles:[...owned].sort(),moduleFiles:[...moduleFiles].sort(),hostFiles:[...hostFiles].sort(),placingFiles:[...placing].sort(),stagingFiles:[...staging].sort(),directories,optionalFiles,memberships,observations,projectMatches,...(unavailableInputs.length?{unavailableInputs}:{})};
  }
  /** A batch is one transaction, not a graph-lifetime result cache. Compiler
   * requests include their complete recipe and namespace context. Each first
   * request gets a fresh Program/filesystem; duplicate requests share only its
   * detached primitive answers, validated before anything escapes this call. */
  function describeBatch(requests:readonly ModuleDescriptionRequest[]):ModuleDescription[]{
    if(closed)throw Error('module graph is closed');
    if(batching)throw Error('module graph already has an active batch');
    batching=true;
    // Parser references are an intra-walk optimization too. Another explicit
    // batch must parse changed modules and enumerate its current tracked set.
    references.clear();sourceInputs.clear();sourceTexts.clear();ownedSources.clear();hostImports.clear();localTypeImports.clear();
    tracked=undefined;directoryFiles.clear();memberFiles.clear();metadataIndex=undefined;
    const discoveries=new Map<string,ProjectInputs>();
    const batchRead:ProjectRead=(request,context)=>{
      const key=JSON.stringify([request,context.entry,Object.entries(context.dataNamespaces).sort(([a],[b])=>a.localeCompare(b))]);
      let result=discoveries.get(key);
      if(!result){result=readProject(request,context);discoveries.set(key,result);}
      return result;
    };
    try{
      const results=requests.map(request=>{
        const byteInputs:ByteInputDeclaration[]=[];
        const snapshot=describeUsing(request.entries,()=>{},row=>byteInputs.push({...row}),request.buildModules,batchRead);
        return {snapshot,byteInputs};
      });
      validateReaderBatchObservations(results.map(row=>row.snapshot),root);
      for(const result of results){
        for(const row of result.snapshot.optionalFiles){
          const path=resolve(root,row.path);metadataParents(root,path,'reader batch optional file');
          let stat:ReturnType<typeof lstatSync>|undefined;
          try{stat=lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
          if(stat&&(!stat.isFile()||stat.isSymbolicLink())||!!stat!==row.present)throw Error('reader batch optional file changed: '+row.path);
        }
        for(const row of result.snapshot.memberships){
          const path=resolve(root,row.directory);metadataParents(root,path,'reader batch membership');
          const stat=lstatSync(path);
          if(!stat.isDirectory()||stat.isSymbolicLink()||JSON.stringify(directoryEntries(path))!==JSON.stringify(row.entries))
            throw Error('reader batch membership changed: '+row.directory);
        }
      }
      for(const [path,sha256]of sourceInputs)if(createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex')!==sha256)
        throw Error('reader batch source changed after parse: '+path);
      for(const path of ownedSources)if(!lstatSync(path).isFile()||!inside(root,realpathSync(path)))throw Error('reader batch source ownership changed: '+nameInRoot(path));
      if(tracked&&JSON.stringify(sourceFiles())!==JSON.stringify(execFileSync('git',gitArguments(['ls-files','-z','--cached']),{cwd:root,encoding:'utf8',maxBuffer:64<<20}).split('\0').filter(Boolean)))
        throw Error('reader batch tracked population changed during discovery');
      return results;
    }finally{discoveries.clear();batching=false;}
  }
  const nameInRoot=(path:string)=>relative(root,path).split(sep).join('/');
  return {describe,describeBatch,closure:(entries:readonly InputEntry[],reportDirectory?:ModuleClosureOptions['directory'])=>describe(entries,reportDirectory??options.directory).files,
    sourceInputs:()=>{if(closed)throw Error('module graph is closed');return [...sourceInputs].map(([path,sha256])=>({path,sha256}));},
    membershipIndex:()=>{if(closed)throw Error('module graph is closed');return metadataIndex??=membershipIndex(sourceFiles());},close:()=>{
      if(batching)throw Error('module graph cannot close an active batch');
      if(closed)return;closed=true;
      closeModuleGraphOwners([projects&&{name:'project API',close:()=>projects!.close()},api&&{name:'parser API',close:()=>api!.close()}]);
    }};
}

/** A public walk always gets a fresh graph, including fresh source bytes. */
export function moduleClosure(entries: readonly InputEntry[], options: ModuleClosureOptions = {}): string[] {
  const graph = moduleGraph(options);
  try {return graph.closure(entries);} finally {graph.close();}
}
