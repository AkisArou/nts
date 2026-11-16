// Build-only material retains exact source answers until publication. The
// committed wire format and its Node-only reader live in rust-selector-record.ts.
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,readlinkSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {OracleFilesystem,readHostObservation} from '../differential/oracle-filesystem.ts';
import {sameOracleObservation,validateRuntimeObservations,type HostObservation} from '../differential/oracle-runtime.ts';
import type {Capture,TypeScriptIdentity} from '../differential/oracle-toolchain.ts';
import type {RustSelectorRoles} from './rust-selector-roles.ts';
import type {ReaderDependency} from './reader-observations.ts';
import type {RustRuntimeTarget} from './rust-runtime-declarations.ts';
import {matchesModuleMember,READER_PROTOCOLS,type ReaderProtocol} from './reader-inputs/main.ts';
import {metadataParents} from './reader-metadata.ts';
import {changedCargoInputName} from './cargo-input-population.ts';
import {projectDiscoveryOwner,projectRequest,type ProjectMatch} from './project-discovery.ts';

export const RUST_SELECTOR_RECORD='results/gate-inputs/rust-runtime.json';
const SCHEMA='rust-runtime-selector/2:portable-anchors,file-mode-bytes-hash,positive-alias-facts,typed-exact-answers,rust-candidates,tracked-populations,native-config-matches,observation-selection-roles';
export const selectorHash=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value,(_key:string,item:unknown)=>{
  if(item&&typeof item==='object'&&!Array.isArray(item))return Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b,'en')));
  return item;
})).digest('hex');
export const SELECTOR_SCHEMA_SHA256=selectorHash(SCHEMA);
export type PortablePath={root:'source'|'sdk'|'sdk-native';path:string}|{root:'source-parent';levels:number;path:string};
export type SelectorRoots={source:string;sdk:string;native:string};
export type SelectorFile={path:PortablePath;mode:number;bytes:number;sha256:string;linkText?:string;
  identity?:{path:PortablePath;aliases:{path:PortablePath;text:string}[]}};
export type SelectorFact={kind:HostObservation['kind'];path:PortablePath;value:HostObservation['value']|PortablePath};
export type TrackedFile={path:string;mode:string};
export type TrackedPopulation={directory:string;member?:string;files:TrackedFile[]};
export type RustSelectorMaterialTarget={target:RustRuntimeTarget;roles:RustSelectorRoles};
export type RustSelectorMaterialKey={engine:SelectorFile[];declarations:SelectorFile;cargo:{inputs:SelectorFile[];targets:RustRuntimeTarget[]};
  sdk:TypeScriptIdentity;files:SelectorFile[];facts:SelectorFact[];projects:ProjectMatch[];candidates:{reader:string;path:string;present:boolean}[];populations:TrackedPopulation[]};
export type RustSelectorMaterial={version:1;schemaSha256:string;key:RustSelectorMaterialKey;targets:RustSelectorMaterialTarget[];keySha256:string;targetsSha256:string};
export type SelectorPending={kind:string;path:string;reason:string};
export type SelectorRead={state:'current';targets:RustSelectorMaterialTarget[]}|{state:'pending';pending:SelectorPending};
export class MalformedRustSelectorMaterial extends Error{
  constructor(message:string){super('Rust selector record malformed: '+message);this.name='MalformedRustSelectorMaterial';}
}
function fail(message:string):never{throw new MalformedRustSelectorMaterial(message);}
function object(value:unknown,names:readonly string[],where:string):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))fail(where+' is not an object');
  const row=value as Record<string,unknown>;
  for(const name of Object.keys(row))if(!names.includes(name))fail(where+' has unknown field '+name);
  return row;
}
const list=(value:unknown,where:string):unknown[]=>{if(!Array.isArray(value))fail(where+' is not an array');return value;};
function local(value:unknown,where:string,empty=false):string{
  if(typeof value!=='string'||/[\\\x00-\x1f]/.test(value)||value.startsWith('/')||!empty&&!value||
    value!==''&&value.split('/').some(part=>!part||part==='.'||part==='..'))fail(where+' is not a canonical relative path');
  return value;
}
function string(value:unknown,where:string):string{if(typeof value!=='string'||!value||/[\x00-\x1f]/.test(value))fail(where+' is not text');return value;}
function boolean(value:unknown,where:string):boolean{if(typeof value!=='boolean')fail(where+' is not boolean');return value;}
function integer(value:unknown,where:string,max=Number.MAX_SAFE_INTEGER):number{if(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>max)fail(where+' is not an unsigned integer');return Number(value);}
function digest(value:unknown,where:string):string{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail(where+' is not SHA256');return value;}
function anchor(value:unknown):PortablePath{
  const row=object(value,['root','path','levels'],'anchor'),path=local(row.path,'anchor path',true);
  if(row.root==='source-parent'){
    const levels=integer(row.levels,'anchor levels',256);
    if(levels<1||!path||path.includes('/'))fail('source-parent is not an ancestor probe');
    return {root:row.root,levels,path};
  }
  if(!['source','sdk','sdk-native'].includes(String(row.root))||row.levels!==undefined)fail('unknown anchor root');
  return {root:row.root as 'source'|'sdk'|'sdk-native',path};
}
export function selectorPath(roots:SelectorRoots,path:string):PortablePath{
  if(!isAbsolute(path))throw Error('Rust selector projection has a non-absolute input: '+path);
  for(const [kind,root]of [['sdk',roots.sdk],['sdk-native',roots.native],['source',roots.source]] as const){
    const name=relative(root,path).split(sep).join('/');
    if(name!=='..'&&!name.startsWith('../')&&!isAbsolute(name))return {root:kind,path:name};
  }
  let parent=roots.source;
  for(let levels=1;;levels++){
    const next=dirname(parent);if(next===parent)break;parent=next;
    if(dirname(path)===parent)return {root:'source-parent',levels,path:path.slice(parent.length+(parent===sep?0:1))};
  }
  throw Error('Rust selector projection has an unsupported external input: '+path);
}
export function resolveSelectorPath(roots:SelectorRoots,path:PortablePath):string{
  if(path.root==='source-parent'){
    let parent=roots.source;for(let count=0;count<path.levels;count++){
      const next=dirname(parent);if(next===parent)fail('source-parent exceeds root ancestry');parent=next;
    }
    return join(parent,path.path);
  }
  return join(path.root==='source'?roots.source:path.root==='sdk'?roots.sdk:roots.native,path.path);
}
export function selectorFile(roots:SelectorRoots,path:string):SelectorFile{
  const portable=selectorPath(roots,path);
  const owner=portable.root==='source'?roots.source:portable.root==='sdk'?roots.sdk:portable.root==='sdk-native'?roots.native:dirname(path);
  let parentError:unknown;try{metadataParents(owner,path,'Rust selector input');}catch(error){parentError=error;}
  const logical=lstatSync(path);let physical=path,identity:SelectorFile['identity'];
  if(parentError||logical.isSymbolicLink()){
    const filesystem=new OracleFilesystem(),resolved=filesystem.inputIdentity(path,owner);
    if(resolved.state!=='resolved')throw Error('Rust selector input identity is unresolved: '+path);
    const endpoint=selectorPath(roots,resolved.path);
    if(endpoint.root==='source-parent')throw Error('Rust selector alias endpoint is outside owned source/SDK roots: '+path);
    const targetRoot=endpoint.root==='source'?roots.source:endpoint.root==='sdk'?roots.sdk:roots.native;
    metadataParents(targetRoot,resolved.path,'Rust selector endpoint');
    const aliases=filesystem.captured().filter(row=>row.kind==='readlink'&&typeof row.value==='string')
      .map(row=>({path:selectorPath(roots,row.path),text:String(row.value)}));
    if(parentError&&!aliases.length)throw parentError;
    identity={path:endpoint,aliases};physical=resolved.path;
  }
  const info=lstatSync(physical);if(!info.isFile()||info.isSymbolicLink())throw Error('Rust selector input is not an owned regular file: '+path);
  const bytes=readFileSync(physical);
  return {path:portable,mode:info.mode,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),
    ...(logical.isSymbolicLink()?{linkText:readlinkSync(path,'utf8')}:{}),...(identity?{identity}:{})};
}
export function selectorFact(roots:SelectorRoots,row:HostObservation):SelectorFact{
  // Real mtimes cannot be projected into a different checkout. Do not silently
  // normalize them or convert a stat into weaker names/type evidence.
  if(row.kind==='stat')throw Error('Rust selector projection has a nonportable stat input: '+row.path);
  return {kind:row.kind,path:selectorPath(roots,row.path),value:row.kind==='realpath'?selectorPath(roots,String(row.value)):structuredClone(row.value)};
}
function restoreFact(roots:SelectorRoots,row:SelectorFact):HostObservation{
  return {kind:row.kind,path:resolveSelectorPath(roots,row.path),value:row.kind==='realpath'?resolveSelectorPath(roots,row.value as PortablePath):row.value as HostObservation['value']};
}
export function selectorPopulation(row:Pick<TrackedPopulation,'directory'|'member'>,tracked:readonly TrackedFile[]):TrackedPopulation{
  const prefix=row.directory?row.directory+'/' :'',member=row.member;
  return {...row,files:tracked.filter(file=>file.path.startsWith(prefix)&&(!member||matchesModuleMember(file.path.slice(prefix.length),member)))
    .map(file=>({...file})).sort((a,b)=>a.path.localeCompare(b.path,'en'))};
}
function file(value:unknown):SelectorFile{
  const row=object(value,['path','mode','bytes','sha256','linkText','identity'],'file');
  const result:SelectorFile={path:anchor(row.path),mode:integer(row.mode,'file mode',0xffffffff),bytes:integer(row.bytes,'file bytes'),sha256:digest(row.sha256,'file hash')};
  if(row.linkText!==undefined)result.linkText=string(row.linkText,'link text');
  if(row.identity!==undefined){
    const identity=object(row.identity,['path','aliases'],'file identity'),path=anchor(identity.path);
    if(path.root==='source-parent')fail('file identity is outside owned roots');
    result.identity={path,aliases:list(identity.aliases,'file aliases').map(value=>{
      const alias=object(value,['path','text'],'file alias');return {path:anchor(alias.path),text:string(alias.text,'alias text')};
    })};
  }
  return result;
}
function target(value:unknown):RustRuntimeTarget{
  const row=object(value,['source','name','kind','unitTests','doctests'],'Cargo target');
  const kind=list(row.kind,'Cargo kinds').map(value=>string(value,'Cargo kind'));
  if(!kind.length||new Set(kind).size!==kind.length)fail('invalid Cargo kinds');
  return {source:local(row.source,'Cargo source'),name:string(row.name,'Cargo name'),kind,
    unitTests:boolean(row.unitTests,'unitTests'),doctests:boolean(row.doctests,'doctests')};
}
function context(value:unknown):ReaderDependency['context']{
  const row=object(value,['entry','dataNamespaces'],'reader context'),entry=row.entry==='<entry>'?'<entry>':local(row.entry,'context entry');
  const dataNamespaces:Record<string,string>={};
  if(!row.dataNamespaces||typeof row.dataNamespaces!=='object'||Array.isArray(row.dataNamespaces))fail('invalid data namespaces');
  for(const [name,owner]of Object.entries(row.dataNamespaces))Object.defineProperty(dataNamespaces,local(name,'namespace'),{value:string(owner,'namespace owner'),enumerable:true});
  return {entry,dataNamespaces};
}
const observationKinds=new Set(['file','fileExists','directoryExists','entries','realpath','readlink','runtimeEntries','runtimeKind','stat']);
function kind(value:unknown):HostObservation['kind']{if(!observationKinds.has(String(value)))fail('unknown fact kind');return value as HostObservation['kind'];}
function dependency(value:unknown):ReaderDependency{
  const row=object(value,['path','kind','bytes','directoryStat','context','observationOnly'],'dependency');
  if(row.observationOnly!==undefined&&row.observationOnly!==true)fail('invalid dependency observation-only role');
  return {path:local(row.path,'dependency path',true),kind:kind(row.kind),bytes:boolean(row.bytes,'dependency bytes'),directoryStat:boolean(row.directoryStat,'directory stat'),context:context(row.context),...(row.observationOnly?{observationOnly:true as const}:{})};
}
function roles(value:unknown):RustSelectorMaterialTarget['roles']{
  const row=object(value,['files','moduleFiles','placingFiles','directories','optionalFiles','memberships','byteInputs','typedDependencies'],'roles');
  const paths=(name:string)=>list(row[name],name).map(value=>local(value,name));
  const directories=list(row.directories,'directories').map(value=>{
    const item=object(value,['reader','directory','fileCount','kind','member','fixture','context'],'directory');
    if(!['module','data','inspection','conservative'].includes(String(item.kind)))fail('unknown directory role');
    if(item.kind==='conservative'&&(item.context===undefined||item.fixture!==undefined||item.member!==undefined))fail('conservative directory lacks an immutable reader context');
    const fixture=item.fixture===undefined?undefined:object(item.fixture,['entry','owner'],'directory fixture');
    return {reader:string(item.reader,'directory reader'),directory:local(item.directory,'directory',true),kind:item.kind as 'module'|'data'|'inspection'|'conservative',fileCount:integer(item.fileCount,'directory file count'),
      ...(item.context===undefined?{}:{context:context(item.context)}),
      ...(item.member===undefined?{}:{member:local(item.member,'member')}),...(fixture?{fixture:{entry:local(fixture.entry,'fixture entry'),owner:string(fixture.owner,'fixture owner')}}:{})};
  });
  const optionalFiles=list(row.optionalFiles,'optional files').map(value=>{
    const item=object(value,['reader','path','present','context'],'optional file');
    return {reader:string(item.reader,'optional reader'),path:local(item.path,'optional path'),present:boolean(item.present,'optional presence'),context:context(item.context)};
  });
  const memberships=list(row.memberships,'memberships').map(value=>{
    const item=object(value,['reader','directory','entries','context'],'membership');
    return {reader:string(item.reader,'membership reader'),directory:local(item.directory,'membership directory',true),context:context(item.context),entries:list(item.entries,'membership entries').map(value=>{
      const entry=object(value,['name','type'],'member'),name=local(entry.name,'member name');
      if(name.includes('/')||!['file','directory','symlink'].includes(String(entry.type)))fail('invalid member type/name');
      return {name,type:entry.type as 'file'|'directory'|'symlink'};
    })};
  });
  const byteInputs=list(row.byteInputs,'byte inputs').map(value=>{const item=object(value,['reader','path'],'byte input');return {reader:string(item.reader,'byte reader'),path:local(item.path,'byte path')};});
  const typedDependencies=list(row.typedDependencies,'typed dependencies').map(value=>{
    const item=object(value,['reader','protocol','dependency'],'typed dependency');
    if(!READER_PROTOCOLS.includes(item.protocol as ReaderProtocol))fail('unknown reader protocol');
    const protocol=item.protocol as ReaderProtocol;
    return {reader:local(item.reader,'typed reader'),protocol,dependency:dependency(item.dependency)};
  });
  return {files:paths('files'),moduleFiles:paths('moduleFiles'),placingFiles:paths('placingFiles'),directories,optionalFiles,memberships,byteInputs,typedDependencies};
}
export function parseRustSelectorMaterial(value:unknown):RustSelectorMaterial{
  const row=object(value,['version','schemaSha256','key','targets','keySha256','targetsSha256'],'record');
  if(row.version!==1||row.schemaSha256!==SELECTOR_SCHEMA_SHA256)fail('schema hash/version mismatch');
  const keySha256=digest(row.keySha256,'key hash'),targetsSha256=digest(row.targetsSha256,'targets hash');
  if(selectorHash(row.key)!==keySha256||selectorHash(row.targets)!==targetsSha256)fail('payload hash mismatch');
  const input=object(row.key,['engine','declarations','cargo','sdk','files','facts','projects','candidates','populations'],'key');
  const cargo=object(input.cargo,['inputs','targets'],'Cargo key');
  const sdk=object(input.sdk,['version','rootPackageSha256','packageSha256','nativeSha256','nativePackageSha256'],'SDK identity');
  const sdkIdentity:TypeScriptIdentity={version:string(sdk.version,'SDK version'),rootPackageSha256:digest(sdk.rootPackageSha256,'SDK root'),packageSha256:digest(sdk.packageSha256,'SDK package'),nativeSha256:digest(sdk.nativeSha256,'SDK native'),nativePackageSha256:digest(sdk.nativePackageSha256,'SDK native package')};
  const facts=list(input.facts,'facts').map(value=>{const item=object(value,['kind','path','value'],'fact'),factKind=kind(item.kind);
    if(factKind==='stat')fail('nonportable stat in projection');
    const fact:SelectorFact={kind:factKind,path:anchor(item.path),value:factKind==='realpath'?anchor(item.value):item.value as HostObservation['value']};
    const probe:HostObservation={kind:factKind,path:'/subject',value:factKind==='realpath'?'/answer':item.value as HostObservation['value']};
    try{validateRuntimeObservations([probe],()=>probe.value);}catch{fail('invalid typed '+fact.kind+' answer');}return fact;
  });
  const key:RustSelectorMaterialKey={engine:list(input.engine,'engine').map(file),declarations:file(input.declarations),cargo:{inputs:list(cargo.inputs,'Cargo inputs').map(file),targets:list(cargo.targets,'Cargo targets').map(target)},sdk:sdkIdentity,
    files:list(input.files,'files').map(file),facts,projects:list(input.projects,'project discovery').map(value=>{
      const item=object(value,['request','files'],'project discovery');let request;
      try{request=projectRequest(item.request);}catch{fail('invalid project discovery request');}
      const files=list(item.files,'matched files').map(value=>local(value,'matched file'));if(new Set(files).size!==files.length)fail('duplicate matched file');
      return {request,files};
    }),candidates:list(input.candidates,'candidates').map(value=>{
      const item=object(value,['reader','path','present'],'candidate');return {reader:local(item.reader,'candidate reader'),path:local(item.path,'candidate path'),present:boolean(item.present,'candidate presence')};
    }),populations:list(input.populations,'populations').map(value=>{
      const item=object(value,['directory','member','files'],'population');
      return {directory:local(item.directory,'population directory',true),...(item.member===undefined?{}:{member:local(item.member,'population member')}),files:list(item.files,'tracked files').map(value=>{
        const entry=object(value,['path','mode'],'tracked file'),mode=string(entry.mode,'tracked mode');if(!/^[0-7]{6}$/.test(mode))fail('invalid tracked mode');return {path:local(entry.path,'tracked path'),mode};
      })};
    })};
  const projects=new Set<string>();for(const match of key.projects){const id=JSON.stringify(match.request);if(projects.has(id))fail('duplicate project discovery');projects.add(id);}
  const targets=list(row.targets,'targets').map(value=>{const item=object(value,['target','roles'],'projected target');return {target:target(item.target),roles:roles(item.roles)};});
  if(selectorHash(targets.map(row=>row.target))!==selectorHash(key.cargo.targets))fail('projected Cargo inventory mismatch');
  return {version:1,schemaSha256:SELECTOR_SCHEMA_SHA256,key,targets,keySha256,targetsSha256};
}

/** A stale answer is pending and forces a live build; only malformed records
 * refuse. No failure path can return an unvalidated role row. */
export function validateRustSelectorMaterial(value:unknown,options:{roots:SelectorRoots;inventory:readonly RustRuntimeTarget[];tracked:readonly TrackedFile[];sdk:()=>Capture}):SelectorRead{
  const record=parseRustSelectorMaterial(value);
  const pending=(kind:string,path:string,reason:string):SelectorRead=>({state:'pending',pending:{kind,path,reason}});
  if(selectorHash(record.key.cargo.targets)!==selectorHash(options.inventory))return pending('cargo-targets','<targets>','Cargo target inventory changed');
  const changedCargo=changedCargoInputName(record.key.cargo.inputs.map(row=>row.path.root==='source'?row.path.path:JSON.stringify(row.path)),options.tracked);
  if(changedCargo!==undefined)return pending('cargo-input-population',changedCargo,'tracked Cargo input names changed');
  let installed:Capture;
  try{installed=options.sdk();}catch(error){return pending('sdk',options.roots.sdk,String(error));}
  if(installed.root!==options.roots.sdk||installed.nativeRoot!==options.roots.native)return pending('sdk',options.roots.sdk,'installed SDK anchors changed');
  if(selectorHash(installed.identity)!==selectorHash(record.key.sdk))return pending('sdk',options.roots.sdk,'installed SDK identity changed');
  for(const [kind,rows]of [['engine',record.key.engine],['declarations',[record.key.declarations]],['cargo',record.key.cargo.inputs],['file',record.key.files]] as const)for(const row of rows){
    const path=resolveSelectorPath(options.roots,row.path);
    try{if(selectorHash(selectorFile(options.roots,path))!==selectorHash(row))return pending(kind,path,'bytes, mode or link changed');}
    catch(error){return pending(kind,path,String(error));}
  }
  for(const row of record.key.facts){const fact=restoreFact(options.roots,row);
    try{if(!sameOracleObservation(fact.value,readHostObservation(fact.kind,fact.path)))return pending(fact.kind,fact.path,'recorded answer changed');}
    catch(error){return pending(fact.kind,fact.path,String(error));}
  }
  if(record.key.projects.length){const owner=projectDiscoveryOwner(options.roots.source);
    try{for(const match of record.key.projects){
      try{if(selectorHash(owner.read(match.request).files)!==selectorHash(match.files))return pending('project-discovery',match.request.path,'compiler-matched files changed');}
      catch(error){return pending('project-discovery',match.request.path,String(error));}
    }}finally{owner.close();}
  }
  for(const row of record.key.candidates){const path=resolve(options.roots.source,row.path);
    try{
      metadataParents(options.roots.source,path,'Rust selector candidate');let present=false;
      try{const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink())return pending('rust-candidate',row.path,'candidate is not an owned regular file');present=true;}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      if(present!==row.present)return pending('rust-candidate',row.path,'candidate presence changed');
    }catch(error){return pending('rust-candidate',row.path,String(error));}
  }
  for(const row of record.key.populations)if(selectorHash(selectorPopulation(row,options.tracked))!==selectorHash(row))return pending('tracked-population',row.directory,'tracked names or modes changed');
  return {state:'current',targets:structuredClone(record.targets)};
}
export function readRustSelectorMaterial(path:string,options:Parameters<typeof validateRustSelectorMaterial>[1]):SelectorRead{
  let text:string;
  try{text=readFileSync(path,'utf8');}catch(error){return {state:'pending',pending:{kind:(error as NodeJS.ErrnoException).code==='ENOENT'?'missing':'record-read',path,reason:String(error)}};}
  let value:unknown;try{value=JSON.parse(text) as unknown;}catch{fail('invalid JSON: '+path);}
  return validateRustSelectorMaterial(value,options);
}
