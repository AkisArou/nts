// Filesystem answers, including unsuccessful lookups, are oracle inputs.
// This module uses builtins only: application loaders never import the emitter.
import {createHash} from 'node:crypto';
import {snapshotHash,snapshotSlot,SNAPSHOT_SLOT_BYTES,MAX_SNAPSHOT_SLOTS,MAX_SNAPSHOT_BUCKET_RECORDS,MAX_SNAPSHOT_BUCKET_BYTES,type SnapshotSlotIndex,type OracleSnapshotReference} from './oracle-runtime.ts';
export {dependencySealIdentity,dependencySealReady,dependencySealError,ownsDependencyRun,DEPENDENCY_SEAL_FIELDS,checkerImportIdentity,readOracleSnapshotIndex} from './oracle-runtime.ts';
export type {DependencySealIdentity,DependencyRunSeal,CheckerImportRelation,OracleSnapshotReference} from './oracle-runtime.ts';

import {mkdirSync,writeFileSync,readFileSync,readdirSync,readlinkSync,realpathSync,statSync,lstatSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {validateRuntimeObservations,sameOracleObservation,type ObservationKind,type DirectoryEntries,type HostObservation} from './oracle-runtime.ts';
export {OraclePathPrefixes,capturedModuleIdentity,OracleResolutionDomain,ORACLE_NODE_RESOLUTION_RECIPE,oracleLegacyMainQueries} from './oracle-runtime.ts';
export type {ObservationKind,DirectoryEntries,HostObservation,CapturedModulePath,CapturedAlias,ResolutionPackageFact,ResolutionDomainRecord,SparseResolutionDomainRecord,ResolutionQuery,ResolutionProof} from './oracle-runtime.ts';

const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export function capturedPackageMetadata(directory:string):{valid:boolean;main:string|null;name:string|null;exports:unknown}{
  const text=readFileSync(join(directory,'package.json'),'utf8').replace(/^\uFEFF/,'');
  let data:unknown;try{data=JSON.parse(text);}catch{return {valid:false,main:null,name:null,exports:null};}
  const value=data&&typeof data==='object'?data as {main?:unknown;name?:unknown;exports?:unknown}:{};
  return {valid:true,main:typeof value.main==='string'?value.main:null,name:typeof value.name==='string'?value.name:null,exports:value.exports??null};
}
const absent=(error:unknown)=>['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??'');
const compare=(a:string,b:string)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
function metadata(path:string){try{return statSync(path);}catch(error){if(absent(error))return null;throw error;}}
function bytes(path:string){try{return readFileSync(path);}catch(error){if(absent(error))return null;throw error;}}
function directoryEntries(path:string):DirectoryEntries{
  let names:Buffer[];
  try{names=readdirSync(path,{encoding:'buffer'});}catch(error){if(absent(error))return {files:[],directories:[]};throw error;}
  const result:DirectoryEntries={files:[],directories:[]};
  for(const raw of names){
    const name=raw.toString('utf8');
    if(!Buffer.from(name).equals(raw))throw Error('oracle filesystem directory has a non-UTF8 name: '+path);
    const info=metadata(path+sep+name); // Follow links, as the SDK host does.
    if(info?.isFile())result.files.push(name);else if(info?.isDirectory())result.directories.push(name);
  }
  result.files.sort(compare);result.directories.sort(compare);return result;
}
function runtimeEntries(path:string):string[]{
  let names:Buffer[];
  try{names=readdirSync(path,{encoding:'buffer'});}catch(error){if(absent(error))return [];throw error;}
  return names.map(raw=>{const name=raw.toString('utf8');if(!Buffer.from(name).equals(raw))throw Error('oracle runtime directory has a non-UTF8 name: '+path);return name;}).sort(compare);
}
function runtimeKind(path:string):string|null{
  try{const info=lstatSync(path);return info.isSymbolicLink()?'symlink':info.isFile()?'file':info.isDirectory()?'directory':'other';}
  catch(error){if(absent(error))return null;throw error;}
}
function physicalPath(path:string){try{return realpathSync.native(path);}catch(error){if(absent(error))return path;throw error;}}
function linkText(path:string):string|null{
  try{if(!lstatSync(path).isSymbolicLink())return null;const bytes=readlinkSync(path,{encoding:'buffer'}),text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes))throw Error('oracle filesystem link has a non-UTF8 target: '+path);return text;}
  catch(error){if(absent(error)||(error as NodeJS.ErrnoException).code==='EINVAL')return null;throw error;}
}
function answer(kind:ObservationKind,path:string):HostObservation['value']{
  switch(kind){
    case 'file':{const value=bytes(path);return value===null?null:digest(value);}
    case 'fileExists':return metadata(path)?.isFile()??false;
    case 'directoryExists':return metadata(path)?.isDirectory()??false;
    case 'entries':return directoryEntries(path);
    case 'realpath':return physicalPath(path);
    case 'readlink':return linkText(path);
    case 'runtimeEntries':return runtimeEntries(path);
    case 'runtimeKind':return runtimeKind(path);
  }
}
export function validateHostObservations(observations:HostObservation[],read:(kind:ObservationKind,path:string)=>HostObservation['value']=answer):{count:number;wallMs:number}{return validateRuntimeObservations(observations,read);}

/** One instance per preparation worker; reset between fully drained batches. */
export class OracleFilesystem{
  private observations=new Map<string,HostObservation>();
  clear(){this.observations.clear();}
  private record<T extends HostObservation['value']>(kind:ObservationKind,path:string,value:T):T{
    path=resolve(path);const key=JSON.stringify([kind,path]),previous=this.observations.get(key);
    if(previous&&!sameOracleObservation(previous.value,value))throw Error(`oracle filesystem ${kind} changed during preparation: ${path}`);
    this.observations.set(key,{kind,path,value});return value;
  }
  readBytes(path:string):Buffer|null{
    path=resolve(path);const value=bytes(path);this.record('file',path,value===null?null:digest(value));return value;
  }
  readFile=(path:string):string|null=>this.readBytes(path)?.toString('utf8')??null;
  fileExists=(path:string):boolean=>{path=resolve(path);return this.record('fileExists',path,metadata(path)?.isFile()??false);};
  directoryExists=(path:string):boolean=>{path=resolve(path);return this.record('directoryExists',path,metadata(path)?.isDirectory()??false);};
  getAccessibleEntries=(path:string):DirectoryEntries=>{path=resolve(path);return this.record('entries',path,directoryEntries(path));};
  realpath=(path:string):string=>{path=resolve(path);return this.record('realpath',path,physicalPath(path));};
  readlink=(path:string):string|null=>{path=resolve(path);return this.record('readlink',path,linkText(path));};
  runtimeEntries=(path:string):string[]=>{path=resolve(path);return this.record('runtimeEntries',path,runtimeEntries(path));};
  runtimeKind=(path:string):string|null=>{path=resolve(path);return this.record('runtimeKind',path,runtimeKind(path));};
  projectFor(entry:string):string|null{
    for(let dir=resolve(entry,'..');;dir=resolve(dir,'..')){
      const config=dir+sep+'tsconfig.json';if(this.fileExists(config))return config;
      if(dir===resolve(dir,'..'))return null;
    }
  }
  merge(observations:HostObservation[]){
    validateHostObservations(observations);
    for(const observation of observations)this.record(observation.kind,observation.path,observation.value);
  }
  captured(exclude:readonly string[]|((path:string)=>boolean)=[]):HostObservation[]{
    const excluded=typeof exclude==='function'?exclude:(path:string)=>exclude.some(root=>path===root||path.startsWith(root+sep));
    return [...this.observations.values()].filter(item=>!excluded(item.path))
      .sort((a,b)=>compare(a.kind,b.kind)||compare(a.path,b.path));
  }
}


/** Publication only. The table authenticates bounded independently read buckets. */
export function writeOracleSnapshotIndex(directory:string,records:Iterable<readonly [string,unknown]>):OracleSnapshotReference{
  mkdirSync(join(directory,'runtime-index'),{recursive:true});
  const entries:[string,unknown][]=[],keys=new Set<string>();
  for(const [key,value] of records){
    if(typeof key!=='string'||keys.has(key))throw Error('oracle snapshot record key is invalid or duplicate');
    keys.add(key);entries.push([key,value]);
  }
  let slots=Math.min(MAX_SNAPSHOT_SLOTS,2**Math.ceil(Math.log2(Math.max(1,entries.length/2)))),groups:[string,unknown][][];
  for(;;){
    groups=Array.from({length:slots},()=>[]);for(const row of entries)groups[snapshotSlot(row[0],slots)]!.push(row);
    const largest=groups.reduce((max,rows)=>Math.max(max,rows.length),0);
    if(largest<=16||slots===MAX_SNAPSHOT_SLOTS){if(largest>MAX_SNAPSHOT_BUCKET_RECORDS)throw Error('oracle snapshot metadata bucket exceeds its record bound');break;}
    slots*=2;
  }
  const table=Buffer.alloc(slots*SNAPSHOT_SLOT_BYTES),chunks:Buffer[]=[];let offset=0;
  for(let slot=0;slot<slots;slot++){
    const rows=groups[slot]!;if(!rows.length)continue;
    rows.sort((a,b)=>compare(a[0],b[0]));const bytes=Buffer.from(JSON.stringify({version:1,slot,entries:rows})+'\n');
    if(bytes.length>MAX_SNAPSHOT_BUCKET_BYTES||offset+bytes.length>=2**32)throw Error('oracle snapshot metadata data exceeds its byte bound');
    table.writeUInt32LE(offset,slot*SNAPSHOT_SLOT_BYTES);table.writeUInt32LE(bytes.length,slot*SNAPSHOT_SLOT_BYTES+4);snapshotHash(bytes).copy(table,slot*SNAPSHOT_SLOT_BYTES+8);
    chunks.push(bytes);offset+=bytes.length;
  }
  const put=(bytes:Buffer,extension:'json'|'bin'):OracleSnapshotReference=>{
    const sha256=snapshotHash(bytes).toString('hex'),path='runtime-index/'+sha256+'.'+extension,file=join(directory,path);
    try{writeFileSync(file,bytes,{flag:'wx',mode:0o400});}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||!readFileSync(file).equals(bytes))throw error;}
    return {path,sha256};
  };
  const data=Buffer.concat(chunks),descriptor:SnapshotSlotIndex={version:2,slots,slotBytes:40,table:put(table,'bin'),data:{...put(data,'bin'),bytes:data.length}};
  return put(Buffer.from(JSON.stringify(descriptor)+'\n'),'json');
}
