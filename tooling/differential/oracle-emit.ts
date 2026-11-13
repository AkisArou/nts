import {runAsCommand} from "./command-entry/main.ts";
// One pinned public TypeScript Program authority checks and emits every TS oracle.
import type {API,Program,RawCompilerOptions,CompilerOptions,Diagnostic} from 'typescript/sync';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire,isBuiltin} from 'node:module';
import {appendFileSync,chmodSync,openSync,closeSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {basename,dirname,extname,isAbsolute,join,parse,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dependencySealReady,dependencySealError,ownsDependencyRun,checkerImportIdentity,OracleFilesystem,OraclePathPrefixes,validateHostObservations,OracleResolutionDomain,capturedPackageMetadata,ORACLE_NODE_RESOLUTION_RECIPE,capturedModuleIdentity,writeOracleSnapshotIndex,readOracleSnapshotIndex,type OracleSnapshotReference,type CheckerImportRelation,type CapturedModulePath,type CapturedAlias,type HostObservation} from './oracle-filesystem.ts';

import {startNodeResolutionSession,queryNodeResolutions,nodeResolutionOptions,type NodeResolutionSession,type NodeResolutionQuery} from './oracle-resolution.ts';
import {ORACLE_RUNTIME_FILES,ORACLE_EXECUTION_FILES,oracleIdentityFor,oracleRecipeIdentity,nodeProcessAlive,parseOracleLoaderEvents,sourceAssetPath,type SourceAssetRule,type OracleManifest} from './oracle-runtime.ts';
export type {OracleManifest} from './oracle-runtime.ts';
const HERE=dirname(fileURLToPath(import.meta.url));
export const REPOSITORY=resolve(HERE,'../..');
export const ORACLE_LOADER=new URL('./oracle-loader.ts',import.meta.url).href;
const hash=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

export type TypeScriptIdentity={version:string;rootPackageSha256:string;packageSha256:string;nativeSha256:string;nativePackageSha256:string};
type ToolchainRecord=TypeScriptIdentity&{nativePackage:string;executable:string};
type ToolchainRecords={version:1;platforms:Record<string,ToolchainRecord>;execution:{manifestVersion:3;options:string;args:string[]}};
export type OracleIdentity={publisherSha256:string;runtimeModulesSha256:string;childBootstrapSha256:string;executionSha256:string;dependencyRecipeSha256?:string;assetsSha256:string;resolutionSha256:string;filesystemSha256:string;runtimeSha256:string;declarationsSha256?:string;version:1;typescript:TypeScriptIdentity;emitterSha256:string;loaderSha256:string;toolchainRecordSha256:string;options:string};
export type EmitOptions=CompilerOptions;
export type RuntimeCoverage={version:3;recipe:typeof ORACLE_NODE_RESOLUTION_RECIPE;aliases:CapturedAlias[];roots:CapturedModulePath[];excluded:CapturedModulePath[];directories:CapturedModulePath[];packages:({directory:CapturedModulePath;sha256:string}&ReturnType<typeof capturedPackageMetadata>)[]};
// No compiler map does not prohibit an authored sourceMappingURL comment.
export type MapRoute={kind:'none'}|{kind:'inline'}|{kind:'ignored';reference:string}|{kind:'file';input:{kind:'compiler'|'owned'|'host';path:string;sha256:string|null};output:string};
export type EmitGroup={entry:string;project:string;output:string;options:EmitOptions;compilerStatus:number|null;files:string[];emitted:Record<string,string>;maps:Record<string,MapRoute>;compilerOutputs:string[];sourceInventory:{path:string;declaration:boolean;external:boolean;defaultLibrary:boolean}[]};
export type OwnerImportRoute={file:string;specifier:string;target:string;project:string;execution:string;relationSha256:string};
export type OracleRuntimeRoute={source:string;sourceSha256:string;project:string;group:string;output:string;execution:string;map?:MapRoute};
export type OracleRuntimeNode={kind:'file'|'directory'|'symlink'|null;sha256?:string;link?:string;present?:boolean;compiled?:OracleRuntimeRoute;asset?:string;scopeAbsent?:boolean;moduleAbsent?:boolean;absent?:boolean;excluded?:boolean;package?:ReturnType<typeof capturedPackageMetadata>};
export type OracleRuntimeTree={root:string;aliases:CapturedAlias[];roots:string[];excluded:string[]};
export type OracleRuntimeDescriptor={captureSha256:string;drivers?:{commonjsWorker:{source:string;path:string;sha256:string}};version:1;identity:OracleIdentity;entry:string;trees:OracleRuntimeTree[];dependencies?:{root:string;roots:string[];source:string;sourceRevision:string;semanticSha256:string;nodeVersion:string};declarationsSha256?:string;resolution?:NodeResolutionSession;runtimeAssets?:Record<string,string>;preloads?:string[]};
export type OracleOptions={sourceAssets?:SourceAssetRule[];runtimeRoots?:string[];outputRoots?:string[];entry:string;directory:string;project?:string|null;preloads?:(string|{entry:string;project?:string|null;roots?:string[]})[];toolchain?:string;roots?:string[];observations?:HostObservation[];declarations?:{descriptor:unknown;files:Record<string,string>;absent:string[];observations:HostObservation[]}};
export type OracleSnapshotIdentity={version:1;index:OracleSnapshotReference;manifestSha256:string;assets?:Record<string,string>};
export type OraclePrepared={manifest:string;loaderState:string;identity:OracleIdentity;snapshot?:OracleSnapshotIdentity;args:string[];env:{NTS_ORACLE_EMIT_MANIFEST:string;NTS_ORACLE_EMIT_STATUS:string;NTS_ORACLE_TYPESCRIPT:string;NTS_ORACLE_SNAPSHOT?:string}};

type OracleHealth={ready:true}|{ready:false;why:string};
type EventReader={descriptor:number|undefined;result?:OracleHealth};
const eventReaders=new WeakMap<object,EventReader>();
const finishedSnapshots=new WeakMap<object,OracleHealth>();
const snapshotKey=(prepared:Pick<OraclePrepared,'manifest'|'snapshot'>)=>prepared.snapshot??prepared;
const parentSnapshots=new WeakMap<OracleSnapshotIdentity,{index:ReturnType<typeof readOracleSnapshotIndex>;descriptor:OracleRuntimeDescriptor;canonical:ReturnType<typeof capturedModuleIdentity>}>();
function parentSnapshot(prepared:OraclePrepared){
  const snapshot=prepared.snapshot;if(!snapshot||snapshot.version!==1)throw Error('oracle snapshot parent identity is missing');
  const previous=parentSnapshots.get(snapshot);if(previous)return previous;
  const index=readOracleSnapshotIndex(dirname(prepared.manifest),snapshot.index),descriptor=index.get('descriptor') as OracleRuntimeDescriptor;
  if(descriptor?.version!==1||JSON.stringify(descriptor.identity)!==JSON.stringify(prepared.identity))throw Error('oracle snapshot parent descriptor changed');
  const aliases=descriptor.trees.flatMap(tree=>tree.aliases.filter(alias=>alias.target.startsWith(tree.root+sep)).map(alias=>({path:resolve(parse(descriptor.entry).root,relative(tree.root,alias.path)),target:resolve(parse(descriptor.entry).root,relative(tree.root,alias.target))})));
  const result={index,descriptor,canonical:capturedModuleIdentity(aliases)};parentSnapshots.set(snapshot,result);return result;
}
/** Only the supervising parent calls this, after its complete process tree
 * drains and before it publishes a verdict or removes original inputs. */
export function finishOracleSnapshot(prepared:Pick<OraclePrepared,'manifest'|'snapshot'>):OracleHealth{
  const key=snapshotKey(prepared),previous=finishedSnapshots.get(key);if(previous)return previous;
  let result:OracleHealth;
  try{
    const snapshot=prepared.snapshot;
    if(!snapshot||snapshot.version!==1||!/^[a-f0-9]{64}$/.test(snapshot.manifestSha256))throw Error('oracle snapshot finalization identity is missing');
    const bytes=readFileSync(prepared.manifest);
    if(hash(bytes)!==snapshot.manifestSha256)throw Error('oracle snapshot original proof changed');
    const record:OracleManifest=JSON.parse(bytes.toString('utf8'));
    if(record.version!==3||record.status!=='complete')throw Error('oracle snapshot original proof is incomplete');
    if(JSON.stringify(record.runtimeIndex)!==JSON.stringify(snapshot.index))throw Error('oracle snapshot index has a different original proof');
    const descriptor=readOracleSnapshotIndex(dirname(prepared.manifest),snapshot.index).get('descriptor') as OracleRuntimeDescriptor|undefined;
    if(descriptor?.version!==1||JSON.stringify(descriptor.identity)!==JSON.stringify(record.identity))throw Error('oracle snapshot descriptor has a different producer identity');
    if(Object.keys(descriptor.runtimeAssets??{}).length!==Object.keys(snapshot.assets??{}).length||Object.entries(descriptor.runtimeAssets??{}).some(([file,sha256])=>snapshot.assets?.[file]!==sha256))throw Error('oracle snapshot generated assets have a different parent identity');
    validateHostObservations(record.observations);
    result={ready:true};
  }catch(error){result={ready:false,why:'oracle snapshot finalization held: '+(error instanceof Error?error.message:String(error))};}
  finishedSnapshots.set(key,Object.freeze(result));return result;
}
/** Readiness of a child is provisional. Report writers require the parent's
 * completed result; skipping the finalizer is a named hold, never a pass. */
export function oracleSnapshotReady(prepared:Pick<OraclePrepared,'manifest'|'snapshot'>):OracleHealth{
  return finishedSnapshots.get(snapshotKey(prepared))??{ready:false,why:'oracle snapshot finalization was not completed'};
}
/** A descriptor belongs to one fresh execution, never to its mutable pathname. */
export function closeOracleExecution(prepared:object):void{
  const owner=eventReaders.get(prepared);
  if(owner?.descriptor!==undefined){const descriptor=owner.descriptor;owner.descriptor=undefined;closeSync(descriptor);}
  if(owner&&!owner.result)owner.result=Object.freeze({ready:false,why:'oracle execution result was not drained'});
}
/** Called after supervisor drain; the immutable result survives descriptor close. */
export function oracleLoaderReady(prepared:Pick<OraclePrepared,'loaderState'>):OracleHealth{
  const owner=eventReaders.get(prepared);
  if(!owner)return {ready:false,why:'oracle execution has no owned event reader'};
  if(owner.result)return owner.result;
  const read=():OracleHealth=>{try{
    const events=parseOracleLoaderEvents(readFileSync(owner.descriptor!,'utf8'));
    if(events.instrument!==undefined)return {ready:false,why:events.instrument};
    const incomplete=[...events.children].find(([,status])=>status!=='ready'&&status!=='launch-failed');
    if(incomplete)return {ready:false,why:'oracle child did not complete bootstrap: '+incomplete[0]};
    return events.ready?{ready:true}:{ready:false,why:'oracle loader never reported ready'};
  }catch(error){return {ready:false,why:'oracle loader did not complete bootstrap: '+String(error)};}
  };
  try{return owner.result=Object.freeze(read());}finally{closeOracleExecution(prepared);}
}

/** A file execution owns a new event path; nested children append to that path. */
export function oracleExecution(prepared:OraclePrepared,driver?:string,plainNodeInputs:string[]=[]):OraclePrepared{
  if(finishedSnapshots.has(snapshotKey(prepared)))throw Error('oracle snapshot execution requested after finalization');
  const root=join(dirname(prepared.manifest),'states');mkdirSync(root,{recursive:true});
  const own=mkdtempSync(join(root,'execution-')),loaderState=join(own,'events.jsonl');
  if(!prepared.snapshot)throw Error('oracle snapshot execution has no parent identity');
  writeFileSync(join(own,'snapshot-owner.json'),JSON.stringify({version:1,manifestSha256:prepared.snapshot.manifestSha256,indexSha256:prepared.snapshot.index.sha256})+'\n',{flag:'wx'});
  if(driver){
    const path=realpathSync(driver);
    writeFileSync(join(own,'module-inputs.json'),JSON.stringify({version:1,manifestSha256:prepared.snapshot?.manifestSha256??hash(readFileSync(prepared.manifest)),driver:{path,sha256:hash(readFileSync(path))}})+'\n',{flag:'wx'});
  }
  if(plainNodeInputs.length){
    // The capture already observed corpus aliases. Join logical caller paths
    // with original bytes through those facts, without another host realpath.
    const {index,canonical}=parentSnapshot(prepared);
    const paths=plainNodeInputs.map(file=>{const path=canonical(resolve(file));if(path===null)throw Error('plain Node input has a cyclic captured alias: '+file);return path;});
    const inputs=[...new Set(paths)].map(path=>{
      const asset=index.get('asset\0'+path) as {path:string;sha256:string}|undefined,sha256=asset?.sha256;
      if(!sha256||index.get('source\0'+path))throw Error('plain Node input has no captured original bytes or is governed TypeScript: '+path);
      return {path,sha256};
    });
    writeFileSync(join(own,'plain-node-inputs.json'),JSON.stringify({version:1,manifestSha256:prepared.snapshot!.manifestSha256,inputs})+'\n',{flag:'wx'});
  }
  const execution={...prepared,loaderState,env:{...prepared.env,NTS_ORACLE_EMIT_STATUS:loaderState}};
  const descriptor=openSync(loaderState,'wx+',0o600);
  try{eventReaders.set(execution,{descriptor});return execution;}catch(error){closeSync(descriptor);throw error;}
}

/** A harness executes its captured inputs, including files it reads itself. */
export function oracleRuntimeFiles(prepared:OraclePrepared,sources:string[]):string[]{
  const {index,descriptor,canonical}=parentSnapshot(prepared);
  const tree=descriptor.trees.find(tree=>relative(dirname(prepared.manifest),tree.root)==='tree/application');
  if(!tree)throw Error('oracle runtime application tree is missing');
  return sources.map(source=>{
    const parent=canonical(dirname(resolve(source)));if(parent===null)throw Error('oracle runtime file has a cyclic alias: '+source);
    // Preserve the requested leaf: readlink/lstat must still see a file link.
    const file=join(tree.root,relative(parse(source).root,join(parent,basename(source))));
    const actual=capturedModuleIdentity(path=>{const value=index.get('path\0'+path) as OracleRuntimeNode|undefined;return value?.kind==='symlink'?resolve(dirname(path),value.link!):undefined;})(file);
    const fact=actual&&index.get('path\0'+actual) as OracleRuntimeNode|undefined;
    if(!fact||fact.kind!=='file'||!fact.sha256||fact.sha256!==hash(readFileSync(file)))throw Error('oracle runtime file has no matching captured owner: '+source);
    return file;
  });
}
export function oracleRuntimeFile(prepared:OraclePrepared,source:string):string{return oracleRuntimeFiles(prepared,[source])[0]!;}

function packageFiles(root:string){
  const digest=createHash('sha256');
  function walk(dir:string):void{
    for(const name of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      const path=join(dir,name.name);
      if(name.isDirectory())walk(path);
      else if(name.isFile()){
        const bytes=readFileSync(path),key=relative(root,path).split(sep).join('/');
        digest.update(JSON.stringify([key,bytes.length])+'\n');digest.update(bytes);
      }else throw Error('oracle TypeScript package contains an unsupported entry: '+path);
    }
  }
  walk(root);
  return digest;
}
export function packageRootHash(root:string):string{return packageFiles(root).digest('hex');}

/** Sorted relative paths, byte lengths and file bytes, then the native hash. */
export function packageIdentity(root:string,executable:string,nativeRoot=dirname(executable)):TypeScriptIdentity{
  const digest=packageFiles(root),rootPackageSha256=digest.copy().digest('hex');
  const nativeSha256=hash(readFileSync(executable));
  digest.update(JSON.stringify(['native-executable',nativeSha256]));
  return {version:JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version,
    rootPackageSha256,packageSha256:digest.digest('hex'),nativeSha256,nativePackageSha256:packageRootHash(nativeRoot)};
}
export function verifyToolchain(location=process.env.NTS_ORACLE_TYPESCRIPT){
  const {root,compiler,identity}=captureToolchain(location);return {root,compiler,identity};
}
export function oracleIdentity(location?:string):OracleIdentity{return oracleIdentityFor(verifyToolchain(location).identity);}
export {oracleRecipeIdentity};

async function invoke(compiler:string,args:string[],cwd:string):Promise<CompilerResult>{
  // The existing request owner supervises the whole process tree. Drain both
  // pipes while awaiting this compiler; add no second deadline or supervisor.
  return new Promise((done,fail)=>{
    const child=spawn(compiler,args,{cwd,stdio:['ignore','pipe','pipe']}),out:Buffer[]=[],err:Buffer[]=[];let stdoutBytes=0,stderrBytes=0,overflow=false;
    const collect=(bytes:number)=>{if(bytes>32*2**20&&!overflow){overflow=true;child.kill();}};
    child.stdout.on('data',(bytes:Buffer)=>{stdoutBytes+=bytes.length;collect(stdoutBytes);if(!overflow)out.push(bytes);});
    child.stderr.on('data',(bytes:Buffer)=>{stderrBytes+=bytes.length;collect(stderrBytes);if(!overflow)err.push(bytes);});
    child.once('error',fail);
    child.once('close',(status,signal)=>{
      if(overflow||signal){fail(Error('oracle TypeScript emit not measured: '+(overflow?'compiler output exceeded its byte bound':signal)));return;}
      done({status,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')});
    });
  });
}
function normalizedMap(bytes:Buffer,base:URL):Buffer{
  try{
    const map=JSON.parse(bytes.toString('utf8'));
    // Node's sourcesToAbsolute, in source_map_cache.js: sourceRoot is a
    // literal prefix, and absolute paths become file URLs. Invalid maps stay
    // invalid; Node alone decides whether to use them.
    map.sources=map.sources.map((source:string)=>{
      const path=(map.sourceRoot||'')+source;
      return isAbsolute(path)?pathToFileURL(path).href:new URL(path,base).href;
    });
    map.sourceRoot='';return Buffer.from(JSON.stringify(map));
  }catch{return bytes;}
}
function sourceMaps(group:EmitGroup,filesystem:OracleFilesystem,producerOutput=group.output):void{
  const inventory=new Set(group.compilerOutputs);
  for(const file of inventory){
    if(!/\.[cm]?jsx?$/.test(file))continue;
    const key=relative(group.output,file);
    // The owner's map options are unchanged. Without a compiler map, preserve
    // every byte, including authored map URLs; Node selects their presentation.
    if(!group.options.sourceMap&&!group.options.inlineSourceMap){group.maps[key]={kind:'none'};continue;}
    const code=readFileSync(file,'utf8'),matches=[...code.matchAll(/\/\/# sourceMappingURL=([^\r\n]+)/g)],match=matches.at(-1);
    if(!match||!code.trimEnd().endsWith(match[0]))throw Error('oracle emitted JavaScript has no final compiler map: '+file);
    const reference=match[1]!;
    const producerFile=join(producerOutput,key);
    if(reference.startsWith('data:application/json;base64,')){
      const bytes=normalizedMap(Buffer.from(reference.slice('data:application/json;base64,'.length),'base64'),pathToFileURL(producerFile));
      writeFileSync(file,code.slice(0,match.index)+'//# sourceMappingURL=data:application/json;base64,'+bytes.toString('base64')+code.slice(match.index!+match[0].length));
      group.maps[key]={kind:'inline'};continue;
    }
    // Node 26 dataFromUrl ignores absolute URL protocols other than data.
    // A relative URL (including an absolute filesystem path) is the precise
    // file Node reads. Bind that file or its absence, not the adjacent TSFILE.
    let absolute:URL|undefined;try{absolute=new URL(reference);}catch{}
    if(absolute){
      if(absolute.protocol==='data:'){
        const [format,data='']=absolute.pathname.split(',',2),parts=format!.split(';');
        if(parts[0]==='application/json'){
          const bytes=normalizedMap(parts.at(-1)==='base64'?Buffer.from(data,'base64'):Buffer.from(data),pathToFileURL(producerFile));
          writeFileSync(file,code.slice(0,match.index)+'//# sourceMappingURL=data:application/json;base64,'+bytes.toString('base64')+code.slice(match.index!+match[0].length));
          group.maps[key]={kind:'inline'};continue;
        }
      }
      group.maps[key]={kind:'ignored',reference};continue;
    }
    const url=new URL(reference,pathToFileURL(producerFile));
    if(url.protocol!=='file:')throw Error('oracle source-map URL cannot be captured: '+url.href);
    const input=fileURLToPath(url),part=relative(producerOutput,input),owned=part!== '..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);
    const published=join(group.output,part),compiler=owned&&inventory.has(published),bytes=compiler?readFileSync(published):filesystem.readBytes(input);
    if(owned&&!compiler&&bytes!==null)throw Error('oracle source-map input has no compiler output owner: '+input);
    const output=key+'.oracle.map',target=join(group.output,output);
    if(existsSync(target))throw Error('oracle source-map output namespace is occupied: '+target);
    if(bytes!==null)writeFileSync(target,normalizedMap(bytes,url));
    group.maps[key]={kind:'file',input:{kind:compiler?'compiler':owned?'owned':'host',path:owned?part:input,sha256:bytes===null?null:hash(bytes)},output};
    const captured=encodeURIComponent(basename(target));
    writeFileSync(file,code.slice(0,match.index)+'//# sourceMappingURL='+captured+code.slice(match.index!+match[0].length));
  }
}

// A worker retains its verified toolchain, while every ordinary project gets
// its own command and original configuration context.
// The finite standard target lowers proposals (notably decorators) that the
// pinned Node 26 runtime cannot parse. Revisit the paired syntax controls
// deliberately when changing either supported Node or the TypeScript pin.
export const ORACLE_RUNTIME_TARGET=13; // TypeScript ScriptTarget.ES2026
function originalTarget(options:EmitOptions):number{return options.target??13;}
function originalModule(options:EmitOptions):number{
  const target=originalTarget(options);
  return options.module??(target===99?99:target>=9?7:target>=7?6:target>=2?5:1);
}
export const ORACLE_EMIT_OPTIONS=[
  {name:'target',reason:'Emit one finite standard syntax supported by every oracle Node.',value:()=>ORACLE_RUNTIME_TARGET},
  {name:'module',reason:'Carry the owner\'s explicit module or its target-dependent default.',value:(_output:string,options:EmitOptions)=>originalModule(options)},
  {name:'useDefineForClassFields',reason:'Carry the owner\'s explicit field semantics or its target-dependent default.',value:(_output:string,options:EmitOptions)=>options.useDefineForClassFields??originalTarget(options)>=9},
  {name:'lib',reason:'Carry the owner\'s already captured implicit library inputs as explicit roots instead of selecting libraries from the emit target.',value:()=>[],when:(options:EmitOptions)=>options.lib===undefined&&!options.noLib},
  {name:'outDir',reason:'Relocate JavaScript and declaration output into the owned run.',value:(output:string)=>output},
  {name:'rootDir',reason:'Preserve the project\'s explicit or checked implicit root; otherwise place output at outDir plus the absolute source path.',value:(_output:string,options:EmitOptions)=>effectiveOriginalRoot(options)},
  {name:'composite',reason:'Emit the source-resolved program without project-output redirection; original roots and diagnostics remain required.',value:()=>false},
  {name:'declaration',reason:'Preserve declarations implied by the original composite setting.',value:(_output:string,options:EmitOptions)=>!!(options.declaration||options.composite)},
  {name:'noEmit',reason:'Write the checked program so Node can execute it.',value:()=>false},
  {name:'emitDeclarationOnly',reason:'Write executable JavaScript as well as any project-requested declarations.',value:()=>false},
  {name:'tsBuildInfoFile',reason:'Keep incremental metadata inside the owned output namespace.',value:(output:string)=>join(output,'build-info.json'),when:(options:EmitOptions)=>!!(options.incremental||options.composite||options.tsBuildInfoFile)},
  {name:'declarationDir',reason:'Keep project-requested declarations inside the owned output namespace.',value:(output:string)=>output,when:(options:EmitOptions)=>!!(options.declaration||options.composite)},
  {name:'rewriteRelativeImportExtensions',reason:'Make emitted relative imports name the emitted JavaScript files.',value:()=>true},
  {name:'noEmitOnError',reason:'The complete diagnostic gates precede emission and publication; exact TS2877 edges remain pending until owner output is proved.',value:()=>false},
] as const;
function effectiveOriginalRoot(options:EmitOptions):string{
  if(typeof options.rootDir==='string'&&options.rootDir)return options.rootDir;
  // TypeScript 7.0.2, typescript-go 2bd066d87f5bafd315be9f40889d0a60b9e58e0b:
  // internal/compiler/program.go verifyCompilerOptions()'s first
  // CommonSourceDirectory predicate; GetEmitDeclarations() is in
  // internal/core/compileroptions.go. Keep this expression and the complete
  // diagnostic parity rows together when upgrading the pinned compiler.
  const checksCommonSourceDirectory=options.outDir||options.rootDir||options.sourceRoot||options.mapRoot||
    ((options.declaration||options.composite)&&options.declarationDir);
  const config=String(options.configFilePath);
  return checksCommonSourceDirectory?dirname(config):parse(config).root;
}
function emitOptions(output:string,options:EmitOptions):EmitOptions{
  return Object.fromEntries(ORACLE_EMIT_OPTIONS.filter(item=>!('when' in item)||item.when(options)).map(item=>[item.name,item.value(output,options)]));
}
type DeferredImport={file:string;specifier:string;target:string;diagnostic:Diagnostic;relationSha256:string};
type PlacementOverlay={path:string;originalSha256:string;bytes:string;changedKeys:string[]};
type ProgramEmission={version:1;requestSha256:string;project:string;options:EmitOptions;inventory:EmitGroup['sourceInventory'];observations:HostObservation[];
  outputs:{path:string;text:string;sourceFileName?:string}[];inputHashes:{checking:Record<string,string>;emission:Record<string,string>};overlay?:{path:string;originalSha256:string;bytes:string;changedKey:'compilerOptions.noEmit'};placementOverlays:PlacementOverlay[];checkerImports:CheckerImportRelation[];deferredImports:DeferredImport[];emitSkipped:boolean;diagnostics:string;instrument?:string;proof?:unknown};
type SourceEdge={file:string;imports:{text:string;pos:number;end:number;runtime?:boolean;resolved:{resolvedFileName:string}|null}[]};
type TranspileImport=Omit<DeferredImport,'diagnostic'>;
type TranspileEmission={producer:'transpileModule';project:string;options:EmitOptions;inventory:EmitGroup['sourceInventory'];
  outputs:ProgramEmission['outputs'];checkerImports:CheckerImportRelation[];deferredImports:[];transpileImports:TranspileImport[];
  proof:{sourceEdges:SourceEdge[]}};
type OwnerEmission=ProgramEmission|TranspileEmission;
const sourceEdges=(record:OwnerEmission):SourceEdge[]=>'producer' in record?record.proof.sourceEdges:(record.proof as {beforeEdges:SourceEdge[]}).beforeEdges;
const ownerImports=(record:OwnerEmission):TranspileImport[]=>'producer' in record?record.transpileImports:record.deferredImports;
type OwnerCapability=Parameters<typeof dependencySealReady>[0]&{admission:{kind:'gate';temporary:{path:string;parent:string}}|{kind:'standalone'}};
export function ownerRunScope(cap:OwnerCapability,env:NodeJS.ProcessEnv=process.env):{directory:string;ledger:string}|undefined{
  if(!ownsDependencyRun(cap,env))return;
  dependencySealReady(cap,env);
  if(cap.admission?.kind==='standalone')return {directory:cap.directory,ledger:cap.directory};
  if(cap.admission?.kind==='gate'){
    const temporary=cap.admission.temporary;
    if(!temporary||!isAbsolute(temporary.path)||!isAbsolute(temporary.parent)||!cap.directory.startsWith(temporary.path+sep))throw dependencySealError(cap.directory);
    return {directory:cap.directory,ledger:cap.directory};
  }
  throw dependencySealError(cap.directory);
}
/** Public flock descriptor handoff; kernel ownership ends on every exit path. */
function ownerLock<T>(path:string,run:()=>T):T{
  mkdirSync(dirname(path),{recursive:true});const descriptor=openSync(path,'a');
  try{
    for(;;){
      const lock=spawnSync('flock',['-n','-E','75','8'],{stdio:['ignore','pipe','pipe',null,null,null,null,null,descriptor]});
      if(lock.status===0)break;
      if(lock.status!==75)throw Error('oracle owner cache lock was not measured: '+path+'; '+lock.stderr);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25);
    }
    return run();
  }finally{closeSync(descriptor);}
}
function emitProgram(requestFile:string,requestSha256:string):ProgramEmission{
  const bytes=readFileSync(requestFile);if(hash(bytes)!==requestSha256)throw Error('oracle public emit request changed');
  const request=JSON.parse(bytes.toString('utf8'));
  if(request?.version!==1||['project','output','toolchain','compiler'].some(key=>typeof request[key]!=='string'||!isAbsolute(request[key]))||request.mirror!==undefined&&(typeof request.mirror!=='string'||!isAbsolute(request.mirror)))throw Error('invalid oracle public emit request');
  if(typeof request.cache!=='string'||!isAbsolute(request.cache))return produceProgram(requestFile,requestSha256);
  const directory=join(request.cache,'programs',hash(JSON.stringify([request.project,request.identity,process.versions.node]))),ready=join(directory,'ready.json');
  const observed=(mode:'emit'|'hit'|'held',record:ProgramEmission)=>{
    try{
      const raw=process.env.NTS_ORACLE_DEPENDENCIES,cap=raw?JSON.parse(raw):null,scope=cap&&ownerRunScope(cap);
      appendFileSync(join(scope?.ledger??request.cache,'oracle-owner-calls.jsonl'),JSON.stringify({version:1,step:scope?cap.ownerStep:null,nodeVersion:process.versions.node,project:request.project,directory,mode,inputsSha256:hash(JSON.stringify(record.observations))})+'\n');
    }catch{/* Cost evidence never changes a program verdict. */}
  };
  return ownerLock(join(directory,'owner.lock'),()=>{
    let previousFile:string|undefined;
    if(existsSync(ready)){
      const stored=JSON.parse(readFileSync(ready,'utf8'));
      if(stored.version!==1||! /^[a-f0-9]{64}$/.test(stored.record)||stored.identity!==hash(JSON.stringify(request.identity)))throw Error('oracle owner cache identity changed: '+directory);
      const file=join(directory,stored.record+'.json'),bytes=readFileSync(file);
      previousFile=file;
      if(hash(bytes)!==stored.sha256)throw Error('oracle owner cache record changed: '+file);
      const previous:ProgramEmission=JSON.parse(bytes.toString('utf8'));
      if(previous.project!==request.project)throw Error('oracle owner cache request changed: '+directory);
      let unchanged=false;try{validateHostObservations(previous.observations);unchanged=true;}catch(error){
        if(!/^Error: oracle filesystem .* changed:/.test(String(error)))throw error;
      }
      // Configured root/output changes alter the request as well as its
      // observed inputs. Replay those inputs before deciding this is a hit.
      if(unchanged){
        if(previous.requestSha256!==requestSha256)throw Error('oracle owner cache request changed: '+directory);
        observed('hit',previous);return previous;
      }
    }
    const record=produceProgram(requestFile,requestSha256);observed(record.proof&&Object.hasOwn(record.proof,'emitDiagnostics')?'emit':'held',record);
    if(!record.instrument&&record.proof&&(record.diagnostics||!record.emitSkipped)){
      const name=hash(JSON.stringify(record.observations)),file=join(directory,name+'.json'),data=JSON.stringify(record)+'\n';
      if(existsSync(file)){if(readFileSync(file,'utf8')!==data)throw Error('oracle owner cache conflicting producer result: '+file);}
      else writeFileSync(file,data,{flag:'wx',mode:0o444});
      const pending=ready+'.'+process.pid;writeFileSync(pending,JSON.stringify({version:1,identity:hash(JSON.stringify(request.identity)),record:name,sha256:hash(data)})+'\n',{flag:'wx'});renameSync(pending,ready);
      // Published snapshots carry their own complete proof and output bytes.
      // Only the latest cache record is consulted by future owner requests.
      if(previousFile&&previousFile!==file)rmSync(previousFile);
    }
    return record;
  });
}
/** A complete project command. All API work finishes before either snapshot is disposed. */
function produceProgram(requestFile:string,requestSha256:string):ProgramEmission{
  const bytes=readFileSync(requestFile);if(hash(bytes)!==requestSha256)throw Error('oracle public emit request changed');
  const request=JSON.parse(bytes.toString('utf8'));
  if(request?.version!==1||['project','output','toolchain','compiler'].some(key=>typeof request[key]!=='string'||!isAbsolute(request[key])))throw Error('invalid oracle public emit request');
  const filesystem=new OracleFilesystem(),servedFiles=new Map<string,string>(),require=createRequire(join(request.toolchain,'package.json'));
  let buildProducts=new OraclePathPrefixes([]);
  const readFile=(file:string)=>{
    if(buildProducts.has(file))throw Error('oracle referenced build product cannot be read: '+file);
    const bytes=filesystem.readBytes(file);if(bytes===null)return undefined;
    const text=bytes.toString('utf8');
    if(!Buffer.from(text).equals(bytes))throw Error('oracle source input is not lossless UTF-8: '+file);
    servedFiles.set(resolve(file),hash(bytes));return text;
  };
  const sdk:typeof import('typescript/sync')=require('typescript/sync'),{serverFS,createFileSystemLayer}=require('typescript/fs');
  const ast:typeof import('typescript/ast')=require('typescript/ast');
  const api=new sdk.API({cwd:dirname(request.project),tsserverPath:request.compiler,runExternalCode:false,fs:{
    readFile,fileExists:filesystem.fileExists,directoryExists:filesystem.directoryExists,
    getAccessibleEntries:path=>({...filesystem.getAccessibleEntries(path),symlinks:undefined}),realpath:filesystem.realpath,stat:serverFS.fakeStat,writeFile:serverFS.error,removeFile:serverFS.error,
  }});
  let original:ReturnType<API['createSnapshot']>|undefined,emitting:ReturnType<API['createSnapshot']>|undefined;
  const record:ProgramEmission={version:1,requestSha256,project:request.project,options:{},inventory:[],observations:[],outputs:[],inputHashes:{checking:{},emission:{}},placementOverlays:[],checkerImports:[],deferredImports:[],emitSkipped:true,diagnostics:''};
  const diagnostics=(program:Program)=>{
    const options=program.getCompilerOptions();
    return {config:program.getConfigFileParsingDiagnostics(),program:program.getProgramDiagnostics(),global:program.getGlobalDiagnostics(),syntax:program.getSyntacticDiagnostics(),semantic:program.getSemanticDiagnostics(),
      declaration:(options.declaration??options.composite)?program.getDeclarationDiagnostics():[]};
  };
  const format=(channels:ReturnType<typeof diagnostics>)=>sdk.formatDiagnostics(Object.values(channels).flat(),api);
  const edges=(program:Program,files:readonly string[],inputHashes:Record<string,string>)=>files.map(file=>{
    const source=program.getSourceFile(file);if(!source)throw Error('oracle program source disappeared: '+file);
    const served=servedFiles.get(resolve(file));if(served!==undefined)inputHashes[file]=served;
    return {file,parserTextSha256:hash(Buffer.from(source.originalText)),imports:source.imports.map(node=>{
      if(!ast.isStringLiteralLikeNode(node))throw Error('oracle program import metadata is unsupported: '+file);
      return {text:node.text,pos:node.pos,end:node.end,resolved:program.getResolvedModuleFromModuleSpecifier(node)??null};
    })};
  });
  // The public parser includes static imports, re-exports and literal dynamic
  // imports even when module resolution found no file. Observe the exact URL;
  // directory listings alone must not turn an unprepared request into absence.
  const observeRequests=(file:string,source:NonNullable<ReturnType<Program['getSourceFile']>>)=>{
    for(const node of source.imports){
      if(!ast.isStringLiteralLikeNode(node))throw Error('oracle literal request metadata is unsupported: '+file);
      if(!node.text.startsWith('./')&&!node.text.startsWith('../'))continue;
      const target=fileURLToPath(new URL(node.text,pathToFileURL(file)));
      filesystem.fileExists(target);filesystem.directoryExists(target);filesystem.readlink(target);
    }
  };
  try{
    const originalBytes=filesystem.readBytes(request.project);if(originalBytes===null)throw Error('oracle original config is missing: '+request.project);
    const read=api.readConfigFile(request.project);
    if(read.error)throw Error('oracle original config cannot be read: '+request.project+'\n'+sdk.formatDiagnostics([read.error],api));
    const parsed=api.parseConfigFile(request.project);
    if(parsed.errors.length)throw Error('oracle original config cannot be checked: '+request.project+'\n'+sdk.formatDiagnostics(parsed.errors,api));
    if(!read.config||typeof read.config!=='object'||Array.isArray(read.config))throw Error('oracle original config is not an object: '+request.project);
    const config=read.config as {compilerOptions?:Record<string,unknown>};
    const productRoots=new Set<string>();
    const products=(options:EmitOptions)=>{for(const path of [options.outDir,options.declarationDir,options.tsBuildInfoFile])if(typeof path==='string')productRoots.add(path);};
    products(parsed.options);
    // Reference metadata describes the same source-layout mirror as this
    // producer. Preserve every semantic option in the referenced configuration.
    const visited=new Set<string>([filesystem.realpath(request.project)]);
    const placements=(references:typeof parsed.projectReferences)=>{
      for(const reference of references??[]){
        const path=filesystem.realpath(filesystem.fileExists(reference.path)?reference.path:join(reference.path,'tsconfig.json'));
        if(visited.has(path))continue;visited.add(path);
        const bytes=filesystem.readBytes(path),raw=api.readConfigFile(path),options=api.parseConfigFile(path);
        if(bytes===null||raw.error||options.errors.length||!raw.config||typeof raw.config!=='object'||Array.isArray(raw.config))throw Error('oracle referenced config cannot be read: '+path);
        const original=raw.config as {compilerOptions?:Record<string,unknown>};
        products(options.options);
        const output=join(request.mirror??request.output,relative(parse(path).root,effectiveOriginalRoot(options.options)));
        const location:Record<string,string>={outDir:output};
        if(options.options.declaration||options.options.composite)location.declarationDir=output;
        if(options.options.incremental||options.options.composite||options.options.tsBuildInfoFile)location.tsBuildInfoFile=join(output,'build-info-'+hash(path).slice(0,16)+'.json');
        const projected=JSON.stringify({...original,compilerOptions:{...original.compilerOptions,...location}})+'\n';
        record.placementOverlays.push({path,originalSha256:hash(bytes),bytes:projected,changedKeys:Object.keys(location)});
        placements(options.projectReferences);
      }
    };
    placements(parsed.projectReferences);
    buildProducts=new OraclePathPrefixes(productRoots);
    const overlay=JSON.stringify({...config,compilerOptions:{...config.compilerOptions,noEmit:true}})+'\n';
    record.overlay={path:request.project,originalSha256:hash(originalBytes),bytes:overlay,changedKey:'compilerOptions.noEmit'};
    // The one-path editor-style layer retains configured root provenance and
    // every original lookup location. Physical config bytes stay unchanged.
    original=api.createSnapshot({openProjects:[request.project],fileSystem:createFileSystemLayer([[request.project,overlay]]),fileNotifications:{invalidateAll:true}});
    const owner=original.getConfiguredProject(request.project)?.program;if(!owner)throw Error('oracle checking program was not loaded: '+request.project);
    const beforeFiles=[...owner.getSourceFileNames()].sort();
    const options={...parsed.options,...emitOptions(request.output,parsed.options)};
    // The SDK's implicit default includes its wrapper file as well as every
    // referenced library. Carry exactly the owner's already loaded toolchain
    // inputs; do not reconstruct a target-to-library list or change locations.
    const libraryRoots=parsed.options.lib===undefined&&!parsed.options.noLib
      ?beforeFiles.filter(file=>dirname(file)===dirname(request.compiler)&&/\.d\.ts$/i.test(file)):[];
    const emissionRoots=[...new Set([...parsed.fileNames,...libraryRoots])];
    const overlaid=new Set([filesystem.realpath(request.project),...record.placementOverlays.map(item=>item.path)]);
    const configInput=beforeFiles.find(file=>overlaid.has(filesystem.realpath(file)));
    if(configInput)throw Error('oracle checking overlay config is a program input: '+configInput);
    const beforeDiagnostics=diagnostics(owner),beforeEdges=edges(owner,beforeFiles,record.inputHashes.checking);
    for(const file of beforeFiles){
      const metadata=owner.getSourceFileMetadata(file);if(!metadata)throw Error('oracle configured source metadata is missing: '+file);
      record.inventory.push({path:file,declaration:/\.d\.[cm]?ts$/i.test(file),external:metadata.isFromExternalLibrary,defaultLibrary:metadata.isDefaultLibrary});
    }
    for(const fact of record.inventory)if(!fact.declaration&&!fact.external&&!fact.defaultLibrary){
      const source=owner.getSourceFile(fact.path);if(!source)throw Error('oracle literal request source disappeared: '+fact.path);
      observeRequests(fact.path,source);
    }
    const beforeOptions=owner.getCompilerOptions();
    record.proof={beforeFiles,beforeDiagnostics,beforeEdges,beforeOptions,projectOptions:parsed.options,libraryRoots,emissionRoots,overlaySha256:hash(overlay)};
    record.diagnostics=format(beforeDiagnostics);
    if(record.diagnostics)return record; // Checking rejection never attempts emission.
    // Public synthetic programs resolve the same sources, rather than consulting
    // project build products. The original project remains the identity authority.
    emitting=original.update({fileSystem:createFileSystemLayer([[request.project,overlay],...record.placementOverlays.map(item=>[item.path,item.bytes] as [string,string])]),fileNotifications:{invalidateAll:true},createPrograms:[{rootFiles:emissionRoots,compilerOptions:options as RawCompilerOptions,options:{configFileParsingDiagnostics:parsed.errors,projectReferences:parsed.projectReferences}}]});
    const program=emitting.operation.createdPrograms?.[0];if(!program)throw Error('oracle emission program was not created');
    const afterFiles=[...program.getSourceFileNames()].sort(),afterDiagnostics=diagnostics(program),afterEdges=edges(program,afterFiles,record.inputHashes.emission);
    const afterOptions=program.getCompilerOptions();
    const changedOptions=[...new Set([...Object.keys(beforeOptions),...Object.keys(afterOptions)])].filter(key=>JSON.stringify((beforeOptions as Record<string,unknown>)[key])!==JSON.stringify((afterOptions as Record<string,unknown>)[key]));
    const permitted=new Set<string>(ORACLE_EMIT_OPTIONS.map(item=>item.name));
    if(changedOptions.some(key=>!permitted.has(key)))throw Error('oracle emission changed a project-owned option: '+changedOptions.join(', '));
    record.options=afterOptions as EmitOptions;
    record.proof={...record.proof as object,beforeFiles,afterFiles,beforeDiagnostics,afterDiagnostics,beforeEdges,afterEdges,projectOptions:parsed.options,beforeOptions,afterOptions,changedOptions};
    if(JSON.stringify(beforeFiles)!==JSON.stringify(afterFiles))throw Error('oracle emission program source set differs from its owner: '+request.project);
    if(JSON.stringify(beforeEdges)!==JSON.stringify(afterEdges))throw Error('oracle emission program resolved imports differ from its owner: '+request.project);
    const pending=(diagnostic:Diagnostic):DeferredImport|undefined=>{
      if(diagnostic.code!==2877||!diagnostic.fileName)return;
      const source=owner.getSourceFile(diagnostic.fileName);if(!source)return;
      const literal=source.imports.find(node=>ast.isStringLiteralLikeNode(node)&&node.pos<=diagnostic.pos&&node.end>=diagnostic.end);
      if(!literal||!ast.isStringLiteralLikeNode(literal)||literal.text.startsWith('.')||! /\.[cm]?tsx?$/.test(literal.text))return;
      const resolved=owner.getResolvedModuleFromModuleSpecifier(literal);
      if(!resolved?.resolvedFileName)return;
      const relation:CheckerImportRelation={file:diagnostic.fileName,specifier:literal.text,pos:literal.pos,end:literal.end,target:filesystem.realpath(resolved.resolvedFileName),sourceSha256:record.inputHashes.checking[diagnostic.fileName]!};
      record.checkerImports.push(relation);
      return {file:relation.file,specifier:relation.specifier,target:relation.target,diagnostic,relationSha256:checkerImportIdentity(relation)};
    };
    if(JSON.stringify(beforeDiagnostics)!==JSON.stringify(afterDiagnostics)){
      const differences=Object.values(afterDiagnostics).flat();
      const obligations=differences.map(pending);
      if(Object.values(beforeDiagnostics).some(items=>items.length)||!obligations.length||obligations.some(item=>!item))throw Error('oracle emission checking diagnostics differ from its owner: '+request.project+'\nowner:\n'+format(beforeDiagnostics)+'emission:\n'+format(afterDiagnostics));
      record.deferredImports=obligations as DeferredImport[];
    }
    const checkingDiagnostics=Object.values(beforeDiagnostics).flat();
    record.diagnostics=format(beforeDiagnostics);
    const output=program.emitToString();record.emitSkipped=output.emitSkipped;
    // Public emit repeats pre-emit diagnostics. Retain both raw arrays in the
    // proof and format their exact structural union, as a compiler diagnostic list.
    record.proof={...record.proof as object,emitDiagnostics:output.diagnostics};
    const emittedErrors=output.diagnostics.filter(diagnostic=>!record.deferredImports.some(item=>JSON.stringify(item.diagnostic)===JSON.stringify(diagnostic)));
    record.diagnostics=sdk.formatDiagnostics([...new Map([...checkingDiagnostics,...emittedErrors].map(diagnostic=>[JSON.stringify(diagnostic),diagnostic])).values()],api);
    record.outputs=[...output.outputFiles].map(([path,file])=>({path,text:file.text,...(file.sourceFileName?{sourceFileName:file.sourceFileName}:{})})).sort((a,b)=>a.path.localeCompare(b.path,'en'));
    for(const file of record.outputs)if(file.sourceFileName&&/\.[cm]?jsx?$/.test(file.path)){
      // Parse the actual emitted specifiers; TypeScript owns extension rewriting.
      // Execution mirrors the source owner's directory, not the compiler outDir.
      const lease=api.createSourceFile(file.path,file.text);
      try{observeRequests(file.sourceFileName,lease.sourceFile);}finally{lease.dispose();}
    }
    if(record.diagnostics||record.emitSkipped){if(record.outputs.length)throw Error('oracle rejected program returned executable output');}
  }catch(error){record.instrument=String(error);}
  finally{emitting?.dispose();original?.dispose();api.close();record.observations=filesystem.captured().sort((a,b)=>(a.kind+'\0'+a.path).localeCompare(b.kind+'\0'+b.path,'en'));}
  return record;
}
type CompilerResult={status:number|null;stdout:string;stderr:string};
export type OracleCompilerRun=(compiler:string,args:string[],cwd:string)=>Promise<CompilerResult>;
/** A completed compiler rejection may be isolated; interrupted work may not. */
export class TypeScriptDiagnosticError extends Error {
  readonly status:number;
  readonly diagnostics:string;
  constructor(status:number,diagnostics:string){
    super(`oracle TypeScript rejected the program (status ${status}): ${diagnostics}`);
    this.status=status;this.diagnostics=diagnostics;
  }
}
type Capture={root:string;compiler:string;identity:TypeScriptIdentity;files:Map<string,Buffer>;nativeFiles:Map<string,Buffer>;nativePackage:string;executable:string};

// Capture each byte once. Execution uses this capture, never a second read of
// files whose hashes were checked: a concurrently replaced installation is
// either refused or has no effect on the worker's owned snapshot.
function captureToolchain(location?:string):Capture{
  if(!location)throw Error('oracle TypeScript capability NTS_ORACLE_TYPESCRIPT is missing');
  const root=realpathSync(location),records:ToolchainRecords=JSON.parse(readFileSync(fileURLToPath(new URL('./oracle-toolchain.json',import.meta.url)),'utf8'));
  const expected=records.platforms[process.platform+'-'+process.arch];
  if(records.version!==1||!expected)throw Error('oracle TypeScript toolchain has no recorded identity for '+process.platform+'-'+process.arch);
  const files=new Map<string,Buffer>(),digest=createHash('sha256');
  function walk(dir:string){
    for(const item of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      const path=join(dir,item.name);
      if(item.isDirectory())walk(path);
      else if(item.isFile()){
        const bytes=readFileSync(path),key=relative(root,path).split(sep).join('/');files.set(key,bytes);
        digest.update(JSON.stringify([key,bytes.length])+'\n');digest.update(bytes);
      }else throw Error('oracle TypeScript package contains an unsupported entry: '+path);
    }
  }
  walk(root);
  const actualRoot=digest.copy().digest('hex');
  if(actualRoot!==expected.rootPackageSha256)throw Error(`oracle TypeScript root package hash mismatch: expected ${expected.rootPackageSha256}; actual ${actualRoot}`);
  const require=createRequire(pathToFileURL(join(root,'package.json')));
  const nativeRoot=dirname(require.resolve(expected.nativePackage+'/package.json')),compiler=join(nativeRoot,expected.executable);
  const nativeFiles=new Map<string,Buffer>(),nativeDigest=createHash('sha256');
  function nativeWalk(dir:string){
    for(const item of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      const path=join(dir,item.name);if(item.isDirectory())nativeWalk(path);
      else if(item.isFile()){const bytes=readFileSync(path),key=relative(nativeRoot,path).split(sep).join('/');nativeFiles.set(key,bytes);nativeDigest.update(JSON.stringify([key,bytes.length])+'\n');nativeDigest.update(bytes);}
      else throw Error('oracle TypeScript platform package contains an unsupported entry: '+path);
    }
  }
  nativeWalk(nativeRoot);const nativeSha256=hash(nativeFiles.get(expected.executable)!);
  digest.update(JSON.stringify(['native-executable',nativeSha256]));
  const actual={version:JSON.parse(files.get('package.json')!.toString('utf8')).version,rootPackageSha256:actualRoot,packageSha256:digest.digest('hex'),nativeSha256,nativePackageSha256:nativeDigest.digest('hex')};
  for(const key of ['version','rootPackageSha256','packageSha256','nativeSha256','nativePackageSha256'] as const)
    if(actual[key]!==expected[key])throw Error(`oracle TypeScript ${key} mismatch: expected ${expected[key]}; actual ${actual[key]}`);
  return {root,compiler,identity:actual,files,nativeFiles,nativePackage:expected.nativePackage,executable:expected.executable};
}
function entries(dir:string):string[]{
  return readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?entries(join(dir,item.name)):[join(dir,item.name)]);
}
function protect(dir:string):void{
  for(const item of readdirSync(dir,{withFileTypes:true})){const path=join(dir,item.name);if(item.isSymbolicLink())continue;if(item.isDirectory())protect(path);else chmodSync(path,path.endsWith('/tsc')||path.endsWith('/tsc.exe')?0o555:0o444);}
  chmodSync(dir,0o555);
}
/** Cleanup only for a caller-owned snapshot tree, after parent finalization.
 * Never chmod or traverse a symlink into another capture or source tree. */
export function removeOracleSnapshot(dir:string):void{
  let root;try{root=lstatSync(dir);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  if(root.isDirectory()){
    const writable=(path:string)=>{chmodSync(path,0o755);for(const item of readdirSync(path,{withFileTypes:true}))if(item.isDirectory()&&!item.isSymbolicLink())writable(join(path,item.name));};
    writable(dir);
  }
  rmSync(dir,{recursive:true,force:true});
}
const removeSnapshot=removeOracleSnapshot;
type DependencyHandle={record:string;sha256:string;image:{source:string;sourceRevision:string;lockfileSha256:string;treeSha256:string;entries:({path:string;kind:string;sha256?:string;target?:string})[]}};
const dependencyImages=new Map<string,DependencyHandle>();
function dependencies():DependencyHandle{
  const raw=process.env.NTS_ORACLE_DEPENDENCIES;if(!raw)throw Error('oracle dependency capability NTS_ORACLE_DEPENDENCIES is missing');
  const cap=JSON.parse(raw);if(cap?.version!==1)throw Error('invalid oracle dependency capability version');
  const sealed=dependencySealReady(cap),key=JSON.stringify([cap.source,cap.sourceRevision,cap.lockfileSha256,cap.helperSha256,cap.directory,process.versions.node,cap.seal??null]);
  const previous=dependencyImages.get(key);if(previous)return previous;
  let record=sealed;
  if(!record){
    const helper=join(cap.source,'tooling/differential',basename(fileURLToPath(new URL('./oracle-dependencies.ts',import.meta.url))));
    if(hash(readFileSync(helper))!==cap.helperSha256)throw Error('oracle dependency provisioner source mismatch');
    const run=spawnSync(process.execPath,[helper,'--capture',raw],{encoding:'utf8',maxBuffer:32*2**20});
    if(run.status!==0||run.signal||run.error)throw Error('oracle dependency capture not measured: '+run.stdout+run.stderr);
    record=run.stdout.trim();if(record!==join(cap.directory,'node-'+process.versions.node,'ready.json'))throw Error('oracle dependency capture returned an unowned ready path');
    if(run.stderr)process.stderr.write(run.stderr);
  }
  const bytes=readFileSync(record),semantic=readFileSync(join(dirname(record),'semantic.json'));
  if(sealed&&(hash(bytes)!==cap.seal.readySha256||hash(semantic)!==cap.seal.semanticSha256))throw dependencySealError(record);
  const image=JSON.parse(bytes.toString('utf8')),packageInventory=JSON.parse(semantic.toString('utf8'));
  if(image.version!==1||image.inputSet?.version!==1||image.inputSet.identity.node!==process.versions.node||JSON.stringify(image.inputSet)!==JSON.stringify(packageInventory.inputSet)||image.lockfileSha256!==cap.lockfileSha256||image.sourceRevision!==cap.sourceRevision||image.source!==cap.source||!sealed&&hash(JSON.stringify(image.entries))!==image.treeSha256)throw Error('oracle dependency capture identity mismatch');
  const handle={record,sha256:hash(semantic),image};dependencyImages.set(key,handle);return handle;
}
type RuntimeIndexInput={trees:{root:string;paths:string[];absent:string[];coverage:RuntimeCoverage}[];files:{source:string;output:string;group:string;execution:string;tree:string}[];links:{output:string;target:string;text?:string;present?:boolean}[];checkerImports:CheckerImportRelation[]};
/** Type erasure and import rewriting happen once in this registered run.
 * Cached code is still read and hashed before each snapshot publishes it. */
async function compileChildAssets(directory:string,sessionDirectory:string,identity:OracleIdentity,nodeIdentity:string):Promise<Record<string,string>>{
  // Finalization also executes this materialized module. Only preparation loads
  // the producer compiler, whose parser is deliberately absent in children.
  const {compileRuntimeModules}=await import('./oracle-runtime-modules.ts');
  const root=join(directory,'assets');
  for(const [name,expected] of [['oracle-loader.ts',identity.loaderSha256],['oracle-runtime.ts',identity.runtimeSha256],['oracle-assets.ts',identity.assetsSha256]] as const){
    if(hash(readFileSync(join(root,name)))!==expected)throw Error('oracle child source changed before compilation: '+name);
  }
  if(hash(JSON.stringify(ORACLE_EXECUTION_FILES.map(name=>hash(readFileSync(join(root,name))))))!==identity.executionSha256)throw Error('oracle child execution source changed before compilation');
  const graph=compileRuntimeModules(root,'oracle-loader.ts');
  const key=hash(JSON.stringify([nodeIdentity,identity.runtimeModulesSha256,graph.modules.map(item=>[item.source,item.sourceSha256,hash(item.text)])]));
  const cache=join(sessionDirectory,'compiled',key);mkdirSync(cache,{recursive:true,mode:0o700});
  return Object.fromEntries(graph.modules.map(({name,text})=>{
    const file=join(cache,name),record=file+'.json';mkdirSync(dirname(file),{recursive:true});
    if(existsSync(record)){
      const previous=JSON.parse(readFileSync(record,'utf8'));
      if(previous.version!==1||previous.key!==key||previous.sha256!==hash(text)||readFileSync(file,'utf8')!==text)throw Error('oracle generated child cache changed: '+name);
    }else{
      // Content-addressed deterministic bytes make simultaneous producers
      // equivalent. Atomic rename never exposes a partially written module.
      const next=file+'.'+process.pid;writeFileSync(next,text);renameSync(next,file);
      const ready=record+'.'+process.pid;writeFileSync(ready,JSON.stringify({version:1,key,sha256:hash(text)})+'\n');renameSync(ready,record);
    }
    const output='assets/'+name;mkdirSync(dirname(join(directory,output)),{recursive:true});
    if(realpathSync(dirname(join(directory,output)))!==dirname(join(directory,output)))throw Error('oracle child publication directory is aliased: '+output);
    writeFileSync(join(directory,output),text,{flag:'wx',mode:0o444});return [output,hash(text)];
  }));
}
/** Resolve only finite captured requests. Node chooses every result. A failed
 * or incomplete plan is left to the bounded live path, with its native error. */
async function publishNodeRoutes(directory:string,stored:OracleManifest,descriptor:OracleRuntimeDescriptor,records:Map<string,unknown>,nodes:Map<string,OracleRuntimeNode>,sources:Map<string,OracleRuntimeRoute[]>,assets:Map<string,{path:string;sha256:string}>,api:API,sessionDirectory:string,ownerPid:number){
  const began=performance.now(),cpu=process.cpuUsage();
  const execution=JSON.parse(readFileSync(fileURLToPath(new URL('./oracle-toolchain.json',import.meta.url)),'utf8')).execution.args as string[];
  const bootstrap=execution.find((_argument,index)=>index>0&&execution[index-1]==='--import');
  const session=await startNodeResolutionSession(sessionDirectory,nodeResolutionOptions(execution,process.env,bootstrap),ownerPid);
  descriptor.runtimeAssets=await compileChildAssets(directory,sessionDirectory,stored.identity,session?.nodeSha256??process.versions.node);
  stored.runtimeAssets=descriptor.runtimeAssets;Object.assign(stored.outputs,descriptor.runtimeAssets);
  if(!session)return;
  descriptor.resolution=session;
  const route=(path:string)=>resolve(directory,path),treeFor=(file:string)=>descriptor.trees.find(tree=>file===tree.root||file.startsWith(tree.root+sep));
  const dependencyRoot=descriptor.dependencies?.root;
  const linkTarget=(file:string)=>{const value=nodes.get(file);return value?.kind==='symlink'?resolve(dirname(file),value.link!):undefined;};
  const canonical=capturedModuleIdentity(linkTarget),domains=new Map<string,OracleResolutionDomain>();
  const domain=(root:string)=>{
    let value=domains.get(root);if(value)return value;
    const tree=descriptor.trees.find(tree=>tree.root===root),excluded=new OraclePathPrefixes(tree?.excluded??[]);
    value=new OracleResolutionDomain({recipe:ORACLE_NODE_RESOLUTION_RECIPE,aliases:linkTarget,roots:[...tree?.roots??[],...descriptor.dependencies?.roots??[]],excluded:{has:(file:string)=>{
      if(excluded.has(file))return true;
      for(let path=file;;path=dirname(path)){if(nodes.get(path)?.excluded)return true;if(path===dirname(path))return false;}
    }},lookup:(path:string)=>nodes.get(path)});domains.set(root,value);return value;
  };
  const owned=(file:string)=>{const key=canonical(file);return key!==null&&!!nodes.get(key)?.sha256&&(!!treeFor(key)||!!dependencyRoot&&(key===dependencyRoot||key.startsWith(dependencyRoot+sep)));};
  const complete=(parent:string,specifier:string,direct?:string)=>{
    const root=treeFor(parent)?.root??(dependencyRoot&&parent.startsWith(dependencyRoot+sep)?dependencyRoot:undefined);
    return !!root&&domain(root).prove({nodeMajor:Number(process.versions.node.split('.')[0]),mode:'esm',specifier,parent,...(direct?{direct}:{})}).complete;
  };
  const query=(specifier:string,parent:string,importAttributes:Record<string,string>={}):NodeResolutionQuery=>({specifier,parentURL:pathToFileURL(parent).href,mode:'esm',conditions:session.conditions.esm,importAttributes});
  const selected=(source:string)=>sources.get(source)?.[0];
  const mapped=(parent:string,specifier:string)=>{
    const compiled=nodes.get(parent)?.compiled,relation=compiled&&stored.imports.find(item=>item.file===compiled.source&&item.specifier===specifier);
    if(relation)return pathToFileURL(route(relation.execution)).href;
    let url:URL|undefined;
    try{if(specifier.startsWith('file:'))url=new URL(specifier);else if(isAbsolute(specifier))url=pathToFileURL(specifier);else if(specifier==='.'||specifier==='..'||specifier.startsWith('./')||specifier.startsWith('../'))url=new URL(specifier,pathToFileURL(parent));}catch{return;}
    if(!url||url.protocol!=='file:')return specifier;
    let file:string;try{file=fileURLToPath(url);}catch{return;}
    const tree=treeFor(file),original=tree?resolve(parse(stored.entry).root,relative(tree.root,file)):file;
    const target=nodes.get(file)?.compiled??selected(original);
    let output=target?route(target.execution):nodes.has(file)?file:undefined;
    if(!output){
      const tree=treeFor(parent);
      output=assets.get(file)?.path??(tree?join(tree.root,relative(parse(file).root,file)):undefined);
    }
    if(!output)return url.href;
    const result=pathToFileURL(output);result.search=url.search;result.hash=url.hash;return result.href;
  };
  type Plan={key:string;query:NodeResolutionQuery};
  let held=0,totalQueries=0,probeCpuUsec=0;const formats=new Map<string,string>();
  const run=async(plans:Plan[],formatOnly=false)=>{
    // Every proof for every owner is already complete before this batch is
    // sent to Node. No success can bypass the post-result ownership check.
    for(let at=0;at<plans.length;at+=10000){
      const batch=plans.slice(at,at+10000),response=await queryNodeResolutions(session,batch.map(item=>item.query));probeCpuUsec+=response.cost.cpuUsec;totalQueries+=batch.length;
      for(let index=0;index<batch.length;index++){
        const item=batch[index]!,answer=response.answers[index]!;
        if(!answer.ok){held++;continue;}
        let result=answer.result;
        if(result.url.startsWith('node:')){if(!formatOnly)records.set(item.key,result);continue;}
        if(!result.url.startsWith('file:')||!owned(fileURLToPath(result.url))||typeof result.format!=='string'){held++;continue;}
        const selectedFormat=result.format;
        if(!formatOnly&&/\.[cm]?tsx?$/.test(new URL(result.url).pathname)){
          // Node selected a TS package target. Only its producer-owned output
          // can execute; Node has already supplied that output's format too.
          const url=new URL(result.url),file=fileURLToPath(url),tree=treeFor(file);
          const original=tree?resolve(parse(stored.entry).root,relative(tree.root,file)):dependencyRoot&&file.startsWith(dependencyRoot+sep)?join(descriptor.dependencies!.source,relative(dependencyRoot,file)):file;
          const output=selected(original),execution=output&&route(output.execution),format=execution&&formats.get(execution);
          if(!execution||!format){held++;continue;}
          const target=pathToFileURL(execution);target.search=url.search;target.hash=url.hash;result={...result,url:target.href,format};
        }
        if(formatOnly){
          const file=fileURLToPath(item.query.specifier);formats.set(file,selectedFormat);
          if(nodes.get(file)?.asset===stored.entry||nodes.get(file)?.compiled?.source===stored.entry)records.set('entry\0'+file,result);
        }
        else records.set(item.key,result);
      }
    }
  };
  const physical=[...nodes].filter(([file,value])=>value.kind==='file'&&value.sha256&&/\.[cm]?jsx?$/.test(file)&&owned(file));
  const formatPlans:Plan[]=[];
  for(const [file]of physical){const url=pathToFileURL(file).href;if(complete(file,url,file))formatPlans.push({key:file,query:query(url,file)});}
  await run(formatPlans,true);
  const plans=new Map<string,Plan>();
  const attributesKey=(value:Record<string,string>)=>Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')));
  for(const [file]of physical){
    if(formats.get(file)!=='module')continue;
    const lease=api.createSourceFile(file,readFileSync(file,'utf8'));
    try{for(const literal of lease.sourceFile.imports){
      if(!('text' in literal)||typeof literal.text!=='string')continue;
      // Attribute-bearing and computed requests retain the bounded live path
      // until their exact runtime tuple is represented; no spelling is guessed.
      const parent=literal.parent;
      if(parent&&'attributes' in parent&&parent.attributes)continue;
      const specifier=literal.text,actual=mapped(file,specifier);if(!actual){held++;continue;}
      let direct:string|undefined;try{if(actual.startsWith('file:'))direct=fileURLToPath(actual);}catch{continue;}
      const owners=nodes.get(file)?.compiled?sources.get(nodes.get(file)!.compiled!.source):undefined;
      const contexts=owners?.length?owners.map(owner=>route(owner.execution)):[file];
      if(!contexts.every(parent=>complete(parent,actual,direct))){held++;continue;}
      const key='resolve\0'+JSON.stringify([file,specifier,attributesKey({})]);
      plans.set(key,{key,query:query(actual,file)});
    }}finally{lease.dispose();}
  }
  const application=descriptor.trees.find(tree=>relative(directory,tree.root)==='tree/application');
  const capturedEntry=application&&join(application.root,relative(parse(stored.entry).root,stored.entry));
  const entry=selected(stored.entry)?.execution??(capturedEntry&&nodes.get(capturedEntry)?.sha256?capturedEntry:assets.get(stored.entry)?.path);
  if(entry){const file=isAbsolute(entry)?entry:route(entry),url=pathToFileURL(file).href;if(complete(file,url,file))plans.set('entry',{key:'entry',query:query(url,file)});}
  await run([...plans.values()]);
  const used=process.cpuUsage(cpu);
  writeFileSync(join(directory,'resolution-cost.json'),JSON.stringify({version:1,queries:totalQueries,incompleteOrFailed:held,probeCpuUsec,parentCpuUsec:used.user+used.system,wallMs:performance.now()-began,scope:'this snapshot route publication; probe CPU separate from parent CPU; no child work'})+'\n');
}
/** Complete parent-side publication. Children read only the resulting sparse
 * runtime facts; original checking proof stays in the audit manifest. */
async function publishRuntimeSnapshot(directory:string,stored:OracleManifest,index:RuntimeIndexInput,api:API,sessionDirectory:string,ownerPid:number,dependency?:DependencyHandle):Promise<OracleSnapshotReference>{
  const records=new Map<string,unknown>(),nodes=new Map<string,OracleRuntimeNode>();
  const node=(file:string,kind:OracleRuntimeNode['kind'])=>{
    const previous=nodes.get(file);if(previous){if(previous.kind!==kind)throw Error('oracle snapshot has conflicting kinds: '+file);return previous;}
    const value:OracleRuntimeNode={kind};nodes.set(file,value);return value;
  };
  const route=(file:string)=>{const path=resolve(directory,file),part=relative(directory,path);if(isAbsolute(file)||part==='..'||part.startsWith('..'+sep))throw Error('oracle snapshot route escapes its owner');return path;};
  const sources=new Map<string,OracleRuntimeRoute[]>(),assets=new Map<string,{path:string;sha256:string}>();
  const trees:OracleRuntimeTree[]=index.trees.map(tree=>{
    const root=route(tree.root),project=(source:string)=>join(root,relative(parse(stored.entry).root,source));
    node(root,'directory');
    for(const path of tree.paths){
      const file=join(root,path),info=lstatSync(file),kind=info.isSymbolicLink()?'symlink':info.isDirectory()?'directory':info.isFile()?'file':null;
      if(kind===null)throw Error('oracle snapshot has an unsupported runtime kind: '+file);
      const value=node(file,kind),sha256=stored.outputs[relative(directory,file)];
      if(kind==='file'&&sha256){
        value.sha256=sha256;value.asset=resolve(parse(stored.entry).root,path);
        const previous=assets.get(value.asset);if(!previous)assets.set(value.asset,{path:file,sha256});
        else if(previous.sha256!==sha256)throw Error('oracle snapshot asset has different owners: '+value.asset);
      }
    }
    for(const path of tree.absent)node(join(root,path),null).absent=true;
    for(const fact of tree.coverage.packages){
      const file=project(join(fact.directory,'package.json')),value=nodes.get(file);
      if(!value||value.kind!=='file'||value.sha256!==fact.sha256)throw Error('oracle snapshot package has no byte owner: '+file);
      value.package={valid:fact.valid,main:fact.main,name:fact.name,exports:fact.exports};
    }
    const shield=join(root,'package.json'),value=nodes.get(shield);
    if(value?.kind==='file'&&!value.package)value.package=capturedPackageMetadata(root);
    const negatives=new Map<string,number>();
    for(const fact of stored.observations){
      if(fact.kind==='fileExists'&&fact.value===false)negatives.set(fact.path,(negatives.get(fact.path)??0)|1);
      if(fact.kind==='directoryExists'&&fact.value===false)negatives.set(fact.path,(negatives.get(fact.path)??0)|2);
      if(fact.kind==='fileExists'&&fact.value===false&&basename(fact.path)==='package.json'){
        const value=nodes.get(project(fact.path))??node(project(fact.path),null);value.scopeAbsent=true;
      }
      if(fact.kind==='directoryExists'&&fact.value===false&&basename(fact.path)==='node_modules'){
        const value=nodes.get(project(fact.path))??node(project(fact.path),null);value.moduleAbsent=true;
      }
    }
    for(const [path,bits] of negatives)if(bits===3){const file=project(path),value=nodes.get(file)??node(file,null);if(value.kind===null)value.absent=true;}
    return {root,aliases:[],roots:tree.coverage.roots.map(project),excluded:tree.coverage.excluded.map(project)};
  });
  for(const link of index.links){
    const output=route(link.output),target=link.target.startsWith('@runtime/')?route(link.target.slice('@runtime/'.length)):dependency?join(dirname(dependency.record),'tree',link.target.slice('@dependencies/'.length)):undefined;
    if(!target)throw Error('oracle snapshot link has no captured target');
    const tree=trees.find(tree=>output.startsWith(tree.root+sep));if(!tree)throw Error('oracle snapshot alias has no tree owner');
    const value=node(output,'symlink');value.link=link.text??(link.target.startsWith('@runtime/')?relative(dirname(output),target):target);value.present=link.present;
    tree.aliases.push({path:output,target});
  }
  for(const item of index.files){
    const group=stored.groups.find(group=>group.output===item.group),sha256=stored.inputs[item.source];
    if(!group||!sha256||stored.outputs[item.execution]!==stored.outputs[item.output])throw Error('oracle snapshot executable has no exact producer');
    const selected:OracleRuntimeRoute={source:item.source,sourceSha256:sha256,project:group.project,group:item.group,output:item.output,execution:item.execution,map:group.maps[relative(group.output,item.output)]};
    for(const file of [route(item.output),route(item.execution)]){
      const value=node(file,'file');value.sha256=stored.outputs[relative(directory,file)];value.compiled=selected;
      if(selected.map?.kind==='file'&&selected.map.input.sha256===null)node(file+'.oracle.map',null).absent=true;
    }
    const previous=sources.get(item.source)??[];previous.push(selected);sources.set(item.source,previous);
  }
  for(const [file,sha256] of Object.entries(stored.outputs)){
    const path=route(file);if(!nodes.has(path)&&file!=='source-index.json')node(path,'file').sha256=sha256;
  }
  for(const [source,routes] of sources){records.set('source\0'+source,routes);records.set('input\0'+source,stored.inputs[source]);}
  for(const [source,asset] of assets)records.set('asset\0'+source,asset);
  const relations=new Map(index.checkerImports.map(fact=>[checkerImportIdentity(fact),fact]));
  for(const source of sources.keys())records.set('imports\0'+source,stored.imports.filter(item=>item.file===source).map(item=>{
    const relation=relations.get(item.relationSha256);
    if(!relation||relation.file!==item.file||relation.specifier!==item.specifier||relation.target!==item.target)throw Error('oracle snapshot checker route differs from its relation');
    return {...item,relation};
  }));
  for(const group of stored.groups)records.set('owner\0'+group.output,{project:group.project,configSha256:stored.inputs[group.project],output:group.output,options:group.options});
  let dependencies:OracleRuntimeDescriptor['dependencies'];
  if(dependency){
    const root=join(dirname(dependency.record),'tree'),semantic=JSON.parse(readFileSync(join(dirname(dependency.record),'semantic.json'),'utf8')) as {packages:{path:string;kind:string;sha256?:string;target?:string}[];omittedInstallerPaths:string[];packageMetadata?:{path:string;sha256:string;metadata:ReturnType<typeof capturedPackageMetadata>}[]};
    const metadata=new Map((semantic.packageMetadata??[]).map(item=>[item.path,item]));node(root,'directory');
    for(const item of semantic.packages){
      const file=resolve(root,item.path),part=relative(root,file);
      if(isAbsolute(item.path)||part==='..'||part.startsWith('..'+sep)||!['file','link','directory'].includes(item.kind))throw Error('oracle snapshot dependency escapes its image');
      const value=node(file,item.kind==='link'?'symlink':item.kind as 'file'|'directory');
      if(item.kind==='file'){
        value.sha256=item.sha256;
        if(basename(file)==='package.json'){
          const fact=metadata.get(item.path);if(fact&&fact.sha256!==item.sha256)throw Error('oracle snapshot dependency metadata differs from its file');
          value.package=fact?.metadata??capturedPackageMetadata(dirname(file));
        }
      }else if(item.kind==='link')value.link=item.target;
    }
    for(const path of semantic.omittedInstallerPaths){const file=resolve(root,path),part=relative(root,file);if(isAbsolute(path)||part==='..'||part.startsWith('..'+sep))throw Error('oracle omitted dependency escapes its image');const value=nodes.get(file)??node(file,null);value.excluded=true;}
    dependencies={root,roots:[...new OraclePathPrefixes(semantic.packages.filter(item=>item.kind==='directory').map(item=>resolve(root,item.path))).paths],source:dependency.image.source,sourceRevision:dependency.image.sourceRevision,semanticSha256:dependency.sha256,nodeVersion:process.versions.node};
  }
  for(const [path,value] of nodes)records.set('path\0'+path,value);
  const descriptor:OracleRuntimeDescriptor={version:1,captureSha256:hash(process.env.NTS_ORACLE_DEPENDENCIES??''),identity:stored.identity,entry:stored.entry,trees,preloads:stored.preloads??[],...(dependencies?{dependencies}:{}),...(stored.identity.declarationsSha256?{declarationsSha256:stored.identity.declarationsSha256}:{})};
  const driver=stored.declarations&&JSON.parse(stored.declarations).descriptor?.drivers?.commonjsWorker;
  if(driver){
    const source=join(dirname(stored.entry),'run-cjs-worker.mjs'),application=trees.find(tree=>relative(directory,tree.root)==='tree/application');
    const path=application&&join(application.root,relative(parse(source).root,source)),expected=stored.inputs[source];
    if(!expected||driver.source!==source||driver.sha256!==expected||!path||nodes.get(path)?.asset!==source||nodes.get(path)?.sha256!==expected)throw Error('oracle worker driver has no exact captured identity');
    descriptor.drivers={commonjsWorker:{source,path,sha256:expected}};
  }
  await publishNodeRoutes(directory,stored,descriptor,records,nodes,sources,assets,api,sessionDirectory,ownerPid);
  records.set('descriptor',descriptor);
  return writeOracleSnapshotIndex(directory,records);
}
type Job={request:OracleOptions;directory:string;entry:string;project:string|null;ownerOverride:{physical:string;project:string}|null;groups:EmitGroup[];ownerOrder:EmitGroup[];originalOutputs:Set<string>;inputs:Record<string,string>;files:Map<EmitGroup,string[]>};

/** One run-scoped worker; the batch owner supervises its compiler commands. */
export class OracleWorker{
  readonly identity:OracleIdentity;
  readonly compiler:string;
  private snapshot:string;
  private ownerCache:string;
  private privateCache:boolean;
  private contexts=new Map<EmitGroup,{directory:string;producerOutput:string;record?:OwnerEmission;targets:Set<string>;expanded:Set<string>;dependencies:Set<EmitGroup>}>();
  private binding:Capture;
  private api:API;
  private readonly toolchainInputs:ReadonlyMap<string,string>;
  private filesystem=new OracleFilesystem();
  private readonly outputRoots:OraclePathPrefixes;
  private closed=false;
  private released=false;
  private busy=false;
  // A command's snapshot can outlive its helper. A canonical run still wins.
  private readonly resolutionOwnerPid:number;
  constructor(directory:string,toolchain=process.env.NTS_ORACLE_TYPESCRIPT,outputRoots:Iterable<string>=[],resolutionOwnerPid=process.pid){
    this.resolutionOwnerPid=resolutionOwnerPid;
    this.outputRoots=new OraclePathPrefixes(outputRoots);
    this.binding=captureToolchain(toolchain);
    // No directory is published before the capability is verified.
    this.identity=oracleIdentityFor(this.binding.identity);
    mkdirSync(directory,{recursive:true});
    const raw=process.env.NTS_ORACLE_DEPENDENCIES,cap=raw?JSON.parse(raw):null,scope=cap&&ownerRunScope(cap);
    this.privateCache=!scope;
    this.ownerCache=scope?join(scope.directory,'oracle-owners','node-'+process.versions.node,hash(JSON.stringify(this.identity))):mkdtempSync(join(resolve(directory),'owners-'));
    mkdirSync(this.ownerCache,{recursive:true});this.snapshot=join(this.ownerCache,'toolchain');
    try{writeFileSync(join(directory,'owner-cache.json'),JSON.stringify({version:1,directory:this.ownerCache,shared:!!scope,ledger:scope?.ledger??this.ownerCache})+'\n');}catch{/* Observation only. */}
    const root=join(this.snapshot,'node_modules/typescript');
    this.compiler=join(this.snapshot,'node_modules',this.binding.nativePackage,this.binding.executable);
    ownerLock(join(this.ownerCache,'toolchain.lock'),()=>{
      if(existsSync(root)){captureToolchain(root);return;}
      for(const [key,bytes] of this.binding.files){const path=join(root,key);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);}
      for(const [key,bytes] of this.binding.nativeFiles){const path=join(this.snapshot,'node_modules',this.binding.nativePackage,key);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);}
      protect(this.snapshot);
    });
    this.toolchainInputs=new Map([
      ...[...this.binding.files].map(([key,bytes])=>[join(this.snapshot,'node_modules/typescript',key),hash(bytes)] as const),
      ...[...this.binding.nativeFiles].map(([key,bytes])=>[join(this.snapshot,'node_modules',this.binding.nativePackage,key),hash(bytes)] as const),
    ]);
    try{
      const require=createRequire(pathToFileURL(join(root,'package.json'))),{API}=require('typescript/sync'),{serverFS}=require('typescript/fs');
      this.api=new API({cwd:REPOSITORY,tsserverPath:this.compiler,fs:{
        readFile:(path:string)=>this.filesystem.readFile(path)??undefined,fileExists:this.filesystem.fileExists,
        directoryExists:this.filesystem.directoryExists,getAccessibleEntries:(path:string)=>({...this.filesystem.getAccessibleEntries(path),symlinks:undefined}),realpath:this.filesystem.realpath,
        stat:serverFS.fakeStat,writeFile:serverFS.error,removeFile:serverFS.error,
      }});
    }catch(error){if(this.privateCache)removeSnapshot(this.ownerCache);throw error;}
  }
  close():void{
    if(this.closed)return;this.closed=true;
    // A canceled preparation remains owned until its bounded command drains.
    if(!this.busy)this.finishClose();
  }
  /** Syntax-only case emission through the same captured, pinned SDK. It
   * creates no Program. The caller passes these actual input observations
   * into raw-JavaScript preparation, so its parent checks and reuse remain
   * bound to the original source and configuration. */
  transpileModule(file:string,project:string):{text:string;map?:string;observations:HostObservation[]}{
    if(this.closed||this.busy)throw Error('oracle transpile worker is unavailable');
    this.busy=true;
    try{
      this.reset();
      file=this.filesystem.realpath(file);project=this.filesystem.realpath(project);
      const source=this.filesystem.readFile(file);if(source===null)throw Error('oracle transpile source is missing: '+file);
      const parsed=this.api.parseConfigFile(project);
      const root=join(this.snapshot,'node_modules/typescript'),require=createRequire(join(root,'package.json'));
      const sdk:typeof import('typescript/sync')=require('typescript/sync');
      if(parsed.errors.length)throw new TypeScriptDiagnosticError(2,sdk.formatDiagnostics(parsed.errors,this.api));
      if(!parsed.fileNames.map(path=>this.filesystem.realpath(path)).includes(file))throw Error('oracle declared entry is not an ordinary root: '+file+'; project: '+project);
      const options={...parsed.options,...emitOptions(join(dirname(file),'javascript'),parsed.options)};
      const output=this.api.transpileModule(source,{fileName:file,compilerOptions:options as RawCompilerOptions,reportDiagnostics:true});
      if(output.diagnostics?.length)throw new TypeScriptDiagnosticError(2,sdk.formatDiagnostics(output.diagnostics,this.api));
      return {text:output.outputText,...(output.sourceMapText?{map:output.sourceMapText}:{}),observations:this.filesystem.captured()};
    }finally{this.busy=false;this.finishClose();}
  }
  private finishClose(){if(this.closed&&!this.released){this.released=true;this.api.close();if(this.privateCache)removeSnapshot(this.ownerCache);}}
  /** NodeNext's per-file module goal depends on extension and package bytes,
   * never on types. Every scope lookup goes through the capture adapter. */
  private transpileFileName(file:string,options:EmitOptions):string{
    if(!options.module||options.module<100||options.module>=200)return file;
    if(/\.[cm]ts$/.test(file))return file;
    let goal='commonjs';
    for(let directory=dirname(file);;directory=dirname(directory)){
      const text=this.filesystem.readFile(join(directory,'package.json'));
      if(text!==null){goal=JSON.parse(text).type==='module'?'module':'commonjs';break;}
      if(directory===dirname(directory))break;
    }
    // The public standalone SDK accepts its implied Node format through the
    // source extension. Keep the real identity everywhere outside this call.
    return file.replace(/\.tsx?$/,goal==='module'?'.mts':'.cts');
  }
  private transpileOwner(job:Job,group:EmitGroup):void{
    const context=this.contexts.get(group)!,root=join(this.snapshot,'node_modules/typescript');
    const require=createRequire(join(root,'package.json'));
    const sdk:typeof import('typescript/sync')=require('typescript/sync'),ast:typeof import('typescript/ast')=require('typescript/ast');
    const parsed=this.api.parseConfigFile(group.project);
    if(parsed.errors.length)throw new TypeScriptDiagnosticError(2,sdk.formatDiagnostics(parsed.errors,this.api));
    if(parsed.options.emitDecoratorMetadata)throw Error('oracle project requires type-directed decorator metadata emission: '+group.project);
    const resolver=this.api.createModuleResolver(parsed.options as RawCompilerOptions);
    // Standalone emit has no whole-Program obligation: only selected sources
    // and their import closure belong to this case, even in a broad owner.
    const queue=[...context.targets],visited=new Set<string>(),edges:SourceEdge[]=[],inventory:EmitGroup['sourceInventory']=[];
    const outputs:ProgramEmission['outputs']=[],relations:CheckerImportRelation[]=[],imports:TranspileImport[]=[];
    try{while(queue.length){
      const file=this.filesystem.realpath(queue.pop()!);if(visited.has(file))continue;visited.add(file);
      const text=this.filesystem.readFile(file);if(text===null)throw Error('oracle transpile input disappeared: '+file);
      const declaration=/\.d\.[cm]?ts$/i.test(file),external=file.includes(sep+'node_modules'+sep);
      inventory.push({path:file,declaration,external,defaultLibrary:false});
      if(file.endsWith('.json')){
        if(!external)outputs.push({path:join(context.producerOutput,relative(effectiveOriginalRoot(group.options),file)),text,sourceFileName:file});
        continue;
      }
      const lease=this.api.createSourceFile(file,text),edge:SourceEdge={file,imports:[]};edges.push(edge);
      try{
        const inspect=(node:import('typescript/ast').Node):void=>{
          if(ast.isEnumDeclaration(node)&&node.modifiers?.some(modifier=>modifier.kind===ast.SyntaxKind.ConstKeyword))
            throw Error('oracle project requires type-directed const-enum emission: '+group.project+'; '+file);
          node.forEachChild(inspect);
        };
        if(!declaration&&!external)inspect(lease.sourceFile);
        const name=this.transpileFileName(file,group.options),mode=name.endsWith('.cts')||group.options.module===1?1:99;
        const owner=declaration||external?null:this.projectFor(job,file);
        const transformed=(file===group.entry||owner&&this.filesystem.realpath(owner)===group.project)&&/\.[cm]?tsx?$/.test(file)
          ?this.api.transpileModule(text,{fileName:name,compilerOptions:group.options as RawCompilerOptions,reportDiagnostics:true}):undefined;
        if(transformed?.diagnostics?.length)throw new TypeScriptDiagnosticError(2,sdk.formatDiagnostics(transformed.diagnostics,this.api));
        let runtimeImports:Set<string>|undefined;
        if(transformed){
          const emitted=this.api.createSourceFile(file.replace(/\.[cm]?tsx?$/,'.js'),transformed.outputText);
          try{runtimeImports=new Set(emitted.sourceFile.imports.filter(ast.isStringLiteralLikeNode).map(literal=>literal.text));}
          finally{emitted.dispose();}
        }
        for(const literal of lease.sourceFile.imports){
          if(!ast.isStringLiteralLikeNode(literal))throw Error('oracle transpile literal metadata is unsupported: '+file);
          if(literal.text.startsWith('.')){
            const exact=fileURLToPath(new URL(literal.text,pathToFileURL(file)));
            this.filesystem.fileExists(exact);this.filesystem.directoryExists(exact);this.filesystem.readlink(exact);
          }
          const resolved=resolver.resolveModuleName(literal.text,dirname(file),mode).resolvedModule;
          const target=resolved?this.filesystem.realpath(resolved.resolvedFileName):undefined;
          const emittedSpecifier=literal.text.startsWith('.')&&group.options.rewriteRelativeImportExtensions
            ?literal.text.replace(/\.(mts|cts|tsx|ts)$/,(extension)=>extension==='.mts'?'.mjs':extension==='.cts'?'.cjs':'.js'):literal.text;
          const runtime=runtimeImports===undefined||runtimeImports.has(emittedSpecifier);
          edge.imports.push({text:literal.text,pos:literal.pos,end:literal.end,runtime,resolved:target?{resolvedFileName:target}:null});
          if(target)queue.push(target);
          if(runtime&&target&&!declaration&&!literal.text.startsWith('.')&&/\.[cm]?tsx?$/.test(literal.text)&&!/\.d\.[cm]?ts$/.test(target)){
            const relation={file,specifier:literal.text,pos:literal.pos,end:literal.end,target,sourceSha256:hash(text)};
            relations.push(relation);imports.push({file,specifier:literal.text,target,relationSha256:checkerImportIdentity(relation)});
          }
        }
        if(!transformed)continue;
        const part=relative(effectiveOriginalRoot(group.options),file);
        if(part==='..'||part.startsWith('..'+sep)||isAbsolute(part))throw Error('oracle transpile source is outside its owner rootDir: '+file+'; project: '+group.project);
        const output=join(context.producerOutput,part.replace(/\.[cm]?tsx?$/,file.endsWith('.mts')?'.mjs':file.endsWith('.cts')?'.cjs':file.endsWith('.tsx')&&group.options.jsx===1?'.jsx':'.js'));
        let javascript=transformed.outputText,map=transformed.sourceMapText;
        if(name!==file){
          const logical=basename(file),synthetic=basename(name);
          const correctMap=(raw:string)=>{
            const value=JSON.parse(raw) as {file?:string;sources?:string[]};
            if(value.file)value.file=basename(output);
            if(value.sources)value.sources=value.sources.map(source=>source.endsWith(synthetic)?source.slice(0,-synthetic.length)+logical:source);
            return JSON.stringify(value);
          };
          if(map){
            const old=basename(name).replace(/\.[cm]ts$/,name.endsWith('.mts')?'.mjs.map':'.cjs.map');
            javascript=javascript.replace('//# sourceMappingURL='+old,'//# sourceMappingURL='+basename(output)+'.map');
            map=correctMap(map);
          }else if(group.options.inlineSourceMap){
            javascript=javascript.replace(/(\/\/# sourceMappingURL=data:application\/json;base64,)([^\r\n]+)(\r?\n?)$/,(_line,prefix:string,data:string,end:string)=>prefix+Buffer.from(correctMap(Buffer.from(data,'base64').toString('utf8'))).toString('base64')+end);
          }
        }
        outputs.push({path:output,text:javascript,sourceFileName:file});
        if(map)outputs.push({path:output+'.map',text:map,sourceFileName:file});
      }finally{lease.dispose();}
    }}finally{resolver.dispose();}
    context.record={producer:'transpileModule',project:group.project,options:group.options,inventory,outputs,checkerImports:relations,deferredImports:[],transpileImports:imports,proof:{sourceEdges:edges}};
    group.sourceInventory=inventory;group.compilerStatus=0;
    writeFileSync(join(context.directory,'transpile-result.json'),JSON.stringify(context.record)+'\n');
  }
  /** A source-resolution graph and standalone emits, with no checked Program.
   * Callers select the separate Program producer for type-directed projects. */
  async prepareTranspiled(request:OracleOptions,signal?:AbortSignal):Promise<OraclePrepared>{
    if(this.busy||this.closed)throw Error('oracle transpile worker is unavailable');
    this.busy=true;
    try{
      this.reset();signal?.throwIfAborted();
      const job=this.stage(request);
      for(;;){
        for(const group of job.groups){
          const context=this.contexts.get(group)!;
          if(!context.record||[...context.targets].some(file=>!group.sourceInventory.some(fact=>fact.path===file))){signal?.throwIfAborted();this.transpileOwner(job,group);}
        }
        for(const group of [...job.groups])this.expandOwners(job,group);
        if(job.groups.every(group=>{const context=this.contexts.get(group)!;return context.record&&[...context.targets].every(file=>context.expanded.has(file));}))break;
      }
      this.finishOwners(job);signal?.throwIfAborted();
      const [prepared]=await this.publish([job],{status:0,stdout:'',stderr:''});
      if(!prepared)throw Error('oracle transpile publication is missing');
      return prepared;
    }finally{this.busy=false;this.finishClose();}
  }
  private stageOwner(job:Job,file:string,name:string,config:string|null,role:'declared'|'imported',roots?:string[]):EmitGroup{
    if(!config)throw Error('oracle TypeScript has no original project: '+file);
    file=this.filesystem.realpath(file);
    const configured=this.filesystem.realpath(config),parsed=this.api.parseConfigFile(configured);
    for(const output of [parsed.options.outDir,parsed.options.declarationDir,parsed.options.tsBuildInfoFile])if(typeof output==='string')job.originalOutputs.add(output);
    if(!this.filesystem.readBytes(configured))throw Error('oracle original project is missing: '+configured);
    const files=parsed.fileNames.map(path=>this.filesystem.realpath(path));
    if(role==='declared'&&!files.includes(file))throw Error('oracle declared entry is not an ordinary root: '+file+'; project: '+configured);
    if(roots&&JSON.stringify([...new Set(roots.map(path=>this.filesystem.realpath(path)))].sort())!==JSON.stringify([...new Set(files)].sort()))throw Error('oracle requested roots differ from the original project: '+configured);
    const previous=job.groups.find(group=>group.project===configured);
    if(previous){this.contexts.get(previous)!.targets.add(file);return previous;}
    const directory=join(job.directory,name),output=join(directory,'javascript');mkdirSync(output,{recursive:true});
    const producerOutput=join(this.ownerCache,'mirror',relative(parse(configured).root,effectiveOriginalRoot(parsed.options)));
    const options={...parsed.options,...emitOptions(producerOutput,parsed.options)};
    const group:EmitGroup={entry:file,project:configured,output,options,compilerStatus:null,files,emitted:{},maps:{},compilerOutputs:[],sourceInventory:[]};
    this.contexts.set(group,{directory,producerOutput,targets:new Set([file]),expanded:new Set(),dependencies:new Set()});job.groups.push(group);return group;
  }
  private stage(request:OracleOptions):Job{
    if(this.closed)throw Error('oracle preparation worker is closed');
    if(request.toolchain&&realpathSync(request.toolchain)!==this.binding.root)throw Error('oracle worker toolchain capability mismatch');
    if(request.declarations)this.filesystem.merge(request.declarations.observations);
    if(request.observations)this.filesystem.merge(request.observations);
    if(!this.filesystem.fileExists(request.entry))throw Error('oracle entry is missing: '+request.entry);
    const entry=this.filesystem.realpath(request.entry),project=request.project===undefined?this.filesystem.projectFor(entry):request.project===null?null:resolve(request.project);
    this.filesystem.readBytes(entry);
    mkdirSync(request.directory,{recursive:true});const directory=mkdtempSync(join(resolve(request.directory),'emit-'));
    const physical=project&&request.project!==undefined?this.filesystem.projectFor(entry):null;
    const ownerOverride=physical&&project&&this.filesystem.realpath(physical)!==this.filesystem.realpath(project)
      ?{physical:this.filesystem.realpath(physical),project:this.filesystem.realpath(project)}:null;
    const job:Job={request,directory,entry,project,ownerOverride,groups:[],ownerOrder:[],originalOutputs:new Set(),inputs:{},files:new Map()};
    const stageGroup=(file:string,name:string,config:string|null,roots?:string[])=>this.stageOwner(job,file,name,config,'declared',roots);
    for(const [i,preload] of (request.preloads??[]).entries()){
      const item=typeof preload==='string'?{entry:preload,project:this.filesystem.projectFor(preload)}:preload;
      stageGroup(item.entry,'preload-'+i,item.project??null,item.roots);
    }
    if(/\.[cm]?tsx?$/.test(entry))stageGroup(entry,'program',project,request.roots);
    else if(project){
      const files:string[]=this.api.parseConfigFile(project).fileNames;
      const first=files.find(file=>/\.[cm]?tsx?$/.test(file)&&! /\.d\.[cm]?ts$/.test(file));
      if(first)stageGroup(first,'program',project);
    }
    return job;
  }
  private reset(){this.contexts.clear();this.filesystem.clear();this.api.clearSourceFileCache();}
  /** An explicit case project replaces the entry's physical aggregate owner,
   * including shared imports. A genuinely nearer config keeps its authority. */
  private projectFor(job:Job,file:string):string|null{
    const physical=this.filesystem.projectFor(file);if(!physical)return null;
    const configured=this.filesystem.realpath(physical);
    return configured===job.ownerOverride?.physical?job.ownerOverride.project:configured;
  }
  private command(group:EmitGroup){
    const context=this.contexts.get(group)!;
    const request={version:1,project:group.project,output:context.producerOutput,mirror:join(this.ownerCache,'mirror'),cache:this.ownerCache,identity:this.identity,toolchain:join(this.snapshot,'node_modules/typescript'),compiler:this.compiler};
    const file=join(context.directory,'program-request.json'),bytes=JSON.stringify(request)+'\n';writeFileSync(file,bytes);
    return [fileURLToPath(import.meta.url),'--emit-program',file,hash(bytes)];
  }
  private acceptProgram(group:EmitGroup,result:CompilerResult){
    let record:ProgramEmission;try{record=JSON.parse(result.stdout);}catch{throw Error('oracle public emit result was not measured: '+result.stdout+result.stderr);}
    const context=this.contexts.get(group)!,request=join(context.directory,'program-request.json');
    if(record?.version!==1||record.requestSha256!==hash(readFileSync(request))||record.project!==group.project||!Array.isArray(record.observations)||!Array.isArray(record.outputs)||!Array.isArray(record.inventory)||!Array.isArray(record.deferredImports)||!Array.isArray(record.placementOverlays))throw Error('oracle public emit result identity mismatch');
    this.filesystem.merge(record.observations);
    const answers=new Map(this.filesystem.captured().filter(row=>row.kind==='file').map(row=>[row.path,row.value]));
    if(!record.inputHashes||typeof record.inputHashes.checking!=='object'||typeof record.inputHashes.emission!=='object')throw Error('oracle program input byte inventory is missing');
    const inventory=record.inventory.map(fact=>fact.path).sort();
    const inventorySet=new Set(inventory);
    if([...Object.keys(record.inputHashes.checking),...Object.keys(record.inputHashes.emission)].some(file=>!inventorySet.has(file)))throw Error('oracle program input byte inventory contains an unowned file');
    for(const fact of record.inventory){
      if(!fact||typeof fact.path!=='string'||!isAbsolute(fact.path)||['declaration','external','defaultLibrary'].some(key=>typeof (fact as Record<string,unknown>)[key]!=='boolean'))throw Error('invalid oracle program input fact');
      const original=this.toolchainInputs.get(fact.path)??answers.get(fact.path);
      if(typeof original!=='string')throw Error('oracle program input has no captured file answer: '+fact.path);
      for(const program of result.status===0?['checking','emission'] as const:['checking'] as const){
        const served=record.inputHashes[program][fact.path];
        if(served!==original&&!(served===undefined&&this.toolchainInputs.has(fact.path)))throw Error('oracle program input bytes differ from captured original: '+fact.path);
      }
    }
    if(record.overlay&&(record.overlay.path!==group.project||record.overlay.changedKey!=='compilerOptions.noEmit'||answers.get(group.project)!==record.overlay.originalSha256))throw Error('oracle checking overlay has no original config owner');
    for(const overlay of record.placementOverlays??[])if(answers.get(overlay.path)!==overlay.originalSha256||overlay.changedKeys.some(key=>!['outDir','declarationDir','tsBuildInfoFile'].includes(key)))throw Error('oracle reference placement has no original config owner: '+overlay.path);
    writeFileSync(join(context.directory,'program-result.json'),JSON.stringify(record,null,2)+'\n');
    if(record.instrument)throw Error(record.instrument);
    if(result.status!==0||record.emitSkipped||record.diagnostics){
      if(result.status===2&&record.diagnostics)throw new TypeScriptDiagnosticError(2,record.diagnostics);
      throw Error('oracle public emit was not measured: '+result.status+'; '+record.diagnostics);
    }
    type Edge={file:string;imports:{text:string;pos:number;end:number;runtime?:boolean;resolved:{resolvedFileName:string}|null}[]};
    const proof=record.proof as {emitDiagnostics?:Diagnostic[];beforeEdges:Edge[];afterEdges:Edge[];beforeDiagnostics:Record<string,Diagnostic[]>;afterDiagnostics:Record<string,Diagnostic[]>&{semantic:Diagnostic[]}};
    if(!Array.isArray(record.checkerImports)||!Array.isArray(proof?.beforeEdges)||JSON.stringify(proof.beforeEdges)!==JSON.stringify(proof.afterEdges))throw Error('oracle checker import relation has no checking graph');
    const checkerEdges=new Map(proof.beforeEdges.map(edge=>[edge.file,edge.imports])),relations=new Map<string,CheckerImportRelation>();
    for(const relation of record.checkerImports){
      const edge=checkerEdges.get(relation.file)?.find(edge=>edge.text===relation.specifier&&edge.pos===relation.pos&&edge.end===relation.end);
      if(!edge?.resolved||this.filesystem.realpath(edge.resolved.resolvedFileName)!==relation.target||record.inputHashes.checking[relation.file]!==relation.sourceSha256)throw Error('oracle checker import relation differs from its checking graph');
      relations.set(checkerImportIdentity(relation),relation);
    }
    const deferred=new Set(record.deferredImports.map(item=>JSON.stringify(item.diagnostic)));
    if(Object.values(proof.beforeDiagnostics).some(items=>items.length)||Object.values(proof.afterDiagnostics).flat().some(diagnostic=>!deferred.has(JSON.stringify(diagnostic))))throw Error('oracle checker import relation has an unaccepted diagnostic');
    for(const item of record.deferredImports){
      const relation=relations.get(item.relationSha256),diagnostic=item.diagnostic;
      if(!relation||relation.file!==item.file||relation.specifier!==item.specifier||relation.target!==item.target||diagnostic.code!==2877||diagnostic.fileName!==item.file||diagnostic.pos<relation.pos||diagnostic.end>relation.end||!proof.afterDiagnostics.semantic.some(actual=>JSON.stringify(actual)===JSON.stringify(diagnostic)))throw Error('oracle checker import relation does not discharge its exact TS2877');
    }
    if(!Array.isArray(proof?.emitDiagnostics)||proof.emitDiagnostics.some(diagnostic=>!record.deferredImports.some(item=>JSON.stringify(item.diagnostic)===JSON.stringify(diagnostic))))throw Error('oracle actual emit diagnostics were not accepted: '+group.project);
    if(record.outputs.length===0)throw Error('oracle TypeScript did not emit '+group.entry);
    group.sourceInventory=record.inventory;
    const sources=new Map(record.inventory.map(fact=>[fact.path,fact]));
    const outputs=new Set<string>(),owners=new Map<string,string>();
    for(const item of record.outputs){
      const file=resolve(item.path),part=relative(context.producerOutput,file);
      if(!isAbsolute(item.path)||part==='..'||part.startsWith('..'+sep)||isAbsolute(part)||outputs.has(file)||typeof item.text!=='string')throw Error('oracle compiler output escapes or conflicts with its owned namespace: '+item.path);
      outputs.add(file);
      const executable=/\.[cm]?jsx?$/.test(file),fact=item.sourceFileName?sources.get(item.sourceFileName):undefined;
      if(executable&&(!fact||fact.declaration||fact.external||fact.defaultLibrary))throw Error('oracle emitted executable has no captured source owner: '+file+'; source: '+item.sourceFileName);
      if(item.sourceFileName&&!fact)throw Error('oracle emitted output names a source outside its program: '+item.sourceFileName);
      if(fact&&!fact.declaration&&!fact.external&&!fact.defaultLibrary&&(executable||file.endsWith('.json'))){
        const previous=owners.get(fact.path);if(previous&&previous!==file)throw Error('oracle source has ambiguous executable outputs: '+fact.path);
        owners.set(fact.path,file);
      }
    }
    context.record=record;group.options=record.options;group.compilerStatus=0;
    return record.inventory.filter(f=>!f.declaration&&!f.external&&!f.defaultLibrary).map(f=>f.path);
  }
  private expandOwners(job:Job,group:EmitGroup){
    const context=this.contexts.get(group)!,record=context.record!;
    const facts=sourceEdges(record);
    if(!Array.isArray(facts))throw Error('oracle source import graph is missing');
    const edges=new Map(facts.map(edge=>[edge.file,edge]));
    const checkedSources=new Set(group.sourceInventory.filter(fact=>!fact.declaration&&!fact.external&&!fact.defaultLibrary).map(fact=>fact.path));
    const queue=[...context.targets];
    while(queue.length){
      const file=queue.pop()!;if(context.expanded.has(file))continue;context.expanded.add(file);
      if(file!==group.entry&&!file.endsWith('.json')){
        const owner=this.projectFor(job,file);
        if(!owner)throw Error('oracle TypeScript import has no owner: '+file);
        if(this.filesystem.realpath(owner)!==group.project){context.dependencies.add(this.stageOwner(job,file,'owner-'+job.groups.length,owner,'imported'));continue;}
      }
      if(!checkedSources.has(file))throw Error('oracle owner closure has no checking input: '+file+'; project: '+group.project);
      context.targets.add(file);
      const edge=edges.get(file);if(!edge)throw Error('oracle owner closure has no checking input: '+file+'; project: '+group.project);
      for(const item of edge.imports){
        if(item.runtime===false)continue;
        const resolved=item.resolved?.resolvedFileName;if(!resolved||/\.d\.[cm]?ts$/.test(resolved))continue;
        const target=this.filesystem.realpath(resolved);
        if(target.endsWith('.json')){context.targets.add(target);continue;}
        if(!/\.[cm]?tsx?$/.test(target))continue;
        const project=this.projectFor(job,target);
        if(!project)throw Error('oracle TypeScript import has no owner: '+target);
        if(this.filesystem.realpath(project)===group.project){
          context.targets.add(target);queue.push(target);
        }
        else context.dependencies.add(this.stageOwner(job,target,'owner-'+job.groups.length,project,'imported'));
      }
    }
  }
  private finishOwners(job:Job){
    const active=new Set<EmitGroup>(),finished=new Set<EmitGroup>();
    const order=(group:EmitGroup)=>{
      if(finished.has(group)||active.has(group))return;
      active.add(group);for(const dependency of this.contexts.get(group)!.dependencies)order(dependency);
      active.delete(group);finished.add(group);job.ownerOrder.push(group);
    };
    for(const group of job.groups)order(group);
    const published=new Map<string,string>();
    for(const group of job.ownerOrder){
      const context=this.contexts.get(group)!,record=context.record!;
      const selected=record.outputs.filter(item=>!item.sourceFileName||context.targets.has(item.sourceFileName));
      for(const item of selected){
        const part=relative(context.producerOutput,item.path),file=join(group.output,part);
        if(item.sourceFileName&&(/\.[cm]?jsx?$/.test(file)||file.endsWith('.json'))){
          const previous=published.get(item.sourceFileName);
          if(previous&&hash(readFileSync(previous))!==hash(item.text))throw Error('oracle conflicting emitted TypeScript source: '+item.sourceFileName);
          group.emitted[item.sourceFileName]=part;published.set(item.sourceFileName,file);
        }
        mkdirSync(dirname(file),{recursive:true});writeFileSync(file,item.text);group.compilerOutputs.push(file);
      }
      // Every selected checked, non-declaration, non-external TypeScript source must have its owner's executable output.
      for(const file of context.targets)if(/\.[cm]?tsx?$/.test(file)&&!group.emitted[file])throw Error('oracle owner closure has no emitted output: '+file+'; project: '+group.project);
      job.files.set(group,[...context.targets]);
    }
    for(const group of job.groups)for(const obligation of ownerImports(this.contexts.get(group)!.record!).filter(item=>this.contexts.get(group)!.targets.has(item.file))){
      const target=this.filesystem.realpath(obligation.target),owner=this.projectFor(job,target);
      if(!owner||!job.groups.some(group=>group.project===this.filesystem.realpath(owner)&&group.emitted[target]))throw Error('oracle unowned TS2877 target: '+obligation.file+' -> '+obligation.specifier+' -> '+target);
    }
  }
  /** Runtime files keep their original relative positions; Node owns all resolution. */
  private runtimeTree(job:Job,name:string){
    const began=performance.now(),cpu=process.cpuUsage();
    const root=join('tree',name),tree=join(job.directory,root);mkdirSync(tree,{recursive:true});
    const copied=new Map<string,string>(),directories=new Set<string>(),visited=new Set<string>(),links:{output:string;target:string;text?:string;present?:boolean}[]=[];
    let dependency:DependencyHandle|undefined;
    const localExcluded=new OraclePathPrefixes([...(job.request.outputRoots??[]),...job.originalOutputs,job.request.directory,dirname(this.snapshot),job.directory]);
    const excluded=(path:string)=>this.outputRoots.has(path)||localExcluded.has(path);
    const inside=(path:string,root:string)=>path===root||path.startsWith(root+sep);
    const destination=(source:string)=>join(tree,relative(parse(source).root,source));
    const roots=new Set(job.groups.map(group=>group.project&&dirname(group.project)!==REPOSITORY&&inside(group.entry,dirname(group.project))?dirname(group.project):dirname(group.entry)));
    if(!job.groups.length)roots.add(dirname(job.entry));
    const declared=name==='application'?[...new Set(job.request.runtimeRoots??[])].map(root=>{
      const source=resolve(root);
      if(!this.filesystem.fileExists(source)&&!this.filesystem.directoryExists(source))throw Error('oracle declared runtime root is missing: '+source);
      const physical=this.filesystem.realpath(source);roots.add(physical);return {source,physical};
    }):[];
    for(const file of job.groups.flatMap(group=>job.files.get(group)??[]))if(![...roots].some(root=>inside(file,root))&&!file.includes(sep+'node_modules'+sep))roots.add(dirname(file));
    const copyRoots=new Set(roots);
    const unobserved=new Set<string>();
    const packages=new Set<string>(),moduleNamespaces=new Map<string,Set<string>>(),completeNamespaces=new Set<string>();
    for(const {source} of declared){
      const parts=source.split(sep),at=parts.lastIndexOf('node_modules');
      if(at>=0&&parts[at+1])packages.add(parts.slice(at+1,at+(parts[at+1]!.startsWith('@')?3:2)).join('/'));
    }
    const requests=(file:string,text:string)=>{
      if(!/\.[cm]?jsx?$/.test(file))return;
      const lease=this.api.createSourceFile(file,text);
      try{for(const literal of lease.sourceFile.imports){
        if(!('text' in literal)||typeof literal.text!=='string')continue;
        const name=literal.text;
        if(isBuiltin(name)||name.startsWith('.')||name.startsWith('#')||isAbsolute(name)||name.includes(':'))continue;
        packages.add(name.split('/').slice(0,name.startsWith('@')?2:1).join('/'));
      }}finally{lease.dispose();}
    };
    for(const group of job.groups)for(const file of group.compilerOutputs)requests(file,readFileSync(file,'utf8'));
    // A project's build-only node_modules is not an installed dependency.
    // Inspect directory/kind answers only, never the excluded product bytes.
    const onlyBuildOutputs=(source:string):boolean=>excluded(source)||
      this.filesystem.runtimeKind(source)==='directory'&&this.filesystem.runtimeEntries(source).every(name=>onlyBuildOutputs(join(source,name)));
    const put=(source:string,bytes:Buffer)=>{
      const file=destination(source),digest=hash(bytes),old=copied.get(file);
      if(old&&old!==digest)throw Error('oracle conflicting captured runtime file: '+source);
      if(!old){requests(source,bytes.toString('utf8'));mkdirSync(dirname(file),{recursive:true});writeFileSync(file,bytes);copied.set(file,digest);}
    };
    const copy=(source:string,modules=false)=>{
      if(excluded(source)||visited.has(source))return;
      if(source.endsWith(sep+'node_modules')&&!modules){if(!moduleNamespaces.has(source))moduleNamespaces.set(source,new Set());return;}
      visited.add(source);
      const text=source.endsWith(sep+'node_modules')?null:this.filesystem.readlink(source);
      if(text!==null){
        if(isAbsolute(text))throw Error('oracle runtime asset has an absolute symlink: '+source);
        const target=resolve(dirname(source),text),output=destination(source),captured=destination(target);
        if(resolve(dirname(output),text)!==captured||![...roots].some(root=>inside(target,root))||excluded(target))throw Error('oracle runtime asset link escapes its captured roots: '+source);
        const present=this.filesystem.runtimeKind(target)!==null;
        mkdirSync(dirname(output),{recursive:true});symlinkSync(text,output);
        links.push({output:relative(job.directory,output),target:'@runtime/'+relative(job.directory,captured),text,present});
        if(present)copy(target);return;
      }
      const physical=this.filesystem.realpath(source);
      if(this.filesystem.directoryExists(source)){
        if(source.endsWith(sep+'node_modules')){
          const lock=this.filesystem.readBytes(join(dirname(source),'pnpm-lock.yaml'));
          if(lock&&!process.env.NTS_ORACLE_DEPENDENCIES)throw Error('oracle dependency capability NTS_ORACLE_DEPENDENCIES is missing: '+source);
          if(lock&&process.env.NTS_ORACLE_DEPENDENCIES&&!inside(source,JSON.parse(process.env.NTS_ORACLE_DEPENDENCIES).source))throw Error('oracle dependency capability does not own locked modules: '+source);
        }
        if(source.endsWith(sep+'node_modules')&&process.env.NTS_ORACLE_DEPENDENCIES){
          const cap=JSON.parse(process.env.NTS_ORACLE_DEPENDENCIES);
          const origin=inside(source,cap.source)?source:physical;
          if(inside(origin,cap.source)){
            dependency=dependencies();const target=join(dirname(dependency.record),'tree',relative(cap.source,origin));
            if(!dependency.image.entries.some(item=>item.path===relative(cap.source,origin)&&item.kind==='directory')){
              if(!onlyBuildOutputs(source))throw Error('oracle dependency directory was not captured: '+source);
              directories.add(source);mkdirSync(destination(source),{recursive:true});
              for(const name of this.filesystem.runtimeEntries(source))copy(join(source,name));
              return;
            }
            const project=(origin:string,output:string,target:string)=>{
              const emitted=job.groups.flatMap(group=>job.files.get(group)??[]).some(file=>inside(file,origin));
              if(emitted&&this.filesystem.directoryExists(origin)){
                mkdirSync(output,{recursive:true});
                for(const name of this.filesystem.runtimeEntries(origin))project(join(origin,name),join(output,name),join(target,name));
              }else{mkdirSync(dirname(output),{recursive:true});symlinkSync(target,output);links.push({output:relative(job.directory,output),target:'@dependencies/'+relative(join(dirname(dependency!.record),'tree'),target)});}
            };
            project(source,destination(source),target);completeNamespaces.add(source);return;
          }
        }
        directories.add(source);mkdirSync(destination(source),{recursive:true});
        if(modules){
          for(const name of packages){
            const file=join(source,name);
            if(!this.filesystem.directoryExists(file)&&!this.filesystem.fileExists(file))continue;
            if(name.startsWith('@')){const scope=dirname(file);directories.add(scope);mkdirSync(destination(scope),{recursive:true});}
            copy(file);
          }
        }else for(const name of this.filesystem.runtimeEntries(source))copy(join(source,name));
      }else{
        if(this.filesystem.runtimeKind(source)!=='file')throw Error('oracle unsupported runtime asset kind: '+source);
        const bytes=this.filesystem.readBytes(source);if(bytes===null)throw Error('oracle runtime asset disappeared: '+source);put(source,bytes);
      }
    };
    {
      // A checking owner's other roots and arbitrary sibling directories are
      // not runtime inputs. Start with the selected checker closure, including
      // its JavaScript edges, rather than recursively copying project roots.
      const edges=new Map(job.groups.flatMap(group=>sourceEdges(this.contexts.get(group)!.record!)).map(edge=>[edge.file,edge]));
      const emitted=new Map(job.groups.flatMap(group=>Object.entries(group.emitted).map(([source,output])=>[source,join(group.output,output)] as const)));
      const emittedOrigins=new Set([...emitted].map(([source,output])=>source.slice(0,-extname(source).length)+extname(output)));
      const selected=new Set([job.entry,...job.groups.flatMap(group=>job.files.get(group)??[])]),queue=[...selected];
      while(queue.length){
        const file=queue.pop()!;
        const companion=sourceAssetPath(file,job.request.sourceAssets??[]);
        if(companion){
          const present=this.filesystem.fileExists(companion);this.filesystem.directoryExists(companion);this.filesystem.readlink(companion);
          if(present&&!selected.has(companion)){selected.add(companion);queue.push(companion);}
        }
        for(const item of edges.get(file)?.imports??[]){
          const path=item.resolved?.resolvedFileName;
          if(!path||/\.d\.[cm]?ts$/.test(path)||/\.[cm]?tsx?$/.test(path)||path.includes(sep+'node_modules'+sep))continue;
          const target=this.filesystem.realpath(path);
          if(!selected.has(target)){selected.add(target);queue.push(target);}
        }
        // Resolve the spellings Node executes, including TypeScript's .ts
        // extension rewrites. Exact missing targets are recorded absences;
        // unrelated siblings remain outside this finite closure.
        const javascript=emitted.get(file);
        if(javascript||/\.[cm]?jsx?$/.test(file)){
          const text=javascript?readFileSync(javascript,'utf8'):this.filesystem.readFile(file);
          if(text!==null){
            const lease=this.api.createSourceFile(javascript??file,text);
            try{for(const literal of lease.sourceFile.imports){
              if(!('text' in literal)||typeof literal.text!=='string'||!literal.text.startsWith('.'))continue;
              let path:string;try{path=fileURLToPath(new URL(literal.text,pathToFileURL(file)));}catch{continue;}
              this.filesystem.fileExists(path);this.filesystem.directoryExists(path);this.filesystem.readlink(path);
              if(emittedOrigins.has(path))continue;
              if(!this.filesystem.fileExists(path)||/\.[cm]?tsx?$/.test(path))continue;
              const target=this.filesystem.realpath(path);
              if(!selected.has(target)){selected.add(target);queue.push(target);}
            }}finally{lease.dispose();}
          }
        }
      }
      for(const file of selected){
        if(![...roots].some(root=>inside(file,root)))roots.add(dirname(file));
        for(let directory=dirname(file);[...roots].some(root=>inside(directory,root));directory=dirname(directory)){
          if(!this.filesystem.directoryExists(directory))throw Error('oracle runtime parent disappeared: '+directory);
          directories.add(directory);mkdirSync(destination(directory),{recursive:true});
          if(directory===dirname(directory))break;
        }
        copy(file);
      }
    }
    for(const {physical} of declared)copy(physical);
    for(const {source,physical} of declared){
      if(source!==physical){
        const output=destination(source),target=destination(physical);
        mkdirSync(dirname(output),{recursive:true});
        if(existsSync(output))throw Error('oracle runtime alias namespace is occupied: '+source);
        symlinkSync(relative(dirname(output),target),output);
        links.push({output:relative(job.directory,output),target:'@runtime/'+relative(job.directory,target)});
      }
    }
    // Every scope lookup, including absent nearer scopes, is an observation.
    const scopes=new Set<string>();
    for(const source of [...directories,...roots,...job.groups.flatMap(group=>job.files.get(group)??[])]){
      for(let directory=this.filesystem.directoryExists(source)?source:dirname(source);;directory=dirname(directory)){
        if(scopes.has(directory))break;scopes.add(directory);
        const modules=join(directory,'node_modules');
        if(this.filesystem.directoryExists(modules)&&!links.some(link=>link.output===relative(job.directory,destination(modules)))){copyRoots.add(modules);copy(modules);}
        const file=join(directory,'package.json');
        if(this.filesystem.fileExists(file)){
          const bytes=this.filesystem.readBytes(file);
          if(bytes!==null)put(file,bytes);
        }
        if(directory===dirname(directory))break;
      }
    }
    // Package namespaces are selected after all program roots have supplied
    // their literal requests. A package can add requests for its dependencies.
    for(let changed=true;changed;){
      changed=false;
      for(const [source,seen] of moduleNamespaces){
        if(completeNamespaces.has(source))continue;
        const pending=[...packages].filter(name=>!seen.has(name));
        if(!pending.length)continue;
        changed=true;pending.forEach(name=>seen.add(name));visited.delete(source);copy(source,true);
      }
    }
    for(const source of moduleNamespaces.keys())if(!visited.has(source))unobserved.add(source);
    {
      const emitted=job.groups.flatMap(group=>Object.entries(group.emitted).map(([source,output])=>source.slice(0,-extname(source).length)+extname(output)));
      const captured=new Set([...emitted,...directories,...[...copied.keys()].map(file=>resolve(parse(job.entry).root,relative(tree,file))),...links.map(link=>resolve(parse(job.entry).root,relative(tree,join(job.directory,link.output))))]);
      for(const directory of directories)for(const name of this.filesystem.runtimeEntries(directory)){
        const file=join(directory,name);if(!captured.has(file))unobserved.add(file);
      }
    }
    // An empty package scope has no type and preserves Node syntax detection,
    // while stopping an unrelated scratch ancestor's package from leaking in.
    const shield=join(tree,'package.json');if(!copied.has(shield))writeFileSync(shield,'{}\n');
    const files:{source:string;output:string;group:string;execution:string;tree:string}[]=[],sources:Record<string,string>={};
    for(const group of job.groups)for(const [source,output] of Object.entries(group.emitted)){
      const file=join(group.output,output),bytes=readFileSync(file);
      if(!(job.files.get(group)??[]).includes(source))throw Error('oracle emitted source is outside its captured program: '+source);
      const original=destination(source),execution=original.slice(0,-extname(source).length)+extname(file),route=relative(job.directory,execution),previous=sources[source];
      if(previous&&(previous!==route||hash(readFileSync(join(job.directory,previous)))!==hash(bytes)))throw Error('oracle conflicting emitted TypeScript source: '+source);
      if(previous)continue;
      mkdirSync(dirname(execution),{recursive:true});writeFileSync(execution,bytes);
      const map=group.maps[output];
      if(map?.kind==='file'){
        const target=execution+'.oracle.map';
        if(existsSync(target))throw Error('oracle runtime source-map namespace is occupied: '+target);
        if(map.input.sha256!==null)writeFileSync(target,readFileSync(join(group.output,map.output)));
      }
      sources[source]=route;files.push({source,output:relative(job.directory,file),group:relative(job.directory,group.output),execution:route,tree:root});
    }
    const paths:string[]=[];let bytes=0,allocatedBytes=lstatSync(tree).blocks*512,regularFiles=0;
    const inventory=(directory:string)=>{for(const item of readdirSync(directory,{withFileTypes:true})){const file=join(directory,item.name),info=lstatSync(file);allocatedBytes+=info.blocks*512;if(info.isFile()){bytes+=info.size;regularFiles++;}paths.push(relative(tree,file));if(item.isDirectory())inventory(file);}};
    inventory(tree);
    // Logical corpus paths keep their realpath relation inside the capture.
    // The read guard also knows every captured descendant through each alias.
    for(const link of links)if(link.target.startsWith('@runtime/')&&link.text===undefined){
      const alias=relative(tree,join(job.directory,link.output)),target=relative(tree,join(job.directory,link.target.slice('@runtime/'.length)));
      for(const path of [...paths])if(path.startsWith(target+sep))paths.push(alias+path.slice(target.length));
    }
    if(dependency){
      this.filesystem.readBytes(join(dependency.image.source,'pnpm-lock.yaml'));
    }
    const original=(file:string)=>resolve(parse(job.entry).root,relative(tree,file));
    const aliases=links.filter(link=>link.target.startsWith('@runtime/')).map(link=>({path:original(join(job.directory,link.output)),target:original(join(job.directory,link.target.slice('@runtime/'.length)))}));
    const identity=capturedModuleIdentity(aliases),owner=(path:string)=>{const key=identity(path);if(key===null)throw Error('oracle coverage has a cyclic module identity: '+path);return key;};
    const packageFacts=new Map<CapturedModulePath,RuntimeCoverage['packages'][number]>();
    for(const [file,sha256] of copied)if(basename(file)==='package.json'){
      const directory=owner(original(dirname(file))),fact={directory,sha256,...capturedPackageMetadata(dirname(file))},previous=packageFacts.get(directory);
      if(previous&&JSON.stringify(previous)!==JSON.stringify(fact))throw Error('oracle conflicting package owner: '+directory);
      packageFacts.set(directory,fact);
    }
    const canonical=(paths:Iterable<string>)=>[...new Set([...paths].map(owner))].sort();
    const relevantExcluded=new OraclePathPrefixes([...this.outputRoots.overlapping(copyRoots),...localExcluded.overlapping(copyRoots),...unobserved]);
    const coverage:RuntimeCoverage={version:3,recipe:ORACLE_NODE_RESOLUTION_RECIPE,aliases,roots:canonical([...roots].filter(root=>directories.has(root))),excluded:canonical(relevantExcluded.paths),directories:canonical(directories),packages:[...packageFacts.values()].sort((a,b)=>a.directory.localeCompare(b.directory,'en'))};
    const usage=process.cpuUsage(cpu);
    return {root,files,sources,paths,links,coverage,dependency,cost:{wallMs:performance.now()-began,cpuUsec:usage.user+usage.system,bytes,allocatedBytes,regularFiles}};
  }
  private runtimeTrees(job:Job){
    const localOutputRoots=new OraclePathPrefixes(job.request.outputRoots??[]);
    for(const source of [job.entry,...job.groups.flatMap(group=>job.files.get(group)??[]),...(job.project?[job.project]:[])])
      if(this.outputRoots.has(source)||localOutputRoots.has(source))throw Error('oracle output namespace overlaps source input: '+source);
    const groups=job.ownerOrder;
    const trees=[this.runtimeTree({...job,groups},job.request.runtimeRoots||!groups.length?'application':'owners')];
    const sources:Record<string,string>={};
    for(const tree of trees)for(const [source,execution] of Object.entries(tree.sources)){
      const previous=sources[source];
      if(previous&&hash(readFileSync(join(job.directory,previous)))!==hash(readFileSync(join(job.directory,execution))))throw Error('oracle conflicting emitted TypeScript source: '+source);
      sources[source]??=execution;
    }
    return {trees:trees.map(tree=>({root:tree.root,paths:tree.paths,coverage:tree.coverage})),files:trees.flatMap(tree=>tree.files),links:trees.flatMap(tree=>tree.links),sources,dependency:trees.find(tree=>tree.dependency)?.dependency,
      application:trees.find(tree=>tree.root==='tree/application')?.cost};
  }
  private async publish(jobs:Job[],run:CompilerResult):Promise<OraclePrepared[]>{
    const publicationBegan=performance.now(),publicationCpu=process.cpuUsage();
    const trees=new Map<Job,ReturnType<OracleWorker['runtimeTrees']>>();
    const inputs:Record<string,string>={};
    if(this.closed)throw Error('oracle preparation canceled before publication');
    for(const job of jobs)for(const group of job.groups){
      if(group.compilerStatus!==0)throw Error('oracle TypeScript project did not complete: '+group.project);
      sourceMaps(group,this.filesystem,this.contexts.get(group)!.producerOutput);
      if(!emittedPath(group,group.entry))throw Error('oracle TypeScript did not emit '+group.entry);
    }
    for(const job of jobs)trees.set(job,this.runtimeTrees(job));
    for(const job of jobs)for(const file of job.request.declarations?.absent??[])
      if(this.filesystem.readlink(file)!==null||this.filesystem.fileExists(file)||this.filesystem.directoryExists(file))throw Error('oracle declared absent input appeared: '+file);
    const localExcluded=new OraclePathPrefixes([this.ownerCache,...jobs.flatMap(job=>[job.request.directory,...job.request.outputRoots??[]])]);
    const observations=this.filesystem.captured(path=>this.outputRoots.has(path)||localExcluded.has(path));
    const validation=validateHostObservations(observations);
    for(const observation of observations)if(observation.kind==='file'&&typeof observation.value==='string')inputs[observation.path]=observation.value;
    const pending:OraclePrepared[]=[];
    for(const job of jobs){
      const {directory}=job,assets=join(directory,'assets');mkdirSync(assets);
      for(const file of ORACLE_RUNTIME_FILES){
        const target=join(assets,file);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,readFileSync(join(HERE,file)));
      }
      writeFileSync(join(assets,'package.json'),'{"type":"module"}\n');
      const outputs:Record<string,string>={};
      const tree=trees.get(job)!,sources=tree.sources;
      const imports=job.groups.flatMap(group=>ownerImports(this.contexts.get(group)!.record!).filter(item=>this.contexts.get(group)!.targets.has(item.file)).map(item=>{
        const target=this.filesystem.realpath(item.target),project=this.projectFor(job,target),execution=sources[target];
        if(!execution||!project||!sources[item.file])throw Error('oracle package TypeScript route has no owner output: '+item.file+' -> '+item.specifier);
        return {file:item.file,specifier:item.specifier,target,project:this.filesystem.realpath(project),execution,relationSha256:item.relationSha256};
      }));
      for(const group of job.groups){
        for(const file of entries(group.output))outputs[relative(directory,file)]=hash(readFileSync(file));
      }
      for(const runtime of tree.trees)for(const file of entries(join(directory,runtime.root)))if(!tree.links.some(link=>join(directory,link.output)===file))outputs[relative(directory,file)]=hash(readFileSync(file));
      for(const source of Object.keys(sources))if(inputs[source]!==hash(readFileSync(source)))throw Error('oracle emitted source has no matching filesystem observation: '+source);
      const runtimeTrees=tree.trees.map(tree=>({...tree,absent:(job.request.declarations?.absent??[]).map(file=>relative(parse(file).root,file)).filter(file=>!tree.paths.includes(file))}));
      const checkerImports=job.groups.flatMap(group=>this.contexts.get(group)!.record!.checkerImports.filter(item=>this.contexts.get(group)!.targets.has(item.file)));
      const runtimeIndex={trees:runtimeTrees,files:tree.files,links:tree.links,checkerImports};
      const index=Buffer.from(JSON.stringify({version:9,...runtimeIndex})+'\n');
      writeFileSync(join(directory,'source-index.json'),index);outputs['source-index.json']=hash(index);
      const manifest=join(directory,'manifest.json'),loaderState=join(directory,'loader-state.json');
      const groups=job.groups.map(group=>({...group,output:relative(directory,group.output),compilerOutputs:group.compilerOutputs.map(file=>relative(directory,file)),
        sourceInventory:group.sourceInventory.map(file=>({...file,path:file.path.startsWith(this.snapshot+sep)?'@toolchain/'+relative(this.snapshot,file.path):file.path})),
        options:{...group.options,...emitOptions(relative(directory,group.output),group.options)}}));
      const declaration=job.request.declarations;
      const declarations=declaration?JSON.stringify(declaration):undefined;
      if(declaration)for(const [file,expected] of Object.entries(declaration.files))if(hash(readFileSync(file))!==expected)throw Error('oracle declared input changed during preparation: '+file);
      if(declaration){for(const file of declaration.absent)if(existsSync(file))throw Error('oracle declared absent input appeared: '+file);}
      const identity={...this.identity,...(declarations?{declarationsSha256:hash(declarations)}:{})};
      const preloads=(job.request.preloads??[]).map(item=>this.filesystem.realpath(resolve(typeof item==='string'?item:item.entry)));
      const stored:OracleManifest={version:3,preloads,imports,observations,status:'complete',identity,...(tree.dependency?{dependencies:{semanticSha256:tree.dependency.sha256,nodeVersion:process.versions.node}}:{}),entry:job.entry,project:job.project,roots:job.request.roots?.map(path=>this.filesystem.realpath(path))??null,groups,inputs,outputs,sources,...(declarations?{declarations}:{})};
      try{writeFileSync(join(directory,'validation.json'),JSON.stringify(validation)+'\n');}catch{/* Missing cost evidence is not a semantic verdict. */}
      writeFileSync(join(directory,'emit.stdout'),run.stdout);writeFileSync(join(directory,'emit.stderr'),run.stderr);
      const raw=process.env.NTS_ORACLE_DEPENDENCIES,cap=raw?JSON.parse(raw):null,scope=cap&&ownerRunScope(cap);
      const owner=scope?JSON.parse(process.env.NTS_GATE_ENV_CONTEXT??'null')?.resolutionOwner:undefined;
      if(scope&&(!owner||!nodeProcessAlive(owner)))throw Error('oracle resolution run owner is missing or changed');
      const sessionDirectory=scope?join(scope.directory,'oracle-resolution','node-'+process.versions.node):join(directory,'resolution');
      stored.runtimeIndex=await publishRuntimeSnapshot(directory,stored,runtimeIndex,this.api,sessionDirectory,owner?.pid??this.resolutionOwnerPid,tree.dependency);
      const manifestBytes=Buffer.from(JSON.stringify(stored,null,2)+'\n');
      writeFileSync(manifest+'.pending',manifestBytes);
      const snapshot:OracleSnapshotIdentity={version:1,index:stored.runtimeIndex,manifestSha256:hash(manifestBytes),assets:stored.runtimeAssets};
      pending.push({manifest,loaderState,identity,snapshot,args:JSON.parse(readFileSync(fileURLToPath(new URL('./oracle-toolchain.json',import.meta.url)),'utf8')).execution.args,
        env:{NTS_ORACLE_EMIT_MANIFEST:manifest,NTS_ORACLE_EMIT_STATUS:loaderState,NTS_ORACLE_TYPESCRIPT:this.binding.root,NTS_ORACLE_SNAPSHOT:JSON.stringify(snapshot)}});
    }
    // Conflicting roots, changed declarations or a missing output invalidate
    // the whole batch before any member becomes consumable.
    validateHostObservations(observations);
    for(const prepared of pending){
      const directory=dirname(prepared.manifest);
      for(const file of ['tree','runtime-index','assets'])protect(join(directory,file));
      const stored:OracleManifest=JSON.parse(readFileSync(prepared.manifest+'.pending','utf8'));
      for(const group of stored.groups)protect(join(directory,group.output));
      renameSync(prepared.manifest+'.pending',prepared.manifest);
    }
    const publicationUsage=process.cpuUsage(publicationCpu);
    const publication={wallMs:performance.now()-publicationBegan,cpuUsec:publicationUsage.user+publicationUsage.system,scope:'whole batch publication including all runtime copies, inventories, output hashing and both host replays; own process only'};
    for(const job of jobs){
      const application=trees.get(job)!.application;if(!application)continue;
      const index=readFileSync(join(job.directory,'source-index.json'));
      writeFileSync(join(job.directory,'application-capture.json'),JSON.stringify({version:1,sourceIndexSha256:hash(index),treeCopy:application,publication,
        wallMs:publication.wallMs,cpuUsec:publication.cpuUsec,bytes:application.bytes,allocatedBytes:application.allocatedBytes,regularFiles:application.regularFiles})+'\n');
    }
    return pending;
  }
  /** All preparation uses the same asynchronous batch path. Schedulers can
   * continue draining existing child pipes during compiler and probe work. */
  async prepare(request:OracleOptions):Promise<OraclePrepared>{
    const [prepared]=await this.prepareBatch([request],invoke);
    if(!prepared)throw Error('oracle request did not publish its prepared member');
    return prepared;
  }
  /** No program starts while its batch is preparing. No late ready publication. */
  async prepareBatch(requests:OracleOptions[],run:OracleCompilerRun,signal?:AbortSignal):Promise<[OraclePrepared,...OraclePrepared[]]>{
    if(this.busy)throw Error('oracle preparation worker is busy');
    if(requests.length<1||requests.length>8)throw Error('oracle batch must have 1..8 members');
    if(signal?.aborted)throw Error('oracle preparation canceled before start');
    this.busy=true;
    try{
      this.reset();
      const jobs:Job[]=[],failures:unknown[]=[],results:(CompilerResult&{status:number})[]=[];
      for(const request of requests){try{jobs.push(this.stage(request));}catch(error){failures.push(error);}}
      for(const job of jobs){let project:string|undefined;try{
      for(;;){for(const group of job.groups){
        if(this.contexts.get(group)!.record)continue;
        if(signal?.aborted)throw Error('oracle preparation canceled before project start');
        project=group.project;
        const args=this.command(group),cwd=dirname(group.project),started=performance.now();
        const result=await run(process.execPath,args,cwd);
        writeFileSync(join(dirname(group.output),'command.json'),JSON.stringify({compiler:process.execPath,args,cwd,status:result.status,wallMs:performance.now()-started})+'\n');
        writeFileSync(join(dirname(group.output),'compiler.stdout'),result.stdout);writeFileSync(join(dirname(group.output),'compiler.stderr'),result.stderr);
        const completed=this.completed(result);results.push(completed);this.acceptProgram(group,completed);
      }
      for(const group of job.groups)if(this.contexts.get(group)!.record)this.expandOwners(job,group);
      if(job.groups.every(group=>{const context=this.contexts.get(group)!;return context.record&&[...context.targets].every(file=>context.expanded.has(file));}))break;
      }
      this.finishOwners(job);
      }catch(error){
        failures.push(error);
        try{writeFileSync(join(job.directory,'member-result.json'),JSON.stringify({entry:job.entry,project,status:error instanceof TypeScriptDiagnosticError?'diagnostic':'instrument',reason:String(error),...(error instanceof TypeScriptDiagnosticError?{compilerStatus:error.status,diagnostics:error.diagnostics}:{})})+'\n');}catch(recordError){failures.push(recordError);}
      }}
      if(signal?.aborted)throw Error('oracle preparation canceled before publication');
      if(failures.length){
        for(const error of failures)if(!(error instanceof TypeScriptDiagnosticError))throw error;
        throw new TypeScriptDiagnosticError(2,failures.map(error=>(error as TypeScriptDiagnosticError).diagnostics).join('\n'));
      }
      return await this.publish(jobs,this.combine(results)) as [OraclePrepared,...OraclePrepared[]];
    }finally{this.busy=false;this.finishClose();}
  }
  private completed(result:CompilerResult):CompilerResult&{status:number}{
    if(result.status===null||!Number.isInteger(result.status)||result.status<0||result.status>255)
      throw Error('oracle TypeScript emit not measured: invalid compiler exit status '+String(result.status));
    return {...result,status:result.status};
  }
  private combine(results:(CompilerResult&{status:number})[]):CompilerResult{
    const failed=results.find(run=>run.status!==0);
    return {status:failed?failed.status:0,stdout:results.map(run=>run.stdout).join(''),stderr:results.map(run=>run.stderr).join('')};
  }
}

function emittedPath(group:EmitGroup,file:string):string|null{
  if(!group.output)return null;
  const output=group.emitted[file];return output?join(group.output,output):null;
}

/** The caller owns all output lifetimes, just as its existing scratch. */
export async function prepareOracle(request:OracleOptions,resolutionOwnerPid=process.pid):Promise<OraclePrepared>{
  const worker=new OracleWorker(request.directory,request.toolchain,[],resolutionOwnerPid);
  try{return await worker.prepare(request);}finally{worker.close();}
}

runAsCommand(import.meta.url,async()=>{
  if(process.argv[2]==='--read-program-reference'&&process.argv[3]){
    const {readProgramOracleReference}=await import('./oracle-results.ts');
    const request=JSON.parse(process.argv[3]);
    const value=readProgramOracleReference(request);
    process.stdout.write(JSON.stringify(value)+'\n');
  }
  else if(process.argv[2]==='--emit-program'&&process.argv[3]&&process.argv[4]){
    const record=emitProgram(process.argv[3],process.argv[4]);process.stdout.write(JSON.stringify(record)+'\n');process.exitCode=record.instrument?1:record.emitSkipped||record.diagnostics?2:0;
  }
  else if(process.argv[2]==='--identity')process.stdout.write(JSON.stringify(oracleIdentity())+'\n');
  else if(process.argv[2]==='--prepare'&&process.argv[3]&&process.argv[4])
    process.stdout.write(JSON.stringify(await prepareOracle({entry:process.argv[3],directory:process.argv[4],project:process.argv[5]},process.ppid))+'\n');
  else if(process.argv[2]==='--finish-snapshot'&&process.argv[3]){
    const result=finishOracleSnapshot(JSON.parse(process.argv[3]));
    process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=result.ready?0:1;
  }
  else if(process.argv[2]==='--run'&&process.argv[3]&&process.argv[4]){
    const snapshotOwner=await prepareOracle({entry:process.argv[3],directory:process.argv[4]});
    let prepared:OraclePrepared|undefined;
    const finish=()=>{const result=finishOracleSnapshot(snapshotOwner);if(!result.ready)throw Error(result.why);};
    try{
    prepared=oracleExecution(snapshotOwner);
    const child=spawnSync(process.execPath,[...prepared.args,process.argv[3]],{stdio:'inherit',env:{...process.env,...prepared.env}});
    finish();
    const loader=oracleLoaderReady(prepared);
    if(!loader.ready)throw Error('oracle execution not measured: '+loader.why);
    if(child.error)throw child.error;
    if(child.signal)throw Error('oracle execution not measured: '+child.signal);
    process.exitCode=child.status;
    }finally{try{finish();}finally{if(prepared)closeOracleExecution(prepared);}}
  }
  else throw Error('usage: oracle-emit.ts --identity | --prepare <entry.ts> <owned directory> [tsconfig.json]');
});
