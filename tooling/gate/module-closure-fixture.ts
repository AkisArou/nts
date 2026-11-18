// Test repositories carry the modules their entry points actually import.
// Package installations and non-module assets remain explicit fixture inputs.
import {copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync,writeFileSync} from "node:fs";
import {fixedMembersSource} from './fixed-members-fixture.ts';
import {dirname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createRequire} from "node:module";
import {moduleGraph,installedPackageReachMessage,InstalledPackageReachUnavailable,type ModuleClosureOptions,type InputSnapshot,type InstalledPackageReach} from "./module-closure.ts";
import {outsideSource} from "./source-containment.ts";
import {canonicalNamespace as canonical,fixtureNamespaces,fixtureInput,fileInput,type FixtureInput,type InputEntry} from './reader-inputs/main.ts';
import {durableRecord} from './durable-record.ts';
import {assertStateVersion} from './state-version.ts';
import {directoryEntries,memberType,metadataParents} from './reader-metadata.ts';
import {OracleFilesystem,validateHostObservations} from '../differential/oracle-filesystem.ts';
import type {HostObservation} from '../differential/oracle-runtime.ts';
import {projectInputOwner} from './project-inputs.ts';
import {SourceFacts} from './source-facts.ts';
import {validateReaderSourceObservations,replayFixtureReaderObservations} from './reader-observations.ts';
import {installationCatalogPublication,installationCatalogTrust} from '../inputs/dependency-inputs.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {gitArguments} from './git-arguments/main.ts';
export {moduleClosure} from "./module-closure.ts";

const SOURCE = fileURLToPath(new URL("../..", import.meta.url));
const info = (path: string) => {
  try {return lstatSync(path);}
  catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error;}
};

/** The shared checkout whose cache holds the default source's catalog. */
function sourceShared(source:string):string|null{
  if(source!==realpathSync(SOURCE)||!info(join(source,'.git')))return null;
  return dirname(infrastructureProbe({purpose:'fixture source installation owner',command:'git',
    args:gitArguments(['rev-parse','--path-format=absolute','--git-common-dir']),cwd:source}).stdout.trim());
}
/** This copier owns its default source's acquisition. Foreign sources supply
 * their own trust explicitly; a missing catalog never triggers installation. */
function sourceCatalog(source:string){
  const shared=sourceShared(source);
  return shared===null?null:installationCatalogTrust(shared,source);
}
/** A declared Program that reaches an installed package owes the catalog that
 * authenticates it. Refuse by that missing authority, with the remedy this
 * copier's source owns; closures with no installed reach need no catalog. */
export function refuseInstallationReach(rows:readonly Pick<InstalledPackageReach,'project'|'reader'|'package'|'reason'>[],source:string,supplied:boolean,cause?:unknown):void{
  const row=rows[0];if(!row)return;
  const shared=supplied?null:sourceShared(source);
  throw Error(installedPackageReachMessage(row)+'; '
    +(shared===null?'supply a current dependencyCatalog for source '+source:'publish it with '+installationCatalogPublication(shared,source)),cause===undefined?undefined:{cause});
}

export type FixtureClosureOptions = ModuleClosureOptions & {link?: boolean;
  /** These already-populated directories belong to this fixture, at the same
   * relative position as a production-declared data input. Values name owners,
   * never another source path or a list of module dependencies. */
  dataNamespaces?:Readonly<Record<string,string>>;
  /** A whole namespace mirror already links these exact source inputs. Reuse
   * them read-only; missing inputs still require owned, real parent folders. */
  reuseSourceLinks?:boolean};

export const FIXTURE_INPUT_MANIFEST='.nts-fixture-inputs.json';
type FixtureDataInput={directory:string;fixtureOwner:string;readers:string[]};
type FixtureInputManifest={version:1;data:FixtureDataInput[]};
const under=(directory:string,file:string)=>file===directory||file.startsWith(directory+'/');

/** A fixture has one synchronous staging owner. Each complete publication is
 * atomic; subsequent calls preserve earlier data ownership in that manifest. */
function readFixtureInputs(destination:string):FixtureInputManifest{
  const file=join(destination,FIXTURE_INPUT_MANIFEST),stat=info(file);if(!stat)return {version:1,data:[]};
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('fixture input manifest is not an owned file: '+file);
  const value:unknown=JSON.parse(readFileSync(file,'utf8'));assertStateVersion(value,1,file);
  if(!value||typeof value!=='object')throw Error('invalid fixture input manifest: '+file);
  const row=value as Record<string,unknown>;
  if(row.version!==1||!Array.isArray(row.data))throw Error('invalid fixture input manifest: '+file);
  const data:FixtureDataInput[]=[];
  for(const item of row.data as unknown[]){
    if(!item||typeof item!=='object')throw Error('invalid fixture input manifest: '+file);
    const entry=item as Record<string,unknown>;
    if(typeof entry.directory!=='string'||!canonical(entry.directory)||typeof entry.fixtureOwner!=='string'||!entry.fixtureOwner.trim()
      ||!Array.isArray(entry.readers)||entry.readers.some(reader=>typeof reader!=='string'||!canonical(reader)))throw Error('invalid fixture input manifest: '+file);
    data.push({directory:entry.directory,fixtureOwner:entry.fixtureOwner,readers:entry.readers as string[]});
  }
  return {version:1,data};
}

function fixtureData(snapshot:InputSnapshot,destination:string,source:string,options:Pick<FixtureClosureOptions,'dataNamespaces'|'link'|'reuseSourceLinks'>,fixtureEntries:Set<string>){
  const declared=new Map<string,Set<string>>();
  for(const row of snapshot.directories)if(row.kind==='data'){
    // An AST declaration can describe a child fixture's own destination. Only
    // this copier's entry grants may authorize private data in this destination.
    if(row.fixture&&!fixtureEntries.has(row.fixture.entry))continue;
    const readers=declared.get(row.directory)??new Set<string>();readers.add(row.reader);declared.set(row.directory,readers);
  }
  const owned=new Set(snapshot.ownedFiles),selected=new Map<string,string>();
  for(const [directory,owner]of Object.entries(options.dataNamespaces??{})){
    if(!canonical(directory)||!declared.has(directory))throw Error('fixture data namespace is not a declared data input: '+directory);
    if(typeof owner!=='string'||!owner.trim())throw Error('fixture data namespace has no fixture owner: '+directory);
    if(!info(join(destination,directory))?.isDirectory()||info(join(destination,directory))?.isSymbolicLink())throw Error('fixture data namespace is not an owned directory: '+directory);
    selected.set(directory,owner);
  }
  // Reject nested grants: their owner would otherwise depend on iteration order.
  const names=[...selected.keys()];
  for(const [index,name]of names.entries())for(const other of names.slice(index+1))if(under(name,other)||under(other,name))throw Error('overlapping fixture data namespaces: '+name+' and '+other);
  const manifest=readFixtureInputs(destination),entries=new Map(manifest.data.map(row=>[row.directory,row]));
  for(const previous of entries.keys())for(const directory of declared.keys()){
    if((under(previous,directory)||under(directory,previous))&&!selected.has(previous))throw Error('fixture data namespace already has an owner; repeat its explicit grant: '+previous);
  }
  const granted=(name:string)=>names.some(directory=>under(directory,name));
  const overlapsGrant=(name:string)=>names.some(directory=>under(directory,name)||under(name,directory));
  const sourceDirectory=(name:string,path:string)=>options.reuseSourceLinks&&!overlapsGrant(name)
    &&realpathSync(path)===join(source,name)&&info(join(source,name))?.isDirectory();
  function privateTree(directory:string):void{
    let parent=destination;
    for(const part of ['',...directory.split('/')]){
      parent=join(parent,part);const stat=info(parent);
      if(stat&&(!stat.isDirectory()||stat.isSymbolicLink())
        &&!(stat.isSymbolicLink()&&sourceDirectory(relative(destination,parent).split(sep).join('/'),parent)))throw Error('fixture data namespace has an unowned parent: '+directory);
    }
    const expected=new Set(snapshot.files.filter(file=>under(directory,file))),allowedDirectories=new Set<string>([directory]);
    for(const file of expected)for(let parent=dirname(file);under(directory,parent);parent=dirname(parent)){allowedDirectories.add(parent);if(parent===directory)break;}
    const walk=(name:string):void=>{
      const path=join(destination,name),stat=info(path);if(!stat)return;
      // Module links always retain their production identity. Unsubstituted
      // data may reuse that exact identity only through the explicit linking
      // options; a private data grant still owns real paths, never data links.
      const linkedDirectory=stat.isSymbolicLink()&&sourceDirectory(name,path);
      if(stat.isSymbolicLink()&&!linkedDirectory){
        if((owned.has(name)||!granted(name)&&(options.link||options.reuseSourceLinks))
          &&realpathSync(path)===join(source,name)&&info(join(source,name))?.isFile()){
          if(!expected.has(name))throw Error('fixture data input needs an explicit namespace grant: '+name);
          return;
        }
        throw Error('fixture data namespace contains an unowned path: '+name);
      }
      const isDirectory=stat.isDirectory()||linkedDirectory;
      if(!stat.isFile()&&!isDirectory)throw Error('fixture data namespace contains an unowned path: '+name);
      if(!granted(name)&&!(isDirectory?allowedDirectories:expected).has(name))throw Error('fixture data input needs an explicit namespace grant: '+name);
      if(isDirectory){for(const entry of readdirSync(path))walk(name+'/'+entry);return;}
      if(owned.has(name)&&!readFileSync(path).equals(readFileSync(join(source,name))))throw Error('fixture data namespace cannot replace module-owned input: '+name);
    };walk(directory);
  }
  for(const directory of declared.keys())privateTree(directory);
  for(const [directory,fixtureOwner]of selected){
    for(const previous of entries.keys())if(previous!==directory&&(under(previous,directory)||under(directory,previous)))throw Error('overlapping fixture data namespaces: '+previous+' and '+directory);
    const before=entries.get(directory);
    if(before&&before.fixtureOwner!==fixtureOwner)throw Error('fixture data namespace already has another owner: '+directory);
    const readers=[...declared].filter(([name])=>under(directory,name)||under(name,directory)).flatMap(([,readers])=>[...readers]);
    entries.set(directory,{directory,fixtureOwner,readers:[...new Set([...(before?.readers??[]),...readers])].sort()});
  }
  return {files:snapshot.files.filter(file=>owned.has(file)||!names.some(directory=>under(directory,file))),manifest:{version:1,data:[...entries.values()].sort((a,b)=>a.directory.localeCompare(b.directory))} satisfies FixtureInputManifest,publish:selected.size>0};
}

/** Metadata never creates a child or copies its bytes. Verify after genuine
 * input staging; nested fixture declarations belong to their own destination. */
function fixtureMetadata(snapshot:InputSnapshot,destination:string,grants:Readonly<Record<string,string>>,fixtureEntries:Set<string>,hasDataManifest:boolean):void{
  const here=(entry:string)=>entry==='<entry>'||fixtureEntries.has(entry);
  for(const row of snapshot.optionalFiles){
    if(!here(row.context.entry))continue;
    metadataParents(destination,join(destination,row.path),'fixture optional file');
    const stat=info(join(destination,row.path));
    if(!row.present){if(stat)throw Error('fixture optional file must remain absent: '+row.path);continue;}
    if(!stat||memberType(stat,join(destination,row.path))!=='file')throw Error('fixture optional file is not a regular file: '+row.path);
  }
  for(const row of snapshot.memberships){
    if(!here(row.context.entry))continue;
    if(row.directory!=='')metadataParents(destination,join(destination,row.directory),'fixture membership');
    const directory=join(destination,row.directory),stat=info(directory);
    if(!stat||memberType(stat,directory)!=='directory')throw Error('fixture membership is not an owned directory: '+row.directory);
    // The data owner already checked its real private tree and immutable
    // module overlap. Membership supplies no independent grant.
    if(Object.keys(grants).some(name=>under(name,row.directory)))continue;
    const actual=directoryEntries(directory);
    // This exact file is an explicitly owned copier capability, rather than
    // an unknown child hidden by a tracked-only projection.
    const entries=row.directory===''&&hasDataManifest?actual.filter(entry=>entry.name!==FIXTURE_INPUT_MANIFEST):actual;
    const expected=new Map(row.entries.map(entry=>[entry.name,entry.type]));
    for(const entry of entries){
      const type=expected.get(entry.name);
      if(type===undefined)throw Error('fixture membership has an unowned child: '+join(row.directory,entry.name));
      if(type!==entry.type)throw Error('fixture membership child type differs: '+join(row.directory,entry.name)+' ('+entry.type+'; expected '+type+')');
      expected.delete(entry.name);
    }
    if(expected.size)throw Error('fixture membership is missing a child: '+join(row.directory,expected.keys().next().value!));
  }
}

/** Selection retains inspection facts; a private reproduction stages only
 * its modules, declared data and reproductive observations. A second role
 * promotes a shared path in the graph, before this projection is taken. */
export function fixtureStagingSnapshot(snapshot:InputSnapshot):InputSnapshot{
  const staged=new Set(snapshot.stagingFiles);
  return {...snapshot,files:[...snapshot.stagingFiles],...(snapshot.runtimeFiles?{runtimeFiles:snapshot.runtimeFiles.filter(file=>staged.has(file))}:{}),ownedFiles:snapshot.ownedFiles.filter(file=>staged.has(file)),
    optionalFiles:snapshot.optionalFiles.filter(row=>!row.inspectionOnly)};
}

/** Complete the graph before callers apply private mutations. Existing equal
 * modules are harmless; a different fixture file is never overwritten. */
export function copyModuleClosure(entries: readonly InputEntry[], root: string, options: FixtureClosureOptions = {}): string[] {
  const source = realpathSync(options.sourceRoot ?? SOURCE);
  const destination = outsideSource(source, root, "fixture destination");
  const grants:Record<string,string>={...options.dataNamespaces},fixtureEntries=new Set<string>();
  for(const entry of entries)if(typeof entry!=='string'&&entry.kind==='fixture'){
    fixtureEntries.add(relative(source,fileURLToPath(entry.url)).split(sep).join('/'));
    for(const [name,owner]of Object.entries(entry.dataNamespaces)){
      if(Object.hasOwn(grants,name)&&grants[name]!==owner)throw Error('fixture data namespace already has another owner: '+name);
      Object.defineProperty(grants,name,{value:owner,enumerable:true,configurable:true,writable:true});
    }
  }
  const dataNamespaces=fixtureNamespaces(grants);
  const dependencyCatalog=options.dependencyCatalog===undefined?sourceCatalog(source):options.dependencyCatalog;
  const graph = moduleGraph({...options, sourceRoot: source,dependencyCatalog,unavailableInputs:'refuse'});
  let snapshot:InputSnapshot;
  try {
    snapshot=graph.describe(entries);
    if(!options.link&&!options.reuseSourceLinks&&(
      snapshot.stagingFiles.includes('tooling/gate/run.mjs')&&snapshot.stagingFiles.includes('tooling/gate/scopes/step-scope.ts')
      ||snapshot.stagingFiles.includes('tooling/gate/tooling-test-worker.ts'))){
      // The private declaration is an executable fixture entry. Its own
      // imports, rather than a second list of dependencies, supply its closure.
      snapshot=graph.describe([...entries,'tooling/gate/test-cgroup-members.ts']);
    }
  }
  catch(error){
    if(error instanceof InstalledPackageReachUnavailable)refuseInstallationReach(error.rows,source,options.dependencyCatalog!==undefined,error);
    throw Error('fixture closure '+JSON.stringify(entries)+' from '+source+': '+String(error),{cause:error});
  }
  finally {graph.close();}
  validateReaderSourceObservations(snapshot,source);
  const staged=fixtureStagingSnapshot(snapshot);
  const data=fixtureData(staged,destination,source,{...options,dataNamespaces},fixtureEntries),files=data.files;
  // A copied real runner creates its fixture's scopes after the packet was
  // built. The copy owner stages those logical declarations once, including
  // indirect runner copies. Borrowed source links always retain source bytes.
  const fixedMembers=!options.link&&!options.reuseSourceLinks&&(
    files.includes('tooling/gate/run.mjs')&&files.includes('tooling/gate/scopes/step-scope.ts')
    ||files.includes('tooling/gate/tooling-test-worker.ts'));
  const inputs=files.map(name=>{
    const from=resolve(source,name),to=resolve(destination,name);
    if (to === from) throw new Error("fixture destination is the source: " + name);
    if(!lstatSync(from).isFile()||!realpathSync(from).startsWith(source+sep))throw Error('fixture input is not an owned source file: '+name);
    return {name,from,to};
  });
  for(const {name,from,to}of inputs){
    if(options.reuseSourceLinks&&info(to)&&realpathSync(to)===from)continue;
    const content=fixedMembers&&(name==='tooling/gate/scopes/step-scope.ts'||name==='tooling/gate/test-host-bootstrap.ts')
      ?Buffer.from(fixedMembersSource(name,readFileSync(from,'utf8'))):undefined;
    let parent = destination;
    for (const part of ["", ...relative(destination, dirname(to)).split(sep).filter(Boolean)]) {
      parent = join(parent, part);
      if (!info(parent)) mkdirSync(parent, {recursive: true});
      const stat = lstatSync(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("fixture module parent is not a directory: " + parent);
    }
    const existing = info(to);
    if (existing) {
      if (options.link ? existing.isSymbolicLink() && realpathSync(to) === from : existing.isFile() && readFileSync(to).equals(content??readFileSync(from))) continue;
      throw new Error("fixture module already has different input: " + name);
    }
    if (options.link) symlinkSync(from, to);
    else if(content)writeFileSync(to,content);
    else copyFileSync(from, to);
  }
  fixtureMetadata(staged,destination,dataNamespaces,fixtureEntries,data.publish||data.manifest.data.length>0);
  if(data.publish)durableRecord(join(destination,FIXTURE_INPUT_MANIFEST),data.manifest);
  replayFixtureReaderObservations(staged,source,destination,fixtureEntries,!!(options.link||options.reuseSourceLinks));
  return files;
}


/** Stage a fixture's explicit-root project recipe unchanged. The runtime
 * emitter still observes and checks that project. Its local type source
 * edges are staged separately from runtime assets; installed packages stay
 * with the sealed dependency image. This does not infer compiler options. Roots must be plain JSON;
 * the pinned SDK decodes captured JSONC ancestors without a Program or a
 * second filesystem acquisition. */
export function copyFixtureProject(project:FixtureInput,root:string,options:FixtureClosureOptions&{entries?:readonly InputEntry[];oracleEntries?:readonly string[]}={}):string[]{
  const source=realpathSync(options.sourceRoot??SOURCE),destination=outsideSource(source,root,'fixture destination');
  const captured=new Map<string,Buffer>();
  const bytes=(path:string):Buffer=>{
    const prior=captured.get(path);if(prior)return prior;
    metadataParents(source,path,'fixture project config');
    const stat=lstatSync(path);
    if(!stat.isFile()||stat.isSymbolicLink()||realpathSync(path)!==path)throw Error('fixture project config is not an owned source file: '+path);
    const value=readFileSync(path);captured.set(path,value);return value;
  };
  const configPath=resolve(fileURLToPath(project.url)),body=bytes(configPath);
  let config:unknown;
  try{config=JSON.parse(body.toString('utf8'));}catch(error){throw Error('fixture project config must be plain JSON: '+configPath,{cause:error});}
  if(!config||typeof config!=='object')throw Error('fixture project requires explicit files and an empty include: '+project.url.href);
  const row=config as {files?:unknown;include?:unknown;references?:unknown};
  if(!Array.isArray(row.files)||!row.files.every((file):file is string=>typeof file==='string'&&file.length>0)||!Array.isArray(row.include)||row.include.length||row.references!==undefined&&(!Array.isArray(row.references)||row.references.length))
    throw Error('fixture project requires explicit files and an empty include: '+project.url.href);
  let api:import('typescript/sync').API|undefined;
  const decoded=(path:string):unknown=>{
    if(!api){
      const require=createRequire(import.meta.url),{API}=require('typescript/sync') as typeof import('typescript/sync'),{serverFS}=require('typescript/fs') as typeof import('typescript/fs');
      api=new API({cwd:source,useCaseSensitiveFileNames:true,fs:{
        readFile:path=>{const value=captured.get(resolve(path));if(!value)throw Error('fixture project decoder requested uncaptured bytes: '+path);return value.toString('utf8');},
        directoryExists:serverFS.error,fileExists:serverFS.error,getAccessibleEntries:serverFS.error,realpath:serverFS.error,stat:serverFS.error,writeFile:serverFS.error,removeFile:serverFS.error,
      }});
    }
    const result=api.readConfigFile(path);if(result.error)throw Error('fixture project extended config is invalid: '+path+': '+result.error.text);
    return result.config;
  };
  const visiting=new Set<string>(),complete=new Set<string>();
  const parents=(path:string,value:unknown):void=>{
    if(visiting.has(path))throw Error('fixture project extends cycle: '+path);
    if(complete.has(path))return;
    visiting.add(path);
    if(!value||typeof value!=='object')throw Error('fixture project config is not an object: '+path);
    const extended=(value as {extends?:unknown}).extends;
    const refs=extended===undefined?[]:Array.isArray(extended)?extended:[extended];
    for(const ref of refs){
      if(typeof ref!=='string'||!/^\.\.?[\/]/.test(ref)||!ref.endsWith('.json'))throw Error('fixture project cannot stage extends '+JSON.stringify(ref)+' in '+path+'; use an explicit relative .json config');
      const parent=resolve(dirname(path),ref);
      try{bytes(parent);}catch(error){throw Error('fixture project cannot stage extends '+ref+' in '+path+': '+String(error),{cause:error});}
      parents(parent,decoded(parent));
    }
    visiting.delete(path);complete.add(path);
  };
  const originalFacts:HostObservation[][]=[],oracleFiles=new Set<string>(),discovery=new OracleFilesystem();
  let projects:ReturnType<typeof projectInputOwner>|undefined;
  try{
    parents(configPath,config);
    const entered=new Set<string>(),owners=new Set<string>();
    const runtime=(name:string):void=>{
      const path=resolve(source,name);
      if(name.split('/').includes('node_modules'))throw Error('fixture oracle entry is not a local source: '+name);
      if(entered.has(path))return;entered.add(path);
      const content=bytes(path),owner=discovery.projectFor(path);
      if(!owner)throw Error('fixture oracle source has no original project: '+name);
      if(!owners.has(owner)){
        owners.add(owner);bytes(owner);parents(owner,decoded(owner));
        projects??=projectInputOwner(source,undefined,options.generatedTemporaryParent,options.dependencyCatalog===undefined?sourceCatalog(source):options.dependencyCatalog);
        const ownerConfig=relative(source,owner).split(sep).join('/'),inputs=projects.read([{kind:'config',path:ownerConfig}]);
        if(inputs.installationReach)refuseInstallationReach(inputs.installationReach.packages.map(reach=>({project:ownerConfig,reader:'fixture oracle entry '+name,package:reach.package,reason:inputs.installationReach!.reason})),source,options.dependencyCatalog!==undefined);
        for(const config of inputs.configs){const file=resolve(source,config);bytes(file);parents(file,decoded(file));}
        for(const {path:file}of inputs.modules){
          if(file.split('/').includes('node_modules'))throw Error('fixture oracle Program has an unowned installed source: '+file);
          oracleFiles.add(file);
        }
        originalFacts.push([...inputs.observations,...inputs.pinObservations,...inputs.installedObservations.map(row=>row.observation),
          ...inputs.dependencyObservations.map(row=>row.observation),...inputs.hostObservations.map(row=>row.observation),...inputs.generatedObservations.map(row=>row.observation)]);
      }
      // This decoder uses captured source bytes; only the emitter's runtime
      // import edges choose additional owners, never URL assets or type edges.
      const lease=api!.createSourceFile(path,content.toString('utf8'));
      let imports:string[];try{imports=new SourceFacts(name,content.toString('utf8'),lease.sourceFile).hostModuleImports();}finally{lease.dispose();}
      for(const specifier of imports)runtime(relative(source,fileURLToPath(new URL(specifier,pathToFileURL(path)))).split(sep).join('/'));
    };
    for(const entry of options.oracleEntries??[])runtime(entry);
  }finally{try{projects?.close();}finally{api?.close();}}
  const validateSources=()=>{validateHostObservations(discovery.captured());for(const facts of originalFacts)validateHostObservations(facts);};
  validateSources();
  const entries=row.files.map(file=>relative(source,resolve(dirname(configPath),file)).split(sep).join('/'));
  const configs=[...complete].map(path=>path===configPath?project:fixtureInput(pathToFileURL(path),{dataNamespaces:{}}));
  const staged=copyModuleClosure([...configs,...entries,...[...oracleFiles].map(name=>({kind:'file' as const,url:fileInput(pathToFileURL(resolve(source,name)))})),...options.entries??[]],destination,{...options,sourceRoot:source,localTypeEntries:[...entries,...options.localTypeEntries??[]]});
  for(const [path,expected]of captured){
    const placed=join(destination,relative(source,path));metadataParents(destination,placed,'staged fixture project config');
    const stat=lstatSync(placed);
    if(!stat.isFile()||stat.isSymbolicLink()||!readFileSync(placed).equals(expected))throw Error('fixture project config changed during staging: '+path);
  }
  validateSources();
  return staged;
}
