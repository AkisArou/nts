// The committed projection contains only selector roles. Paths and contexts
// are interned; exact filesystem answers live only in the build transaction.
// A current key alone is not derivation authority: the caller also supplies
// the independently accepted main blob before this reader returns any roles.
import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,readSync,lstatSync} from 'node:fs';
import {join,posix} from 'node:path';
import {readHostObservation} from '../differential/oracle-filesystem.ts';
import type {Capture,TypeScriptIdentity} from '../differential/oracle-toolchain.ts';
import type {ByteInputDeclaration} from './module-closure.ts';
import type {RustSelectorRoles} from './rust-selector-roles.ts';
export type {RustSelectorRoles} from './rust-selector-roles.ts';
import {READER_PROTOCOLS,type MembershipDeclaration,type OptionalFileDeclaration,type ReaderContext} from './reader-inputs/main.ts';
import type {RustRuntimeTarget} from './rust-runtime-declarations.ts';
import {metadataParents} from './reader-metadata.ts';
import {changedCargoInputName} from './cargo-input-population.ts';
import {projectDiscoveryOwner,type ProjectRequest} from './project-discovery.ts';
import {selectorHash,selectorFile,selectorFact,selectorPopulation,resolveSelectorPath,
  type RustSelectorMaterial,type PortablePath,type SelectorRoots,type SelectorFile,type TrackedFile,type SelectorPending} from './rust-selector-material.ts';
export {RUST_SELECTOR_RECORD} from './rust-selector-material.ts';

const KINDS=['file','fileExists','directoryExists','entries','realpath','readlink','runtimeEntries','runtimeKind','stat'] as const;
const ROOTS=['source','sdk','sdk-native','source-parent'] as const;
const DIRECTORY_KINDS=['module','data','inspection','conservative'] as const;
const SCHEMA=selectorHash({version:2,roots:ROOTS,kinds:KINDS,directoryKinds:DIRECTORY_KINDS,protocols:READER_PROTOCOLS,
  format:'parent/name path nodes; collision-checked 48-bit SHA256 routing IDs; key-referenced path bindings; context/role pools; ordered reference blocks split at 64 or routing hash nibble zero; base64url SHA256 key rows; exact typed-answer parent-scope digests; native config matches; observation-only dependency bit; acquired main blob required'});
export const MAX_RUST_SELECTOR_RECORD_BYTES=6*1024*1024;
type Row=unknown[];
type WireTarget={target:string;files:string[];moduleFiles:string[];placingFiles:string[];directories:string[];optionalFiles:string[];memberships:string[];byteInputs:string[];typedDependencies:string[]};
type WireKey={engine:Row[];declarations:Row;cargo:{inputs:Row[];targets:Row[]};sdk:TypeScriptIdentity;files:Row[];facts:Row[];projects:Row[];candidates:Row[];populations:Row[]};
export type RustSelectorRecord={version:1;schemaSha256:string;paths:Row[];contexts:Row[];dependencies:Row[];directories:Row[];optional:Row[];memberships:Row[];byteInputs:Row[];lists:Row[];key:WireKey;targets:WireTarget[];keySha256:string;targetsSha256:string};
export type RustSelectorTarget={target:RustRuntimeTarget;roles:RustSelectorRoles};
export type TrustedRustSelectorRecord={revision:string;blob:string;sha256:string};
export type RustSelectorRead={state:'current';targets:RustSelectorTarget[];trusted:TrustedRustSelectorRecord}|{state:'pending';pending:SelectorPending};
export class MalformedRustSelectorRecord extends Error{constructor(message:string){super('Rust selector record malformed: '+message);this.name='MalformedRustSelectorRecord';}}
function fail(message:string):never{throw new MalformedRustSelectorRecord(message);}
function object(value:unknown,keys:readonly string[],where:string):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))fail(where+' is not an object');
  const row=value as Record<string,unknown>;
  if(Object.keys(row).length!==keys.length||Object.keys(row).some(key=>!keys.includes(key)))fail(where+' has unexpected fields');return row;
}
function array(value:unknown,where:string):unknown[]{if(!Array.isArray(value))fail(where+' is not an array');return value;}
function tuple(value:unknown,length:number|readonly number[],where:string):Row{
  const row=array(value,where);if(!(typeof length==='number'?row.length===length:length.includes(row.length)))fail(where+' has invalid arity');return row;
}
function text(value:unknown,where:string):string{if(typeof value!=='string'||!value||/[\x00-\x1f]/.test(value))fail(where+' is not text');return value;}
function integer(value:unknown,where:string,max=Number.MAX_SAFE_INTEGER):number{if(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>max)fail(where+' is not an unsigned integer');return Number(value);}
function digest(value:unknown,where:string):string{if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value))fail(where+' is not SHA256');return value;}
const encodeDigest=(value:string)=>Buffer.from(digest(value,'producer key digest'),'hex').toString('base64url');
function decodeDigest(value:unknown,where:string):string{
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))fail(where+' is not canonical base64url SHA256');
  const bytes=Buffer.from(value,'base64url');
  if(bytes.length!==32||bytes.toString('base64url')!==value)fail(where+' is not canonical base64url SHA256');
  return bytes.toString('hex');
}
function component(value:unknown):string{const name=text(value,'path component');if(/[\\/]/.test(name)||name==='.'||name==='..')fail('noncanonical path component');return name;}
const byteHash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
// These IDs only route within a bounded record. Full SHA256 digests and the
// accepted blob authenticate it; an unequal row with the same ID must refuse.
const rowId=(row:Row)=>createHash('sha256').update(JSON.stringify(row)).digest().subarray(0,6).toString('base64url');
function reference(value:unknown,where:string):string{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8}$/.test(value))fail(where+' is not a routing ID');return value;}
class Pool{
  readonly rows:Row[]=[];private readonly known=new Map<string,string>();
  add(row:Row):string{const key=JSON.stringify(row),id=rowId(row),before=this.known.get(id);
    if(before!==undefined){if(before!==key)fail('routing ID collision: '+id);return id;}
    this.rows.push([id,...row]);this.known.set(id,key);return id;}
  sorted():Row[]{return [...this.rows].sort((a,b)=>String(a[0])<String(b[0])?-1:String(a[0])>String(b[0])?1:0);}
}
class Paths extends Pool{
  path(path:PortablePath):string{
    let at=this.add([path.root,path.root==='source-parent'?path.levels:0]);
    for(const name of path.path.split('/'))if(name)at=this.add([at,name]);return at;
  }
  source(path:string):string|-1{return path==='<entry>'?-1:this.path({root:'source',path});}
}
const payload=(record:RustSelectorRecord)=>({paths:record.paths,contexts:record.contexts,dependencies:record.dependencies,directories:record.directories,
  optional:record.optional,memberships:record.memberships,byteInputs:record.byteInputs,lists:record.lists,targets:record.targets});
/** Hash bindings belong to their consuming key. The complete path table also
 * carries raw claim roles, whose new names must not change selection identity.
 * This is a projection, not validation: the decoder checks all references and
 * paths independently, including paths outside this key's reachable set. */
function keyProjection(record:RustSelectorRecord){
  const wanted=new Set<string>(),pending:string[]=[];
  const path=(value:unknown)=>{if(typeof value==='string'&&!wanted.has(value)){wanted.add(value);pending.push(value);}};
  const file=(row:Row)=>{
    path(row[0]);const identity=row[4] as {physical?:unknown;aliases?:unknown}|undefined;
    if(identity&&typeof identity==='object'){
      path(identity.physical);if(Array.isArray(identity.aliases))for(const alias of identity.aliases)if(Array.isArray(alias))path(alias[0]);
    }
  };
  const key=record.key;
  for(const row of [...key.engine,key.declarations,...key.cargo.inputs,...key.files])file(row);
  for(const row of key.cargo.targets)path(row[0]);
  for(const row of key.facts){path(row[1]);if(Array.isArray(row[2]))for(const query of row[2])path(query);}
  for(const row of key.projects){path(row[1]);if(row[0]===1)path(row[2]);}
  for(const row of key.candidates){path(row[0]);if(Array.isArray(row[1]))for(const query of row[1])path(query);}
  for(const row of key.populations)path(row[0]);
  const nodes=new Map(record.paths.map(row=>[row[0],row]));
  for(let index=0;index<pending.length;index++){
    const node=nodes.get(pending[index]!);if(node&&!ROOTS.includes(node[1] as typeof ROOTS[number]))path(node[1]);
  }
  return {key,paths:record.paths.filter(row=>wanted.has(String(row[0]))).sort((a,b)=>String(a[0])<String(b[0])?-1:String(a[0])>String(b[0])?1:0)};
}
export const rustSelectorRecordHashes=(record:RustSelectorRecord)=>({keySha256:selectorHash(keyProjection(record)),targetsSha256:selectorHash(payload(record))});

/** The writer calls this only after checking the complete live material. */
export function encodeRustSelectorRecord(material:RustSelectorMaterial):RustSelectorRecord{
  const paths=new Paths(),contexts=new Pool(),dependencies=new Pool(),directories=new Pool(),optional=new Pool(),memberships=new Pool(),byteInputs=new Pool(),lists=new Pool();
  const blocks=(values:readonly (string|-1)[]):string[]=>{
    const result:string[]=[];let pending:(string|-1)[]=[];
    for(const value of values){pending.push(value);if(pending.length>=64||(createHash('sha256').update(JSON.stringify(value)).digest()[0]!&15)===0){result.push(lists.add(pending));pending=[];}}
    if(pending.length)result.push(lists.add(pending));return result;
  };
  const context=(row:ReaderContext)=>contexts.add([paths.source(row.entry),Object.entries(row.dataNamespaces).sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,owner])=>[paths.source(name),owner])]);
  const file=(row:SelectorFile):Row=>[paths.path(row.path),row.mode,row.bytes,encodeDigest(row.sha256),...(row.identity||row.linkText!==undefined?[{
    ...(row.linkText===undefined?{}:{linkText:row.linkText}),...(row.identity?{physical:paths.path(row.identity.path),aliases:row.identity.aliases.map(alias=>[paths.path(alias.path),alias.text])}:{})}]:[])];
  const targets=material.targets.map(({target,roles}):WireTarget=>({target:paths.path({root:'source',path:target.source}),files:blocks(roles.files.map(path=>paths.source(path))),moduleFiles:blocks(roles.moduleFiles.map(path=>paths.source(path))),placingFiles:blocks(roles.placingFiles.map(path=>paths.source(path))),
    directories:blocks(roles.directories.map(row=>directories.add([paths.source(row.reader),paths.source(row.directory),DIRECTORY_KINDS.indexOf(row.kind),row.fileCount,row.member??null,row.fixture?[paths.source(row.fixture.entry),row.fixture.owner]:null,row.context?context(row.context):null]))),
    optionalFiles:blocks(roles.optionalFiles.map(row=>optional.add([paths.source(row.reader),paths.source(row.path),context(row.context),Number(row.present)]))),
    memberships:blocks(roles.memberships.map(row=>memberships.add([paths.source(row.reader),paths.source(row.directory),context(row.context),row.entries.map(entry=>[paths.source(row.directory?row.directory+'/'+entry.name:entry.name),['file','directory','symlink'].indexOf(entry.type)])]))),
    byteInputs:blocks(roles.byteInputs.map(row=>byteInputs.add([paths.source(row.reader),paths.source(row.path)]))),
    typedDependencies:blocks(roles.typedDependencies.map(row=>dependencies.add([paths.source(row.reader),READER_PROTOCOLS.indexOf(row.protocol),paths.source(row.dependency.path),KINDS.indexOf(row.dependency.kind),Number(row.dependency.bytes)|(Number(row.dependency.directoryStat)<<1)|(Number(row.dependency.observationOnly===true)<<2),context(row.dependency.context)]))),
  }));
  const factGroups=new Map<string,typeof material.key.facts>();
  for(const fact of material.key.facts){const scope={...fact.path,path:posix.dirname(fact.path.path)==='.'?'':posix.dirname(fact.path.path)},key=JSON.stringify([fact.kind,scope]);
    const rows=factGroups.get(key)??[];rows.push(fact);factGroups.set(key,rows);}
  const candidateGroups=new Map<string,typeof material.key.candidates>();
  for(const row of material.key.candidates){const rows=candidateGroups.get(row.reader)??[];rows.push(row);candidateGroups.set(row.reader,rows);}
  const key:WireKey={engine:material.key.engine.map(file),declarations:file(material.key.declarations),cargo:{inputs:material.key.cargo.inputs.map(file),targets:material.key.cargo.targets.map(row=>[paths.source(row.source),row.name,[...row.kind],Number(row.unitTests)|(Number(row.doctests)<<1)])},
    sdk:{...material.key.sdk},files:material.key.files.map(file),facts:[...factGroups.values()].map(rows=>{
      const first=rows[0]!,parent=posix.dirname(first.path.path);return [KINDS.indexOf(first.kind),paths.path({...first.path,path:parent==='.'?'':parent}),rows.map(row=>paths.path(row.path)),encodeDigest(selectorHash(rows))];
    }),projects:material.key.projects.map(match=>match.request.kind==='config'
      ?[0,paths.source(match.request.path),encodeDigest(selectorHash(match.files))]
      :[1,paths.source(match.request.path),paths.source(match.request.directory),['directory','typescript-tree'].indexOf(match.request.include),encodeDigest(selectorHash(match.files))]),
    candidates:[...candidateGroups.values()].map(rows=>[paths.source(rows[0]!.reader),rows.map(row=>paths.source(row.path)),encodeDigest(selectorHash(rows))]),
    populations:material.key.populations.map(row=>[paths.source(row.directory),row.member??null,encodeDigest(selectorHash(row))])};
  const record:RustSelectorRecord={version:1,schemaSha256:SCHEMA,paths:paths.rows,contexts:contexts.sorted(),dependencies:dependencies.sorted(),directories:directories.sorted(),optional:optional.sorted(),memberships:memberships.sorted(),byteInputs:byteInputs.sorted(),lists:lists.sorted(),key,targets,keySha256:'',targetsSha256:''};
  Object.assign(record,rustSelectorRecordHashes(record));
  const bytes=Buffer.byteLength(JSON.stringify(record)+'\n');
  if(bytes>MAX_RUST_SELECTOR_RECORD_BYTES)throw Error('Rust selector record exceeds its committed size budget: '+bytes+' bytes; fields '+
    JSON.stringify(Object.fromEntries(Object.entries(record).map(([name,value])=>[name,Buffer.byteLength(JSON.stringify(value))]))));
  parseRustSelectorRecord(record);return record;
}

function expandedPaths(rows:Map<string,Row>):Map<string,PortablePath>{
  const result=new Map<string,PortablePath>(),seen=new Set<string>();
  for(const [id,value]of rows){
    const row=tuple(value,2,'path node');let path:PortablePath;
    if(ROOTS.includes(row[0] as typeof ROOTS[number])){
      const root=text(row[0],'path root'),levels=integer(row[1],'parent levels',256);
      if(!ROOTS.includes(root as typeof ROOTS[number])||(root==='source-parent'?levels<1:levels!==0))fail('invalid path anchor');
      path=root==='source-parent'?{root,levels,path:''}:{root:root as 'source'|'sdk'|'sdk-native',path:''};
    }else{
      const parent=reference(row[0],'path parent'),before=result.get(parent);if(!before)fail('path parent is forward or cyclic');
      if(before.root==='source-parent'&&before.path!=='')fail('source-parent is not an ancestor probe');
      const name=component(row[1]);path={...before,path:before.path?before.path+'/'+name:name};
    }
    const key=JSON.stringify(path);if(seen.has(key))fail('duplicate interned path');seen.add(key);result.set(id,path);
  }
  return result;
}
function decoder(record:RustSelectorRecord,decodeTargets=true){
  const tables=new Map<Row[],Map<string,Row>>();
  const table=(rows:Row[],where:string):Map<string,Row>=>{let result=tables.get(rows);if(result)return result;result=new Map();
    for(const value of rows){if(value.length<2)fail(where+' has an empty row');const id=reference(value[0],where+' ID'),row=value.slice(1);
      if(result.has(id))fail('duplicate routing ID: '+where+' '+id);if(rowId(row)!==id)fail('routing ID/content mismatch: '+where+' '+id);result.set(id,row);}
    tables.set(rows,result);return result;};
  const paths=expandedPaths(table(record.paths,'path'));
  const path=(value:unknown,scope=false):PortablePath=>{const row=paths.get(reference(value,'path reference'));if(!row)fail('missing path reference');if(row.root==='source-parent'&&!row.path&&!scope)fail('empty ancestor probe');return row;};
  const source=(value:unknown,empty=false,entry=false):string=>{if(value===-1&&entry)return '<entry>';const row=path(value);
    if(row.root!=='source'||!empty&&!row.path)fail('role is not source-relative');return row.path;};
  const ref=(value:unknown,rows:Row[],where:string):Row=>{const row=table(rows,where).get(reference(value,where));if(!row)fail('missing '+where);return row;};
  const context=(value:unknown):ReaderContext=>{const row=tuple(ref(value,record.contexts,'context reference'),2,'context'),dataNamespaces:Record<string,string>={};
    for(const item of array(row[1],'context namespaces')){const entry=tuple(item,2,'namespace'),name=source(entry[0]);if(Object.hasOwn(dataNamespaces,name))fail('duplicate namespace');Object.defineProperty(dataNamespaces,name,{value:text(entry[1],'namespace owner'),enumerable:true});}
    return {entry:source(row[0],false,true),dataNamespaces};};
  const file=(value:unknown):SelectorFile=>{const row=tuple(value,[4,5],'file'),result:SelectorFile={path:path(row[0]),mode:integer(row[1],'file mode',0xffffffff),bytes:integer(row[2],'file bytes'),sha256:decodeDigest(row[3],'file hash')};
    if(row.length===5){const extra=row[4];if(!extra||typeof extra!=='object'||Array.isArray(extra))fail('invalid file identity');const item=extra as Record<string,unknown>;
      if(Object.keys(item).some(key=>!['linkText','physical','aliases'].includes(key)))fail('unknown file identity field');
      if(item.linkText!==undefined)result.linkText=text(item.linkText,'link text');
      if(item.physical!==undefined){const physical=path(item.physical);if(physical.root==='source-parent')fail('alias endpoint outside owned roots');
        result.identity={path:physical,aliases:array(item.aliases,'file aliases').map(value=>{const alias=tuple(value,2,'alias');return {path:path(alias[0]),text:text(alias[1],'alias text')};})};
      }else if(item.aliases!==undefined)fail('aliases have no physical endpoint');
    }return result;};
  const cargo=record.key.cargo.targets.map(value=>{const row=tuple(value,4,'Cargo target'),flags=integer(row[3],'Cargo routes',3);if(!flags)fail('Cargo target has no route');
    const kind=array(row[2],'Cargo kinds').map(value=>text(value,'Cargo kind'));if(!kind.length||new Set(kind).size!==kind.length)fail('invalid Cargo kinds');
    return {source:source(row[0]),name:text(row[1],'Cargo name'),kind,unitTests:!!(flags&1),doctests:!!(flags&2)};});
  const bySource=new Map(cargo.map(row=>[row.source,row]));if(bySource.size!==cargo.length)fail('duplicate Cargo source');
  const dependency=(value:unknown)=>{const row=tuple(ref(value,record.dependencies,'dependency reference'),6,'dependency'),protocol=integer(row[1],'dependency protocol',READER_PROTOCOLS.length-1),kind=KINDS[integer(row[3],'dependency kind',KINDS.length-1)]!,flags=integer(row[4],'dependency flags',7);
    return {reader:source(row[0]),protocol:READER_PROTOCOLS[protocol]!,dependency:{path:source(row[2],true),kind,bytes:!!(flags&1),directoryStat:!!(flags&2),context:context(row[5]),...(flags&4?{observationOnly:true as const}:{})}};};
  const directory=(value:unknown)=>{const row=tuple(ref(value,record.directories,'directory reference'),7,'directory'),kind=DIRECTORY_KINDS[integer(row[2],'directory kind',DIRECTORY_KINDS.length-1)]!;
    if(kind==='conservative'&&(row[6]===null||row[4]!==null||row[5]!==null))fail('conservative directory lacks an immutable reader context');
    const fixture=row[5]===null?undefined:tuple(row[5],2,'fixture');
    return {reader:source(row[0],false,true),directory:source(row[1],true),kind,fileCount:integer(row[3],'directory file count'),
      ...(row[6]===null?{}:{context:context(row[6])}),
      ...(row[4]===null?{}:{member:component(row[4])}),...(fixture?{fixture:{entry:source(fixture[0]),owner:text(fixture[1],'fixture owner')}}:{})};};
  const optional=(value:unknown):OptionalFileDeclaration=>{const row=tuple(ref(value,record.optional,'optional reference'),4,'optional');return {reader:source(row[0],false,true),path:source(row[1]),context:context(row[2]),present:!!integer(row[3],'optional presence',1)};};
  const membership=(value:unknown):MembershipDeclaration=>{const row=tuple(ref(value,record.memberships,'membership reference'),4,'membership'),directory=source(row[1],true),prefix=directory?directory+'/':'';
    const entries=array(row[3],'membership children').map(value=>{const child=tuple(value,2,'membership child'),name=source(child[0]);if(!name.startsWith(prefix)||name.slice(prefix.length).includes('/'))fail('membership child is not immediate');
      return {name:name.slice(prefix.length),type:(['file','directory','symlink'] as const)[integer(child[1],'membership child type',2)]!};});
    return {reader:source(row[0],false,true),directory,context:context(row[2]),entries};};
  const byte=(value:unknown):ByteInputDeclaration=>{const row=tuple(ref(value,record.byteInputs,'byte reference'),2,'byte input');return {reader:source(row[0],false,true),path:source(row[1])};};
  const checked=new Map<string,Set<string>>();
  const roles=<T>(values:unknown,kind:string,read:(value:unknown)=>T):T[]=>{
    const result:T[]=[],known=checked.get(kind)??new Set<string>();checked.set(kind,known);
    for(const value of array(values,kind+' blocks')){
      const at=reference(value,'ordered block reference'),block=ref(at,record.lists,'ordered block');
      if(decodeTargets){for(const value of block)result.push(read(value));}
      else if(!known.has(at)){for(const value of block)read(value);known.add(at);}
    }
    return result;
  };
  const seenTargets=new Set<string>(),targets:RustSelectorTarget[]=[];
  for(const row of record.targets){const target=bySource.get(source(row.target));if(!target||seenTargets.has(target.source))fail('missing/duplicate projected Cargo owner');seenTargets.add(target.source);
    const files=(values:unknown)=>roles(values,'source',value=>source(value));
    const value={target:structuredClone(target),roles:{files:files(row.files),moduleFiles:files(row.moduleFiles),placingFiles:files(row.placingFiles),
      directories:roles(row.directories,'directory',directory),optionalFiles:roles(row.optionalFiles,'optional',optional),memberships:roles(row.memberships,'membership',membership),
      byteInputs:roles(row.byteInputs,'byte',byte),typedDependencies:roles(row.typedDependencies,'dependency',dependency)}};
    if(decodeTargets)targets.push(value);
  }
  if(seenTargets.size!==cargo.length)fail('projected Cargo inventory is incomplete');
  const project=(value:unknown):{request:ProjectRequest;sha256:string}=>{
    const row=tuple(value,[3,5],'project discovery'),kind=integer(row[0],'project discovery kind',1);
    if(kind===0){if(row.length!==3)fail('config discovery has invalid arity');return {request:{kind:'config',path:source(row[1])},sha256:decodeDigest(row[2],'matched files hash')};}
    if(row.length!==5)fail('generated discovery has invalid arity');
    return {request:{kind:'generated',path:source(row[1]),directory:source(row[2],true),include:integer(row[3],'generated include',1)===0?'directory':'typescript-tree'},sha256:decodeDigest(row[4],'matched files hash')};
  };
  return {path,source,file,cargo,targets,project};
}

export function parseRustSelectorRecord(value:unknown):RustSelectorRecord{
  const root=object(value,['version','schemaSha256','paths','contexts','dependencies','directories','optional','memberships','byteInputs','lists','key','targets','keySha256','targetsSha256'],'record');
  if(root.version!==1||root.schemaSha256!==SCHEMA)fail('schema hash/version mismatch');
  const tables=['paths','contexts','dependencies','directories','optional','memberships','byteInputs','lists'] as const;
  for(const key of tables){const seen=new Set<string>();for(const value of array(root[key],key)){
    const row=array(value,key+' row'),id=reference(row[0],key+' ID');if(seen.has(id))fail('duplicate routing ID: '+key+' '+id);seen.add(id);
    if(rowId(row.slice(1))!==id)fail('routing ID/content mismatch: '+key+' '+id);
  }}
  for(const value of array(root.lists,'ordered blocks')){
    const block=array(value,'ordered block').slice(1);if(!block.length||block.length>64)fail('invalid ordered block length');
    for(const value of block)reference(value,'ordered block value');
  }
  const key=object(root.key,['engine','declarations','cargo','sdk','files','facts','projects','candidates','populations'],'key'),cargo=object(key.cargo,['inputs','targets'],'Cargo');
  for(const name of ['engine','files','facts','projects','candidates','populations'])for(const row of array(key[name],name))array(row,name+' row');
  for(const name of ['inputs','targets'])for(const row of array(cargo[name],'Cargo '+name))array(row,'Cargo row');array(key.declarations,'declarations');
  const sdk=object(key.sdk,['version','rootPackageSha256','packageSha256','nativeSha256','nativePackageSha256'],'SDK');text(sdk.version,'SDK version');
  for(const name of ['rootPackageSha256','packageSha256','nativeSha256','nativePackageSha256'])digest(sdk[name],'SDK '+name);
  for(const target of array(root.targets,'targets'))object(target,['target','files','moduleFiles','placingFiles','directories','optionalFiles','memberships','byteInputs','typedDependencies'],'target roles');
  const record=value as RustSelectorRecord;
  const hashes=rustSelectorRecordHashes(record);
  if(hashes.keySha256!==digest(root.keySha256,'key hash')||hashes.targetsSha256!==digest(root.targetsSha256,'payload hash'))fail('payload hash mismatch');
  const decoded=decoder(record,false);for(const row of [...record.key.engine,record.key.declarations,...record.key.cargo.inputs,...record.key.files])decoded.file(row);
  const seen=new Set<string>();
  for(const value of record.key.facts){const row=tuple(value,4,'fact group'),kind=integer(row[0],'fact kind',KINDS.length-1),scope=decoded.path(row[1],true);if(KINDS[kind]==='stat')fail('nonportable stat group');
    const queries=array(row[2],'fact queries');if(!queries.length)fail('empty fact group');decodeDigest(row[3],'fact group hash');
    for(const query of queries){const path=decoded.path(query),parent=posix.dirname(path.path);if(selectorHash({...path,path:parent==='.'?'':parent})!==selectorHash(scope))fail('fact group scope mismatch');
      const key=JSON.stringify([kind,path]);if(seen.has(key))fail('duplicate fact query');seen.add(key);}
  }
  const projects=new Set<string>();for(const value of record.key.projects){const {request}=decoded.project(value),key=JSON.stringify(request);if(projects.has(key))fail('duplicate project discovery');projects.add(key);}
  for(const value of record.key.candidates){const row=tuple(value,3,'candidate group');decoded.source(row[0]);for(const query of array(row[1],'candidate queries'))decoded.source(query);decodeDigest(row[2],'candidate group hash');}
  for(const value of record.key.populations){const row=tuple(value,3,'population');decoded.source(row[0],true);if(row[1]!==null)component(row[1]);decodeDigest(row[2],'population hash');}
  return record;
}

export function validateRustSelectorKey(record:RustSelectorRecord,options:{roots:SelectorRoots;inventory:readonly RustRuntimeTarget[];tracked:readonly TrackedFile[];sdk:()=>Capture}):{state:'key-current'}|{state:'pending';pending:SelectorPending}{
  const decoded=decoder(record,false),pending=(kind:string,path:string,reason:string)=>({state:'pending' as const,pending:{kind,path,reason}});
  if(selectorHash(decoded.cargo)!==selectorHash(options.inventory))return pending('cargo-targets','<targets>','Cargo target inventory changed');
  const changedCargo=changedCargoInputName(record.key.cargo.inputs.map(row=>{const path=decoded.file(row).path;return path.root==='source'?path.path:JSON.stringify(path);}),options.tracked);
  if(changedCargo!==undefined)return pending('cargo-input-population',changedCargo,'tracked Cargo input names changed');
  try{const sdk=options.sdk();if(sdk.root!==options.roots.sdk||sdk.nativeRoot!==options.roots.native||selectorHash(sdk.identity)!==selectorHash(record.key.sdk))return pending('sdk',options.roots.sdk,'installed SDK identity/anchors changed');}
  catch(error){return pending('sdk',options.roots.sdk,String(error));}
  for(const [kind,rows]of [['engine',record.key.engine],['declarations',[record.key.declarations]],['cargo-inputs',record.key.cargo.inputs],['file',record.key.files]] as const)for(const value of rows){
    const expected=decoded.file(value);let path=JSON.stringify(expected.path);
    try{path=resolveSelectorPath(options.roots,expected.path);if(selectorHash(selectorFile(options.roots,path))!==selectorHash(expected))return pending(kind,path,'bytes, mode or alias changed');}catch(error){return pending(kind,path,String(error));}
  }
  for(const value of record.key.facts){const row=tuple(value,4,'fact group'),kind=KINDS[integer(row[0],'fact kind',KINDS.length-1)]!,scope=decoded.path(row[1],true);let name=JSON.stringify(scope);
    try{
      name=resolveSelectorPath(options.roots,scope);const answers=array(row[2],'fact queries').map(query=>{
        const path=resolveSelectorPath(options.roots,decoded.path(query));return selectorFact(options.roots,{kind,path,value:readHostObservation(kind,path)});
      });
      if(selectorHash(answers)!==decodeDigest(row[3],'fact group hash'))return pending(kind,name,'canonical answers changed in this scope; query paths: '+JSON.stringify(array(row[2],'fact queries').map(query=>decoded.path(query))));
    }catch(error){return pending(kind,name,String(error));}
  }
  if(record.key.projects.length){
    const owner=projectDiscoveryOwner(options.roots.source);
    try{for(const value of record.key.projects){const expected=decoded.project(value);
      try{if(selectorHash(owner.read(expected.request).files)!==expected.sha256)return pending('project-discovery',expected.request.path,'native matched files changed');}
      catch(error){return pending('project-discovery',expected.request.path,String(error));}
    }}finally{owner.close();}
  }
  for(const value of record.key.candidates){const row=tuple(value,3,'candidate group'),reader=decoded.source(row[0]);
    try{const answers=array(row[1],'candidate queries').map(query=>{const path=decoded.source(query),absolute=join(options.roots.source,path);metadataParents(options.roots.source,absolute,'Rust selector candidate');let present=false;
      try{const info=lstatSync(absolute);if(!info.isFile()||info.isSymbolicLink())throw Error('candidate is not an owned regular file: '+path);present=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}return {reader,path,present};});
      if(selectorHash(answers)!==decodeDigest(row[2],'candidate group hash'))return pending('rust-candidate',reader,'candidate answers changed: '+JSON.stringify(answers.map(row=>row.path)));
    }catch(error){return pending('rust-candidate',reader,String(error));}
  }
  for(const value of record.key.populations){const row=tuple(value,3,'population'),directory=decoded.source(row[0],true),member=row[1]===null?undefined:text(row[1],'member');
    if(selectorHash(selectorPopulation({directory,...(member?{member}:{})},options.tracked))!==decodeDigest(row[2],'population hash'))return pending('tracked-population',directory,'tracked names or modes changed');
  }
  return {state:'key-current'};
}

/** The repository paths a key observes, by what a working change could alter.
 * `paths` are observed for bytes, mode or presence; `members` and
 * `populations` for their child names (immediate and recursive); Cargo input
 * names are observed across the whole tracked population. */
export type RustSelectorKeyInputs={paths:ReadonlySet<string>;members:ReadonlySet<string>;populations:ReadonlySet<string>};
export function rustSelectorKeyInputs(record:RustSelectorRecord):RustSelectorKeyInputs{
  const decoded=decoder(record,false),paths=new Set<string>(),members=new Set<string>(),populations=new Set<string>();
  const add=(path:PortablePath,into:Set<string>)=>{if(path.root==='source')into.add(path.path);};
  for(const row of [...record.key.engine,record.key.declarations,...record.key.cargo.inputs,...record.key.files]){const file=decoded.file(row);add(file.path,paths);
    if(file.identity){add(file.identity.path,paths);for(const alias of file.identity.aliases)add(alias.path,paths);}}
  for(const value of record.key.facts){const row=tuple(value,4,'fact group'),kind=KINDS[integer(row[0],'fact kind',KINDS.length-1)]!;
    for(const query of array(row[2],'fact queries')){const path=decoded.path(query);add(path,paths);if(kind==='entries'||kind==='runtimeEntries')add(path,members);}}
  for(const value of record.key.candidates)for(const query of array(tuple(value,3,'candidate group')[1],'candidate queries'))paths.add(decoded.source(query));
  for(const value of record.key.populations)populations.add(decoded.source(tuple(value,3,'population')[0],true));
  return {paths,members,populations};
}

function boundedRecordBytes(path:string):Buffer{
  const descriptor=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const info=fstatSync(descriptor);
    if(!info.isFile())fail('record is not a regular file');
    if(!Number.isSafeInteger(info.size)||info.size>MAX_RUST_SELECTOR_RECORD_BYTES)fail('record exceeds committed size budget');
    const bytes=Buffer.allocUnsafe(info.size+1);let at=0;
    while(at<bytes.length){const size=readSync(descriptor,bytes,at,bytes.length-at,null);if(size===0)break;at+=size;}
    if(at!==info.size)throw Error('Rust selector record changed during bounded read: '+path);
    return bytes.subarray(0,at);
  }finally{closeSync(descriptor);}
}
export type RustSelectorCandidate={state:'key-current';record:RustSelectorRecord;sha256:string}|{state:'pending';pending:SelectorPending;sha256?:string;record?:RustSelectorRecord};
/** One bounded body supplies both the checked key and the eventual roles. */
export function loadRustSelectorCandidate(path:string,options:Parameters<typeof validateRustSelectorKey>[1]):RustSelectorCandidate{
  let bytes:Buffer;
  try{bytes=boundedRecordBytes(path);}catch(error){if(error instanceof MalformedRustSelectorRecord)throw error;return {state:'pending',pending:{kind:(error as NodeJS.ErrnoException).code==='ENOENT'?'missing':'record-read',path,reason:String(error)}};}
  let value:unknown;try{value=JSON.parse(bytes.toString('utf8')) as unknown;}catch{fail('invalid JSON');}
  const record=parseRustSelectorRecord(value),checked=validateRustSelectorKey(record,options);if(checked.state==='pending')return {...checked,sha256:byteHash(bytes),record};
  return {state:'key-current',record,sha256:byteHash(bytes)};
}
export function readRustSelectorRecord(path:string,options:Parameters<typeof validateRustSelectorKey>[1]&{trusted:TrustedRustSelectorRecord|undefined}):RustSelectorRead{
  const candidate=loadRustSelectorCandidate(path,options);if(candidate.state==='pending')return candidate;
  if(!options.trusted||candidate.sha256!==options.trusted.sha256)return {state:'pending',pending:{kind:'unverified-record',path,reason:'record bytes have no accepted main blob; live projection required'}};
  return {state:'current',targets:decoder(candidate.record).targets,trusted:{...options.trusted}};
}
