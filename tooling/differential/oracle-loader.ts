// The parent validates original inputs at preparation and finalization.
// A child consumes only hash-bound runtime metadata and the bytes it loads.
import {registerHooks,isBuiltin,createRequire} from 'node:module';
import {isMainThread,workerData} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {appendFileSync,openSync,closeSync,readSync,fstatSync,constants,existsSync,readFileSync,realpathSync,readlinkSync,lstatSync,linkSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {basename,dirname,join,resolve,relative,isAbsolute,sep,parse} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runtimeAssets} from './runtime-paths/main.ts';
import {ORACLE_EXECUTION_FILES} from './oracle-runtime.ts';
import {observeOracleAssets} from './oracle-assets.ts';
import {dependencySealReady,dependencySealError,checkerImportIdentity,validateRuntimeObservations as validateHostObservations,parseOracleLoaderEvents,checkNodeResolutionSession,nodeResolutionOptions,OracleResolutionDomain,OraclePathPrefixes,ORACLE_NODE_RESOLUTION_RECIPE,oracleFileUrlErrorProof,capturedModuleIdentity,readOracleSnapshotIndex,V8_HEAP_FLAG,type CheckerImportRelation,type HostObservation} from './oracle-runtime.ts';
import type {OracleSnapshotIdentity,OracleRuntimeNode,OracleRuntimeDescriptor,OracleRuntimeRoute,OwnerImportRoute} from './oracle-emit.ts';

let originalPath:(file:string)=>string=()=>{throw Error('oracle loader has not completed bootstrap');};
let moduleSource:(url:string)=>string|null=()=>null;
let capturedFile:(source:string)=>string|null=()=>null;
export const oracleModuleSource=(url:string)=>moduleSource(url);
export const oracleCapturedFile=(source:string)=>capturedFile(source);
type WorkerLaunch=Readonly<{context:Readonly<Record<string,string|undefined>>;args:string[];failed:(error:unknown)=>void;ended:(error?:unknown)=>void}>;
type HarnessCapability=Readonly<{commonJS:(file:string,parent?:string)=>string;child:(file:string,parent:string)=>Readonly<Record<string,string|undefined>>;worker:(file:string|null,parent:string,args:unknown,kind:'file'|'eval')=>WorkerLaunch}>;
let takeHarnessCapability:()=>HarnessCapability=()=>{throw Error('oracle loader has not completed bootstrap');};
export const oracleHarnessCapability=()=>takeHarnessCapability();
export const oracleOriginalPath=(file:string)=>originalPath(file);
const workerContext=!isMainThread&&workerData?.role==='nts-commonjs-worker'?workerData.oracle:undefined;
const ownedEnvironment:NodeJS.ProcessEnv=workerContext?Object.freeze({...workerContext}):process.env;
const canonicalContext=ownedEnvironment.NTS_GATE_ENV_CONTEXT;
const path=ownedEnvironment.NTS_ORACLE_EMIT_MANIFEST;
if(!path)throw Error('oracle emit manifest is missing');
const state=ownedEnvironment.NTS_ORACLE_EMIT_STATUS,dependencyCapability=ownedEnvironment.NTS_ORACLE_DEPENDENCIES,snapshotCapability=ownedEnvironment.NTS_ORACLE_SNAPSHOT;
const expected=join(dirname(path),'loader-state.json'),states=join(dirname(path),'states')+sep;
if(!state||(state!==expected&&(!state.startsWith(states)||relative(dirname(path),state).split(sep).includes('..'))))throw Error('oracle loader status capability is missing or invalid');
let eventDescriptor:number|undefined;
const capturedAppend=appendFileSync;
const appendEvent=(event:unknown)=>capturedAppend(eventDescriptor??state,JSON.stringify(event)+'\n');
function instrument(error:unknown):never{appendEvent({version:1,status:'instrument',reason:error instanceof Error?error.message:String(error)});throw error;}
// readFileSync(path) calls the public fs.openSync again. Retain the native
// descriptor operations before installing observation, so a proof read cannot
// recurse through its own asset guard or a program's replacement fs method.
const capturedOpen=openSync,capturedRead=readSync,capturedClose=closeSync,capturedStat=fstatSync;
const runtimeIO={read:(file:string)=>{
  const descriptor=capturedOpen(file,'r');
  try{
    const chunks:Buffer[]=[];let total=0;
    for(;;){const buffer=Buffer.allocUnsafe(65536),count=capturedRead(descriptor,buffer,0,buffer.length,null);if(!count)break;chunks.push(buffer.subarray(0,count));total+=count;}
    return Buffer.concat(chunks,total);
  }finally{capturedClose(descriptor);}
},kind:lstatSync,link:readlinkSync};
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
try{
eventDescriptor=openSync(state,constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
const eventFile=fstatSync(eventDescriptor),eventPath=lstatSync(state);
if(!eventFile.isFile()||eventFile.dev!==eventPath.dev||eventFile.ino!==eventPath.ino||eventFile.uid!==eventPath.uid)throw Error('oracle event stream owner changed');
const snapshot:OracleSnapshotIdentity=JSON.parse(snapshotCapability??'null');
if(!snapshot||snapshot.version!==1||!/^[a-f0-9]{64}$/.test(snapshot.manifestSha256))throw Error('oracle snapshot runtime identity is missing');
const storedIndex=readOracleSnapshotIndex(dirname(path),snapshot.index);
const index={get:(key:string):unknown=>{try{return storedIndex.get(key);}catch(error){return instrument(error);}}};
const descriptor=index.get('descriptor') as OracleRuntimeDescriptor;
if(descriptor?.version!==1||!Array.isArray(descriptor.trees))throw Error('oracle snapshot descriptor changed');
const manifestSha256=snapshot.manifestSha256;
const snapshotOwner=JSON.parse(readFileSync(join(dirname(state),'snapshot-owner.json'),'utf8'));
if(!snapshotOwner||Object.keys(snapshotOwner).sort().join(',')!=='indexSha256,manifestSha256,version'||snapshotOwner.version!==1||snapshotOwner.manifestSha256!==manifestSha256||snapshotOwner.indexSha256!==snapshot.index.sha256)throw Error('oracle snapshot parent identity changed');
const route=(file:string)=>{if(isAbsolute(file))return instrument(Error('oracle manifest route is absolute'));const result=resolve(dirname(path),file),part=relative(dirname(path),result);if(part==='..'||part.startsWith('..'+sep))return instrument(Error('oracle manifest route escapes its session'));return result;};
const assets=dirname(fileURLToPath(import.meta.url)),records=JSON.parse(readFileSync(join(assets,'oracle-toolchain.json'),'utf8'));
const expected=records.platforms[process.platform+'-'+process.arch],identity=descriptor.identity;
if(!identity||identity.version!==1||identity.options!==records.execution.options||!expected||
   (['version','rootPackageSha256','packageSha256','nativeSha256','nativePackageSha256'] as const).some(key=>identity.typescript?.[key]!==expected[key])||
   identity.resolutionSha256!==hash(readFileSync(join(assets,'oracle-resolution.ts')))||
   identity.runtimeSha256!==hash(readFileSync(join(assets,'oracle-runtime.ts')))||
   identity.assetsSha256!==hash(readFileSync(join(assets,'oracle-assets.ts')))||identity.filesystemSha256!==hash(readFileSync(join(assets,'oracle-filesystem.ts')))||
   identity.emitterSha256!==hash(readFileSync(join(assets,'oracle-emit.ts')))||identity.loaderSha256!==hash(readFileSync(join(assets,'oracle-loader.ts')))||
   identity.publisherSha256!==hash(readFileSync(join(assets,'oracle-result-publisher.ts')))||
   identity.runtimeModulesSha256!==hash(readFileSync(join(assets,'oracle-runtime-modules.ts')))||
   identity.childBootstrapSha256!==hash(readFileSync(join(assets,'oracle-child-bootstrap.ts')))||
   identity.toolchainRecordSha256!==hash(readFileSync(join(assets,'oracle-toolchain.json'))))throw Error('oracle TypeScript emit identity mismatch or incomplete preparation');
if(hash(Buffer.from(JSON.stringify(ORACLE_EXECUTION_FILES.map(name=>hash(readFileSync(join(assets,name)))))))!==identity.executionSha256)throw Error('oracle execution source identity changed');
const bootstrapFiles=new Map([[join(assets,'oracle-loader.ts'),identity.loaderSha256],[join(assets,'oracle-filesystem.ts'),identity.filesystemSha256],[join(assets,'oracle-runtime.ts'),identity.runtimeSha256],[join(assets,'oracle-assets.ts'),identity.assetsSha256]]);
if(!runtimeAssets(snapshot.assets&&Object.fromEntries(Object.entries(snapshot.assets).map(([name,sha])=>[name.startsWith('assets/')?name.slice(7):'',sha])),['oracle-loader.mjs']))throw Error('oracle generated bootstrap record is invalid');
for(const name of ORACLE_EXECUTION_FILES)bootstrapFiles.set(join(assets,name),hash(readFileSync(join(assets,name))));
if(Object.keys(descriptor.runtimeAssets??{}).length!==Object.keys(snapshot.assets??{}).length||Object.entries(descriptor.runtimeAssets??{}).some(([file,sha256])=>snapshot.assets?.[file]!==sha256))throw Error('oracle generated bootstrap identity changed');
for(const [file,sha256] of Object.entries(descriptor.runtimeAssets??{})){
  if(!file.startsWith('assets/')||!/^[a-f0-9]{64}$/.test(sha256))throw Error('oracle generated bootstrap record is invalid');
  bootstrapFiles.set(route(file),sha256);
}
const bootstrap=(value:URL|string)=>{const url=typeof value==='string'?new URL(value):value;if(url.protocol!=='file:'||url.search||url.hash)return undefined;const file=fileURLToPath(url),expected=bootstrapFiles.get(file);if(!expected)return undefined;if(hash(readFileSync(file))!==expected)return instrument(Error('oracle bootstrap asset changed: '+file));const compiled=file.replace(/\.(?:m?ts|m?js)$/, '.mjs');return pathToFileURL(bootstrapFiles.has(compiled)?compiled:file).href;};
const bootstrapURLs=records.execution.args.filter((argument:string,index:number,args:string[])=>index>0&&args[index-1]==='--import'&&argument.startsWith('data:')) as string[];
if(bootstrapURLs.length!==1)throw Error('oracle pinned bootstrap identity is ambiguous');
const bootstrapURL=bootstrapURLs[0]!;
const declaredPreloads=(descriptor.preloads??[]).flatMap(source=>[source,pathToFileURL(source).href]);
if(descriptor.resolution)checkNodeResolutionSession(descriptor.resolution,nodeResolutionOptions(process.execArgv,process.env,bootstrapURL,declaredPreloads));
let liveResolutions=0;
process.once('exit',()=>{try{appendFileSync(state+'.resolutions.jsonl',JSON.stringify({version:1,pid:process.pid,live:liveResolutions})+'\n');}catch{/* Report-only counters never decide an oracle verdict. */}});
const requireExtensions=createRequire(import.meta.url).extensions,defaultExtensions=['.js','.json','.node'];
if(![26].includes(Number(process.versions.node.split('.')[0]))||JSON.stringify(Object.keys(requireExtensions))!==JSON.stringify(defaultExtensions))throw Error('oracle Node resolution recipe is unsupported');
let executionDriver:{path:string;sha256:string}|undefined,eventIdentity:ReturnType<typeof lstatSync>|undefined;
const moduleInputs=join(dirname(state),'module-inputs.json');
if(existsSync(moduleInputs)){
  const record=JSON.parse(readFileSync(moduleInputs,'utf8'));
  if(!record||record.version!==1||Object.keys(record).length!==3||record.manifestSha256!==manifestSha256||!record.driver||Object.keys(record.driver).length!==2||
     typeof record.driver.path!=='string'||!isAbsolute(record.driver.path)||realpathSync.native(record.driver.path)!==record.driver.path||typeof record.driver.sha256!=='string'||!/^[a-f0-9]{64}$/.test(record.driver.sha256))throw Error('oracle execution module input identity mismatch');
  executionDriver=record.driver;if(hash(readFileSync(executionDriver!.path))!==executionDriver!.sha256)throw Error('oracle execution driver changed: '+executionDriver!.path);
}
let delegatedWorker=false;
const eventOwner=join(dirname(state),'event-owner.json');
if(existsSync(eventOwner)){
  const record=JSON.parse(readFileSync(eventOwner,'utf8'));
  const worker=record?.driverRole==='commonjs-worker';
  if(!record||record.version!==1||Object.keys(record).sort().join(',')!==(worker?'driverRole,events,manifestSha256,parentDriver,scopes,version':'events,manifestSha256,scopes,version')||record.manifestSha256!==manifestSha256||typeof record.events?.path!=='string'||!record.events.path.startsWith(states)||resolve(record.events.path)!==record.events.path||record.events.path===state)throw Error('oracle child event owner is invalid');
  const parentInputs=JSON.parse(readFileSync(join(dirname(record.events.path),'module-inputs.json'),'utf8'));
  const parentDriver=worker?record.parentDriver:executionDriver;
  if(!executionDriver||parentInputs.manifestSha256!==manifestSha256||JSON.stringify(parentInputs.driver)!==JSON.stringify(parentDriver))throw Error('oracle child event owner has a different driver');
  if(worker){
    const role=descriptor.drivers?.commonjsWorker,parentFact=parentDriver&&index.get('path\0'+parentDriver.path) as OracleRuntimeNode|undefined;
    if(!workerContext||!role||role.source!==join(dirname(descriptor.entry),'run-cjs-worker.mjs')||executionDriver.path!==role.path||executionDriver.sha256!==role.sha256||!parentFact||parentFact.sha256!==parentDriver.sha256||parentFact.asset!==descriptor.entry&&parentFact.asset!==role.source)throw Error('oracle worker driver has no exact parent role');
    delegatedWorker=true;
  }
  for(const [file,parent,owner] of [[state,record.events.path,record.events],[state+'.scope.jsonl',record.events.path+'.scope.jsonl',record.scopes]] as const){
    const actual=lstatSync(file),original=lstatSync(parent);if(!owner||!actual.isFile()||!original.isFile()||actual.dev!==owner.dev||actual.ino!==owner.ino||actual.uid!==owner.uid||original.dev!==actual.dev||original.ino!==actual.ino||original.uid!==actual.uid)throw Error('oracle child event stream owner changed');
  }
  appendEvent({version:1,status:'child-begin',execution:basename(dirname(state))});
}
if(!isMainThread&&!delegatedWorker)throw Error('oracle Worker context was not prepared');
const nodeCache=new Map<string,OracleRuntimeNode|undefined>();
const runtimeNode=(file:string):OracleRuntimeNode|undefined=>{
  if(nodeCache.has(file))return nodeCache.get(file);
  const value=index.get('path\0'+file) as OracleRuntimeNode|undefined;
  if(value!==undefined&&(!value||!['file','directory','symlink',null].includes(value.kind)||value.sha256!==undefined&&!/^[a-f0-9]{64}$/.test(value.sha256)||value.kind==='symlink'&&typeof value.link!=='string'))return instrument(Error('oracle snapshot runtime fact is invalid: '+file));
  nodeCache.set(file,value);return value;
};
const runtimeKinds={get:(file:string)=>runtimeNode(file)?.kind},runtimeHashes={get:(file:string)=>runtimeNode(file)?.sha256},runtimeLinks={get:(file:string)=>runtimeNode(file)?.link};
const linkTarget=(file:string)=>{const fact=runtimeNode(file);return fact?.kind==='symlink'?resolve(dirname(file),fact.link!):undefined;};
const runtimeIdentity=capturedModuleIdentity(linkTarget);
const trees=new Map(descriptor.trees.map(tree=>{
  if(!tree||!isAbsolute(tree.root)||!tree.root.startsWith(join(dirname(path),'tree')+sep)||![tree.aliases,tree.roots,tree.excluded].every(Array.isArray))throw Error('oracle snapshot tree has no owner');
  const aliases=tree.aliases.filter(alias=>alias.target.startsWith(tree.root+sep)).map(alias=>({path:resolve(parse(descriptor.entry).root,relative(tree.root,alias.path)),target:resolve(parse(descriptor.entry).root,relative(tree.root,alias.target))}));
  return [tree.root,{...tree,identity:capturedModuleIdentity(aliases)}] as const;
}));
const treeFor=(file:string)=>[...trees.values()].find(tree=>file.startsWith(tree.root+sep));
const dependencyRoot=descriptor.dependencies?.root,dependencySource=descriptor.dependencies?.source;
if(typeof descriptor.captureSha256!=='string'||descriptor.captureSha256!==hash(Buffer.from(dependencyCapability??'')))throw Error('oracle dependency snapshot identity mismatch');
if(descriptor.dependencies){
  const cap=JSON.parse(dependencyCapability??'null'),dependency=descriptor.dependencies;
  if(!cap||cap.version!==1||dependency.nodeVersion!==process.versions.node||dependency.source!==cap.source||dependency.sourceRevision!==cap.sourceRevision||dependency.root!==join(cap.directory,'node-'+process.versions.node,'tree')||identity.dependencyRecipeSha256!==hash(Buffer.from(JSON.stringify([cap.lockfileSha256,cap.producerSha256]))))throw Error('oracle dependency snapshot identity mismatch');
  const sealed=dependencySealReady(cap,ownedEnvironment);
  if(sealed&&dependency.semanticSha256!==cap.seal.semanticSha256)throw dependencySealError(sealed);
}
const dependencyFiles={get:(file:string)=>dependencyRoot&&file.startsWith(dependencyRoot+sep)?runtimeHashes.get(file):undefined,has:(file:string)=>!!(dependencyRoot&&file.startsWith(dependencyRoot+sep)&&runtimeHashes.get(file))};
type Captured=Omit<OracleRuntimeRoute,'group'|'output'|'execution'>&{group:{project:string;output:string};output:string;execution:string};
const ownerCache=new Map<string,{project:string;output:string}>(),sourceCache=new Map<string,Captured[]|undefined>();
const owner=(key:string)=>{let value=ownerCache.get(key);if(value)return value;const record=index.get('owner\0'+key) as {project:string;configSha256:string;output:string}|undefined;if(!record||record.output!==key||!isAbsolute(record.project)||!/^[a-f0-9]{64}$/.test(record.configSha256))return instrument(Error('oracle snapshot owner is invalid'));value={project:record.project,output:route(record.output)};ownerCache.set(key,value);return value;};
const assetRecord=(source:string)=>{
  const value=index.get('asset\0'+source) as {path:string;sha256:string}|undefined;
  if(value&&(!treeFor(value.path)||runtimeHashes.get(value.path)!==value.sha256))return instrument(Error('oracle snapshot asset has no byte owner: '+source));
  return value;
};
const getSources=(source:string):Captured[]|undefined=>{
  if(sourceCache.has(source))return sourceCache.get(source);
  const values=index.get('source\0'+source) as OracleRuntimeRoute[]|undefined;
  if(values!==undefined&&!Array.isArray(values))return instrument(Error('oracle snapshot source routes are invalid'));
  const result=values?.map(value=>{
    const project=owner(value.group),output=route(value.output),execution=route(value.execution);
    if(value.source!==source||project.project!==value.project||!output.startsWith(project.output+sep)||!treeFor(execution)||index.get('input\0'+source)!==value.sourceSha256||runtimeNode(output)?.compiled?.source!==source||runtimeNode(execution)?.compiled?.source!==source||runtimeHashes.get(output)!==runtimeHashes.get(execution)||!runtimeHashes.get(output))return instrument(Error('oracle snapshot source route has no exact owner: '+source));
    return {...value,group:project,output,execution};
  });sourceCache.set(source,result);return result;
};
const sources={get:getSources,has:(source:string)=>getSources(source)!==undefined};
const compiled=(file:string)=>{
  const value=runtimeNode(file)?.compiled;if(!value)return;
  const selected=getSources(value.source)?.find(route=>route.output===file||route.execution===file);
  if(!selected)return instrument(Error('oracle snapshot output source identity mismatch: '+file));
  return selected;
};
const executions={get:(file:string)=>{const value=compiled(file);return value?.execution===file?value:undefined;},has:(file:string)=>!!compiled(file)&&compiled(file)!.execution===file};
const outputOwners={get:compiled,has:(file:string)=>!!compiled(file)};
const publishedExecution=(source:string)=>{const values=getSources(source);if(!values?.length)return instrument(Error('oracle source was not published: '+source));return values[0]!.execution;};
const assetsBySource={get:(source:string)=>assetRecord(source)?.path,has:(source:string)=>!!assetRecord(source)};
const importsCache=new Map<string,Map<string,OwnerImportRoute>>();
const ownerImports={get:(source:string)=>{
  let previous=importsCache.get(source);if(previous)return previous;
  const records=index.get('imports\0'+source) as (OwnerImportRoute&{relation:CheckerImportRelation})[]|undefined;previous=new Map();
  for(const item of records??[]){
    const relation=item.relation,selected=getSources(item.target)?.find(value=>value.project===item.project&&value.execution===route(item.execution));
    if(!relation||checkerImportIdentity(relation)!==item.relationSha256||relation.file!==source||relation.specifier!==item.specifier||relation.target!==item.target||assetRecord(source)?.sha256!==relation.sourceSha256||!selected)return instrument(Error('oracle checker import relation differs from its owner route: '+item.specifier));
    const same=previous.get(item.specifier);if(same&&(same.target!==item.target||same.project!==item.project||same.execution!==item.execution))return instrument(Error('oracle owner import route is ambiguous: '+item.specifier));
    previous.set(item.specifier,item);
  }
  importsCache.set(source,previous);return previous;
}};
const domains=new Map<string,OracleResolutionDomain>();
const domain=(root:string)=>{
  const previous=domains.get(root);if(previous)return previous;
  const tree=trees.get(root);if(!tree&&root!==dependencyRoot)return instrument(Error('oracle resolution domain has no snapshot owner'));
  const excluded=new OraclePathPrefixes(tree?.excluded??[]);
  const value=new OracleResolutionDomain({recipe:ORACLE_NODE_RESOLUTION_RECIPE,aliases:linkTarget,roots:[...tree?.roots??[],...descriptor.dependencies?.roots??[]],excluded:{has:(file:string)=>{
    if(excluded.has(file))return true;
    for(let prefix=file;;prefix=dirname(prefix)){if(runtimeNode(prefix)?.excluded)return true;if(prefix===dirname(prefix))return false;}
  }},lookup:runtimeNode});domains.set(root,value);return value;
};
const domainProofs={get:(root:string)=>domain(root).prove.bind(domain(root))},domainFiles={get:(root:string)=>domain(root).queryFile.bind(domain(root))},domainIdentities={get:(_root:string)=>runtimeIdentity};
const runtimeRoots=[...trees.values()].map(tree=>tree.root).concat(dependencyRoot?[dependencyRoot]:[]);
const replayRuntime=(kind:HostObservation['kind'],file:string):HostObservation['value']=>{
  try{
    if(kind==='file')return hash(runtimeIO.read(file));
    const info=runtimeIO.kind(file);
    if(kind==='runtimeKind')return info.isFile()?'file':info.isDirectory()?'directory':info.isSymbolicLink()?'symlink':'other';
    if(kind==='readlink')return info.isSymbolicLink()?runtimeIO.link(file):null;
    throw Error('unsupported oracle runtime query operation: '+kind);
  }catch(error){if(['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code??''))return null;throw error;}
};
const runtimeQueryFacts=(treeRoot:string,queries:{path:string}[],assetBytes=false)=>{
  const facts=new Map<string,HostObservation>(),identity=domainIdentities.get(treeRoot)!;
  const put=(kind:HostObservation['kind'],path:string,value:HostObservation['value'])=>{
    const key=kind+'\0'+path,previous=facts.get(key);
    if(previous&&JSON.stringify(previous.value)!==JSON.stringify(value))throw Error('conflicting oracle runtime query facts: '+path);
    facts.set(key,{kind,path,value});
  };
  const prefixes=(file:string)=>{
    const root=runtimeRoots.filter(root=>file===root||file.startsWith(root+sep)).sort((a,b)=>b.length-a.length)[0];
    if(!root)throw Error('oracle runtime query leaves owned namespace: '+file);
    const parts=relative(root,file).split(sep).filter(Boolean);let current=root;
    for(let index=0;index<=parts.length;index++){
      const kind=runtimeKinds.get(current)??null;put('runtimeKind',current,kind);
      if(kind==='symlink'){
        const text=runtimeLinks.get(current);if(text===undefined)throw Error('oracle runtime link has no recorded text: '+current);
        put('readlink',current,text);break;
      }
      if(kind!=='directory'||index===parts.length)break;
      current=join(current,parts[index]!);
    }
  };
  for(const query of queries){
    const trace=identity.trace(query.path);
    prefixes(query.path);for(const alias of trace.aliases)prefixes(alias);
    // A complete captured cycle has no final file. Validate every traversed
    // link, then let Node produce its ordinary ELOOP for this filesystem use.
    if(trace.path===null)continue;
    prefixes(trace.path);
    // Candidate module bytes do not select a path. Node's package metadata
    // does; executable bytes are checked once at the load-result boundary.
    if(runtimeKinds.get(trace.path)==='file'&&(assetBytes||basename(trace.path)==='package.json')){
      const expected=runtimeHashes.get(trace.path);if(!expected)throw Error('oracle runtime query file has no byte owner: '+trace.path);
      put('file',trace.path,expected);
    }
  }
  return [...facts.values()];
};
// An explicit site names an authored input. This qualifies scope only; Node's
// actual load format still decides whether it is CommonJS outside capture.
const authoredInputs=new Set<string>(),plainParents=new Set<string>(),plainLoads=new Set<string>();
const governedOriginals=new Map<string,string>();
const plainInputs=join(dirname(state),'plain-node-inputs.json');
if(existsSync(plainInputs)){
  const record=JSON.parse(readFileSync(plainInputs,'utf8'));
  if(!record||record.version!==1||Object.keys(record).sort().join(',')!=='inputs,manifestSha256,version'||record.manifestSha256!==manifestSha256||!Array.isArray(record.inputs))throw Error('oracle plain Node input identity mismatch');
  for(const input of record.inputs){
    const captured=typeof input?.path==='string'?assetsBySource.get(input.path):undefined;
    if(!input||Object.keys(input).sort().join(',')!=='path,sha256'||!isAbsolute(input.path)||!captured||sources.has(input.path)||
       authoredInputs.has(input.path)||assetRecord(input.path)?.sha256!==input.sha256||runtimeHashes.get(captured)!==input.sha256)
      throw Error('oracle plain Node input has no matching captured original: '+String(input?.path));
    authoredInputs.add(input.path);
  }
}
const plainReceipt=(file:string)=>{
  if(plainParents.has(pathToFileURL(file).href))return;
  plainParents.add(pathToFileURL(file).href);
  appendFileSync(state+'.scope.jsonl',JSON.stringify({version:1,scope:'plain-node',path:file,attested:false})+'\n');
};
originalPath=(file:string)=>{
  const tree=treeFor(file);
  return tree?resolve(parse(descriptor.entry).root,relative(tree.root,file)):file;
};
moduleSource=(url:string)=>{
  if(!url.startsWith('file:'))return null;
  const file=fileURLToPath(url);
  return executions.get(file)?.source??outputOwners.get(file)?.source??null;
};
capturedFile=(source:string)=>{
  try{
    const plans=[...trees.values()].map(tree=>({tree,proof:domainFiles.get(tree.root)!(join(tree.root,relative(parse(source).root,source)))})).filter(item=>item.proof.complete);
    if(!plans.length||plans.some(item=>item.proof.file!==plans[0]!.proof.file))throw Error('oracle captured asset query was not observed: '+source);
    const file=assetsBySource.get(source);
    if(plans[0]!.proof.file&&!file)throw Error('oracle captured asset query has no published file: '+source);
    for(const {tree,proof} of plans)validateHostObservations(runtimeQueryFacts(tree.root,proof.queries,true),replayRuntime);
    return plans[0]!.proof.file?file!:null;
  }catch(error){return instrument(error);}
};
const authoredCommonJS=(file:string,parent?:string)=>{
  const source=originalPath(file),from=parent&&originalPath(parent);
  if(sources.has(source)||!assetsBySource.has(source)||!authoredInputs.has(source)&&!(from&&plainParents.has(pathToFileURL(from).href)))
    return instrument(Error('oracle authored CommonJS input is not qualified: '+source));
  plainReceipt(source);return source;
};
const prepareChild=(file:string,parent:string,worker=false)=>{
  try{
    const source=originalPath(file),from=originalPath(parent),captured=assetsBySource.get(source),sha256=assetRecord(source)?.sha256;
    if(!authoredInputs.has(from)&&!plainParents.has(pathToFileURL(from).href)||sources.has(source)||!captured||!sha256||runtimeHashes.get(captured)!==sha256)
      return instrument(Error('oracle child input has no exact parent qualification: '+source));
    const parentDriver=executionDriver!,role=worker?descriptor.drivers?.commonjsWorker:undefined;
    if(worker&&(!role||runtimeHashes.get(role.path)!==role.sha256||originalPath(role.path)!==role.source||hash(runtimeIO.read(role.path))!==role.sha256))return instrument(Error('oracle Worker driver was not captured'));
    const driver=role?{path:role.path,sha256:role.sha256}:parentDriver,events=runtimeIO.kind(state);
    if(!events.isFile()||!eventIdentity||events.dev!==eventIdentity.dev||events.ino!==eventIdentity.ino||events.uid!==eventIdentity.uid)return instrument(Error('oracle parent event stream changed'));
    capturedAppend(state+'.scope.jsonl','');const scopes=runtimeIO.kind(state+'.scope.jsonl');
    if(!scopes.isFile())return instrument(Error('oracle parent scope stream is not a regular file'));
    const root=join(dirname(path),'states');mkdirSync(root,{recursive:true});
    const own=mkdtempSync(join(root,'execution-')),childState=join(own,'events.jsonl'),id=basename(own);
    appendEvent({version:1,status:'child-start',execution:id});
    writeFileSync(join(own,'snapshot-owner.json'),JSON.stringify(snapshotOwner)+'\n',{flag:'wx'});
    writeFileSync(join(own,'module-inputs.json'),JSON.stringify({version:1,manifestSha256,driver})+'\n',{flag:'wx'});
    writeFileSync(join(own,'plain-node-inputs.json'),JSON.stringify({version:1,manifestSha256,inputs:[{path:source,sha256}]})+'\n',{flag:'wx'});
    linkSync(state,childState);linkSync(state+'.scope.jsonl',childState+'.scope.jsonl');
    writeFileSync(join(own,'event-owner.json'),JSON.stringify({version:1,manifestSha256,events:{path:state,dev:events.dev,ino:events.ino,uid:events.uid},scopes:{dev:scopes.dev,ino:scopes.ino,uid:scopes.uid},...(worker?{driverRole:'commonjs-worker',parentDriver}:{})})+'\n',{flag:'wx'});
    return {id,context:Object.freeze({NTS_ORACLE_EMIT_MANIFEST:path,NTS_ORACLE_EMIT_STATUS:childState,NTS_ORACLE_DEPENDENCIES:dependencyCapability,NTS_ORACLE_SNAPSHOT:snapshotCapability,NTS_GATE_ENV_CONTEXT:canonicalContext})};
  }catch(error){return instrument(Error('oracle child execution was not prepared: '+(error instanceof Error?error.message:String(error)),{cause:error}));}
};
const workerLaunch=(file:string|null,parent:string,args:unknown,kind:'file'|'eval'):WorkerLaunch=>{
  if(file===null)return instrument(Error('oracle '+kind+' Worker entry has no captured driver'));
  const flags=Array.isArray(args)?args:[];
  if(flags.some(flag=>typeof flag==='string'&&/^(?:-r|--require(?:=|$)|--(?:experimental-)?loader(?:=|$))/.test(flag)))return instrument(Error('oracle Worker pre-bootstrap code was not captured'));
  const child=prepareChild(file,parent,true),reader=capturedOpen(state,'r'),identity=capturedStat(reader);let closed=false;
  const finish=(error:unknown,constructor=false)=>{
    if(closed)return;closed=true;
    try{
      const actual=capturedStat(reader);
      if(actual.dev!==identity.dev||actual.ino!==identity.ino||actual.uid!==identity.uid||!actual.isFile())throw Error('oracle Worker event reader changed');
      const chunks:Buffer[]=[];let total=0;
      for(;;){const buffer=Buffer.allocUnsafe(65536),count=capturedRead(reader,buffer,0,buffer.length,null);if(!count)break;total+=count;if(total>64*2**20)throw Error('oracle Worker event stream exceeds its bound');chunks.push(buffer.subarray(0,count));}
      const events=parseOracleLoaderEvents(Buffer.concat(chunks,total).toString('utf8')),status=events.children.get(child.id);
      if(status===undefined)throw Error('oracle Worker reservation is missing');
      if(status!=='reserved')return;
      const code=error&&typeof error==='object'&&Reflect.get(error,'code');
      if(!constructor&&error&&!(typeof code==='string'&&code.startsWith('ERR_WORKER_'))){
        const detail=typeof error==='object'&&(Reflect.get(error,'stack')??Reflect.get(error,'message'));
        throw Error('oracle Worker bootstrap did not begin: '+(typeof detail==='string'?detail:String(error)));
      }
      appendEvent({version:1,status:'child-launch-failed',execution:child.id});
    }catch(error){appendEvent({version:1,status:'instrument',reason:error instanceof Error?error.message:String(error)});}finally{capturedClose(reader);}
  };
  // This oracle child's own heap bounds are process-wide: node applies them to
  // every isolate of the process, and refuses them in a Worker's own arguments.
  const ownHeap=new Set(process.execArgv.filter(flag=>V8_HEAP_FLAG.test(flag)));
  const execution:string[]=['--import',bootstrapURL];
  for(let index=0;index<flags.length;index++){
    if(flags[index]==='--import'&&flags[index+1]===bootstrapURL){index++;continue;}
    if(ownHeap.has(flags[index]))continue;
    execution.push(flags[index]);
  }
  return Object.freeze({context:child.context,args:execution,failed:(error:unknown)=>finish(error,true),ended:(error?:unknown)=>finish(error)});
};
let issuedHarnessCapability=false;
takeHarnessCapability=()=>{
  if(issuedHarnessCapability||!authoredInputs.size||!executionDriver||!treeFor(executionDriver.path)||!delegatedWorker&&originalPath(executionDriver.path)!==descriptor.entry||runtimeHashes.get(executionDriver.path)!==executionDriver.sha256)
    return instrument(Error('oracle harness capability is unavailable or already consumed'));
  issuedHarnessCapability=true;
  return Object.freeze({commonJS:authoredCommonJS,child:(file:string,parent:string)=>prepareChild(file,parent).context,worker:workerLaunch});
};
registerHooks({
  resolve(specifier,context,next){
    const unprepared=(reason:string):never=>instrument(Error(reason));
    // Node's synchronous CJS resolver takes filesystem paths; its ESM resolver
    // takes URLs. This changes only the handoff spelling, never the format.
    const resolveFile=(url:URL)=>next(context.conditions.includes('require')?fileURLToPath(url)+url.search+url.hash:url.href,context);
    const sourceOf=(url:URL)=>{
      const file=fileURLToPath(url),selected=executions.get(file)??outputOwners.get(file),tree=treeFor(file);
      let original=selected?.source??(tree?resolve(parse(descriptor.entry).root,relative(tree.root,file)):file);
      if(dependencyRoot&&original.startsWith(dependencyRoot+sep))original=join(dependencySource!,relative(dependencyRoot,original));
      return original;
    };
    const canonical=(result:ReturnType<typeof next>)=>{
      if(!result.url.startsWith('file:'))return result;
      const url=new URL(result.url),original=sourceOf(url);
      let target:string|undefined;
      if(/\.[cm]?tsx?$/.test(url.pathname)){
        const owners=new Set([...trees.values()].map(tree=>tree.identity(original)).filter(file=>file!==null&&sources.has(file)));
        const source=sources.has(original)?original:owners.size===1?[...owners][0]!:undefined;
        const selected=source&&sources.get(source);
        if(!selected)return unprepared('oracle TypeScript import was not prepared: '+original);
        target=publishedExecution(source!);
      }else{
        const selected=executions.get(fileURLToPath(url));
        // Raw assets already in an owned tree keep Node's own context. An
        // application copy must not jump into a different project's view.
        const owned=treeFor(fileURLToPath(url))&&runtimeHashes.get(fileURLToPath(url));
        target=selected?publishedExecution(selected.source):owned?fileURLToPath(url):assetsBySource.get(original);
      }
      if(!target||target===fileURLToPath(url))return result;
      const routed=pathToFileURL(target);routed.search=url.search;routed.hash=url.hash;
      return resolveFile(routed);
    };
    const plainResult=(result:ReturnType<typeof next>)=>{
      if(!result.url.startsWith('file:'))return result;
      const url=new URL(result.url);
      if(/\.[cm]?tsx?$/.test(url.pathname))return canonical(result);
      if(executions.has(fileURLToPath(url))||outputOwners.has(fileURLToPath(url)))return canonical(result);
      plainLoads.add(result.url);return result;
    };
    const directRequest=(parentURL:string|undefined)=>{
      try{
        if(specifier.startsWith('file:'))return new URL(specifier);
        if(isAbsolute(specifier))return pathToFileURL(specifier);
        if(parentURL?.startsWith('file:')&&(specifier==='.'||specifier==='..'||specifier.startsWith('./')||specifier.startsWith('../')))
          return context.conditions.includes('require')?pathToFileURL(resolve(dirname(fileURLToPath(parentURL)),specifier)):new URL(specifier,parentURL);
      }catch{}
      return undefined;
    };
    const direct=directRequest(context.parentURL);
    const commonjs=context.conditions.includes('require');
    if(!commonjs&&specifier===bootstrapURL)return next(specifier,context);
    if(oracleFileUrlErrorProof({nodeMajor:Number(process.versions.node.split('.')[0]),mode:commonjs?'cjs':'esm',specifier})){
      liveResolutions++;
      // Delegate the error unchanged, including Node's input/module fields.
      // A rejection proof cannot authorize an unexpected successful target.
      const result=next(specifier,context);
      return unprepared('oracle invalid file URL unexpectedly resolved: '+result.url);
    }
    const boot=direct&&bootstrap(direct);
    if(boot&&(!commonjs||isAbsolute(specifier)))return next(commonjs?fileURLToPath(boot):boot,context);
    if(isBuiltin(specifier))return next(specifier,context);
    if(context.parentURL&&plainParents.has(context.parentURL))return plainResult(next(specifier,context));
    if(commonjs&&!isAbsolute(specifier))return unprepared('oracle unproved CommonJS route: '+specifier);
    if(direct){
      const original=sourceOf(direct);
      if(authoredInputs.has(original)){
        const url=pathToFileURL(original);url.search=direct.search;url.hash=direct.hash;
        const result=resolveFile(url);
        if(result.format==='commonjs')return plainResult(result);
        // An authored ESM entry keeps the governed captured route.
      }
    }
    if(!commonjs&&descriptor.resolution){
      if(JSON.stringify(context.conditions)!==JSON.stringify(descriptor.resolution.conditions.esm))return unprepared('oracle resolution conditions identity changed');
      const parentURL=context.parentURL&&governedOriginals.get(context.parentURL)||context.parentURL;
      const parentFile=parentURL?.startsWith('file:')?fileURLToPath(parentURL):undefined;
      // Validate the exact checker relation before a prepared route may use
      // it, including every occurrence of a deferred package-.ts import.
      const parent=parentFile&&executions.get(parentFile);if(parent)ownerImports.get(parent.source);
      const attributes=Object.fromEntries(Object.entries(context.importAttributes).sort(([a],[b])=>a.localeCompare(b,'en')));
      const key=parentFile?'resolve\0'+JSON.stringify([parentFile,specifier,attributes]):undefined;
      let saved=(key&&index.get(key)) as {url:string;format?:string;importAttributes?:Record<string,string|undefined>}|undefined;
      let entryRoute=false;
      // Node applies input-type to a file used as the initial entry only.
      // Keep that entry on the bounded live path so Node raises its own
      // ERR_INPUT_TYPE_NOT_ALLOWED. Imported files from eval keep their routes.
      // A possible spelling in NODE_OPTIONS also chooses that live path;
      // Node itself interprets the environment's quoting and option value.
      const stringEntry=context.parentURL===undefined&&(process.execArgv.some(flag=>flag==='--input-type'||flag.startsWith('--input-type='))||process.env.NODE_OPTIONS?.includes('--input-type'));
      if(!saved&&!stringEntry&&direct&&sourceOf(direct)===descriptor.entry){
        const file=fileURLToPath(direct);saved=index.get(treeFor(file)?'entry\0'+file:'entry') as typeof saved;entryRoute=!!saved;
      }
      if(saved){
        if(typeof saved.url!=='string'||typeof saved.format!=='string'&&!saved.url.startsWith('node:'))return unprepared('oracle prepared Node route is invalid');
        if(saved.url.startsWith('node:'))return {...saved,shortCircuit:true};
        if(!saved.url.startsWith('file:'))return unprepared('oracle prepared Node route has no captured owner');
        const url=new URL(saved.url),file=fileURLToPath(url);
        if(!runtimeHashes.get(file)||!treeFor(file)&&!dependencyFiles.has(file))return unprepared('oracle prepared Node route has no captured owner: '+file);
        if(entryRoute&&direct){url.search=direct.search;url.hash=direct.hash;}
        return {...saved,url:url.href,shortCircuit:true};
      }
    }
    liveResolutions++;
    const extensions=commonjs?createRequire(import.meta.url).extensions:requireExtensions;
    if(commonjs&&(extensions!==requireExtensions||JSON.stringify(Object.keys(extensions))!==JSON.stringify(defaultExtensions)))return unprepared('oracle CommonJS extension domain was not captured: '+specifier);
    if(context.parentURL&&governedOriginals.has(context.parentURL))context={...context,parentURL:governedOriginals.get(context.parentURL)};
    const parent=context.parentURL?.startsWith('file:')?executions.get(fileURLToPath(context.parentURL)):undefined;
    const mapped=parent&&ownerImports.get(parent.source)?.get(specifier);
    const actualSpecifier=mapped?pathToFileURL(route(mapped.execution)).href:specifier;
    const owners=parent?sources.get(parent.source):undefined;
    const contexts=owners&&owners.length>1?owners.map(owner=>({...context,parentURL:pathToFileURL(owner.execution).href})):[context];
    let planned:{owner:typeof context;specifier:string;driver?:boolean;facts?:HostObservation[]}[];
    try{planned=contexts.map(owner=>{
      const request=mapped?new URL(actualSpecifier):directRequest(owner.parentURL);let target=request&&new URL(request),tree=owner.parentURL?.startsWith('file:')?treeFor(fileURLToPath(owner.parentURL)):undefined;
      if(target){
        const file=fileURLToPath(target),original=sourceOf(target);
        if(file===executionDriver?.path)return {owner,specifier,driver:true as const};
        if(/\.[cm]?tsx?$/.test(target.pathname)){
          const canonical=tree?.identity(original),source=sources.has(original)?original:canonical&&sources.has(canonical)?canonical:undefined;
          if(!source)return unprepared('oracle TypeScript import was not prepared: '+original);
          const candidates=sources.get(source)!,selected=(tree&&candidates.find(item=>treeFor(item.execution)===tree))??candidates[0]!;
          target=pathToFileURL(selected.execution);target.search=request!.search;target.hash=request!.hash;tree=treeFor(selected.execution);
        }else if(outputOwners.has(file)){const selected=pathToFileURL(publishedExecution(outputOwners.get(file)!.source));selected.search=target.search;selected.hash=target.hash;target=selected;}
        else if(!treeFor(file)&&!(dependencyRoot&&file.startsWith(dependencyRoot+sep))){
          if(tree)target=pathToFileURL(join(tree.root,relative(parse(file).root,file)));
          else {const captured=assetsBySource.get(original);if(captured)target=pathToFileURL(captured);}
          target.search=request!.search;target.hash=request!.hash;
        }
        tree??=treeFor(fileURLToPath(target));
      }
      const domainRoot=tree?.root??(dependencyRoot&&(owner.parentURL?.startsWith('file:')&&fileURLToPath(owner.parentURL).startsWith(dependencyRoot+sep)||target&&fileURLToPath(target).startsWith(dependencyRoot+sep))?dependencyRoot:undefined);
      if(!domainRoot)return unprepared('oracle resolution context was not captured: '+specifier);
      if(commonjs&&target&&(target.search||target.hash))return unprepared('oracle unproved CommonJS URL identity: '+specifier);
      const proof=domainProofs.get(domainRoot)!({nodeMajor:Number(process.versions.node.split('.')[0]),mode:commonjs?'cjs':'esm',specifier:actualSpecifier,
        parent:owner.parentURL?.startsWith('file:')?fileURLToPath(owner.parentURL):target?fileURLToPath(target):'',...(target?{direct:fileURLToPath(target)}:{}),extensions:Object.keys(extensions)});
      if(!proof.complete)return unprepared('oracle resolution context was not captured: '+specifier+'; '+proof.reason);
      return {owner,specifier:target?(commonjs?fileURLToPath(target)+target.search+target.hash:target.href):actualSpecifier,facts:runtimeQueryFacts(domainRoot,proof.queries)};
    });}catch(error){return instrument(error);}
    // All domains and their current typed answers are checked before any
    // owner calls Node, so a successful fallback cannot hide an unknown input.
    try{validateHostObservations(planned.flatMap(item=>item.facts??[]),replayRuntime);}catch(error){return instrument(error);}
    const outcomes=planned.map(item=>{try{return {ok:true as const,result:next(item.specifier,item.owner)};}catch(error){return {ok:false as const,error};}});
    const first=outcomes[0]!;
    if(outcomes.some(outcome=>outcome.ok!==first.ok))return unprepared('ambiguous oracle emitted import contexts: '+specifier);
    if(!first.ok){
      if(outcomes.length>1){
        const describe=(error:unknown)=>{if(!(error instanceof Error))return undefined;const values:Record<string,unknown>={};for(const key of Object.getOwnPropertyNames(error).sort()){const descriptor=Object.getOwnPropertyDescriptor(error,key)!;if(!('value' in descriptor))return undefined;values[key]=descriptor.value;}try{return JSON.stringify(values);}catch{return undefined;}};
        const expected=describe(first.error);if(!expected||outcomes.some(outcome=>!outcome.ok&&describe(outcome.error)!==expected))return unprepared('ambiguous oracle emitted failure contexts: '+specifier);
      }
      throw first.error;
    }
    const results=outcomes.map(outcome=>{if(!outcome.ok)throw Error('inconsistent oracle resolution outcome');return outcome.result;});
    for(const result of results){
      if(result.url.startsWith('node:'))continue;
      if(!result.url.startsWith('file:'))return unprepared('oracle module URL has no captured owner: '+result.url);
      const file=fileURLToPath(result.url),owned=file===executionDriver?.path||treeFor(file)&&runtimeHashes.get(file)!==undefined||dependencyFiles.has(file)||outputOwners.has(file);
      if(!owned)return unprepared('oracle resolved module has no captured owner: '+result.url);
    }
    const keys=results.map(result=>JSON.stringify([result.url.startsWith('file:')?sourceOf(new URL(result.url))+new URL(result.url).search+new URL(result.url).hash:result.url,result.format??null]));
    if(keys.some(key=>key!==keys[0]))return unprepared('ambiguous oracle emitted import contexts: '+specifier);
    return canonical(first.result);
  },
  load(url,context,next){
    const loadCaptured=(target:string)=>{
      const file=fileURLToPath(target),expected=file===executionDriver?.path?executionDriver.sha256:runtimeHashes.get(file)??bootstrapFiles.get(file);
      if(!expected)return instrument(Error('oracle module has no matching captured owner: '+file));
      const selected=compiled(file),map=selected?.map;
      if(selected&&!file.endsWith('.json')&&!map)return instrument(Error('oracle prepared map route is missing: '+file));
      if(map?.kind==='file'){
        const selectedMap=selected!.execution+'.oracle.map';
        if(map.input.sha256===null){
          let present=false;try{lstatSync(selectedMap);present=true;}catch(error){if(!['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code??''))return instrument(error);}
          if(present)return instrument(Error('oracle absent captured map appeared: '+selectedMap));
        }else{
          const expected=runtimeHashes.get(selectedMap);
          if(!expected||hash(runtimeIO.read(selectedMap))!==expected)return instrument(Error('oracle captured source map changed: '+selectedMap));
        }
      }
      const result=next(target,context);
      // A native addon is opened by Node itself. It retains the existing
      // exact owned-file check; source-bearing formats return these bytes.
      if(result.format==='addon'){
        if(hash(runtimeIO.read(file))!==expected)return instrument(Error('oracle captured addon changed: '+file));
        return result;
      }
      const source=result.source??runtimeIO.read(file);
      const bytes=typeof source==='string'?Buffer.from(source):ArrayBuffer.isView(source)?Buffer.from(source.buffer,source.byteOffset,source.byteLength):Buffer.from(source);
      if(hash(bytes)!==expected)return instrument(Error('oracle filesystem file changed: '+file));
      return result.source===undefined||result.source===null?{...result,source:bytes}:result;
    };
    if(url===bootstrapURL)return next(url,context);
    if(url.startsWith('file:')&&bootstrap(url))return loadCaptured(url);
    if(url.startsWith('file:')&&/\.[cm]?tsx?$/.test(new URL(url).pathname))return instrument(Error('oracle TypeScript import was not prepared: '+fileURLToPath(url)));
    if(plainLoads.has(url)&&url.startsWith('file:')){
      const file=fileURLToPath(url);
      // Some ordinary .js loads have no format yet. nextLoad is Node's
      // authority and returns bytes/format before the module executes.
      const result=next(url,context);
      if(result.format==='commonjs'||result.format==='json'||result.format==='addon'){
        if(result.format==='commonjs')plainReceipt(file);
        return result;
      }
      if(result.format===undefined||result.format===null)return instrument(Error('oracle plain Node transition format is unproved: '+url));
      const captured=assetsBySource.get(file),expected=captured&&runtimeHashes.get(captured);
      if(result.format!=='module'||!captured||!expected)return instrument(Error('oracle plain Node transition has no captured owner: '+url));
      const owned=pathToFileURL(captured);const original=new URL(url);owned.search=original.search;owned.hash=original.hash;
      governedOriginals.set(url,owned.href);
      return loadCaptured(owned.href);
    }
    if(url.startsWith('file:')){
      const file=fileURLToPath(url);
      if(file!==executionDriver?.path&&!treeFor(file)&&!(dependencyRoot&&file.startsWith(dependencyRoot+sep)))return instrument(Error('oracle module has no matching captured owner: '+file));
      return loadCaptured(url);
    }else if(!url.startsWith('node:'))return instrument(Error('oracle module URL has no captured owner: '+url));
    return next(url,context);
  },
});
observeOracleAssets({trees:[...trees.values()].map(tree=>({tree:tree.root,identity:runtimeIdentity,contains:(file:string)=>{try{const fact=runtimeNode(file);if(!fact)return false;validateHostObservations(runtimeQueryFacts(tree.root,[{path:file}],true),replayRuntime);return true;}catch(error){return instrument(error);}}})),instrument:reason=>{appendEvent({version:1,status:'instrument',reason});}});
appendEvent({version:1,status:'ready'});
if(existsSync(eventOwner))appendEvent({version:1,status:'child-ready',execution:basename(dirname(state))});
eventIdentity=eventFile;
}catch(error){instrument(error);}
