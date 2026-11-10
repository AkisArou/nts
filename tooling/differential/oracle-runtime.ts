// Small shared child runtime: checked metadata reads and run seals only.
import {createHash,hash as cryptoHash} from 'node:crypto';
import {appendFileSync,openSync,closeSync,readSync,fstatSync,lstatSync,statSync,readFileSync,constants} from 'node:fs';
import {dirname,isAbsolute,join,parse,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {OracleIdentity,EmitGroup,OwnerImportRoute} from './oracle-emit.ts';

// Recipe identity is shared with result-only consumers. It reads pinned source
// bytes and records, never the preparation graph or a compiler API.
export const ORACLE_EXECUTION_FILES=['oracle-execution.ts','oracle-execution-policy.ts','oracle-batch.ts'] as const;
// The phase a case's oracle stopped in: planning its population, preparing its
// program, or executing it. Only a planned population has a driver.
export type OracleBudget={phase:'plan'|'prepare'|'execute';outcome:'timeout'|'memory-cap';bound:number;signal:string|null;reason:string};
let recipeIdentity:OracleIdentity|undefined;
export function oracleIdentityFor(typescript:OracleIdentity['typescript']):OracleIdentity{
  const here=dirname(fileURLToPath(import.meta.url)),hash=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
  const dependency=process.env.NTS_ORACLE_DEPENDENCIES?JSON.parse(process.env.NTS_ORACLE_DEPENDENCIES):undefined;
  return recipeIdentity??={version:1,typescript,executionSha256:hash(JSON.stringify(ORACLE_EXECUTION_FILES.map(file=>hash(readFileSync(join(here,file)))))),
    ...(dependency?{dependencyRecipeSha256:hash(JSON.stringify([dependency.lockfileSha256,dependency.producerSha256]))}:{}),
    emitterSha256:hash(readFileSync(join(here,'oracle-emit.ts'))),
    loaderSha256:hash(readFileSync(join(here,'oracle-loader.ts'))),
    filesystemSha256:hash(readFileSync(join(here,'oracle-filesystem.ts'))),
    runtimeSha256:hash(readFileSync(join(here,'oracle-runtime.ts'))),
    resolutionSha256:hash(readFileSync(join(here,'oracle-resolution.ts'))),
    assetsSha256:hash(readFileSync(join(here,'oracle-assets.ts'))),
    toolchainRecordSha256:hash(readFileSync(join(here,'oracle-toolchain.json'))),
    options:JSON.parse(readFileSync(join(here,'oracle-toolchain.json'),'utf8')).execution.options};
}
export function oracleRecipeIdentity():OracleIdentity{
  const here=dirname(fileURLToPath(import.meta.url));
  const records:{version:number;platforms:Record<string,OracleIdentity['typescript']>;execution:{options:string}}=JSON.parse(readFileSync(join(here,'oracle-toolchain.json'),'utf8'));
  const expected=records.platforms[process.platform+'-'+process.arch];
  if(records.version!==1||!expected)throw Error('oracle TypeScript toolchain has no recorded identity');
  const {version,rootPackageSha256,packageSha256,nativeSha256,nativePackageSha256}=expected;
  return oracleIdentityFor({version,rootPackageSha256,packageSha256,nativeSha256,nativePackageSha256});
}


export type OracleManifest={preloads?:string[];runtimeAssets?:Record<string,string>;runtimeIndex?:OracleSnapshotReference;imports:OwnerImportRoute[];dependencies?:{semanticSha256:string;nodeVersion:string};declarations?:string;observations:HostObservation[];sources:Record<string,string>;version:3;status:'complete';identity:OracleIdentity;project:string|null;entry:string;roots:string[]|null;groups:EmitGroup[];inputs:Record<string,string>;outputs:Record<string,string>};
/** Allocation/authentication references are derived from the semantic proof.
 * Raw snapshot authentication still binds the complete manifest, including these. */
export const ORACLE_MANIFEST_DERIVED_FIELDS=['runtimeIndex'] as const satisfies readonly (keyof OracleManifest)[];

export type SourceAssetRule={root:string;depth:number;name:string};
/** The most specific declared source prefix selects one exact companion file. */
export function sourceAssetPath(source:string,rules:readonly SourceAssetRule[]):string|null{
  const rule=[...rules].sort((a,b)=>b.root.length-a.root.length).find(rule=>source.startsWith(resolve(rule.root)+sep));
  if(!rule)return null;
  if(!isAbsolute(rule.root)||!Number.isSafeInteger(rule.depth)||rule.depth<0||rule.depth>32||!rule.name||rule.name==='.'||rule.name==='..'||rule.name.includes('/')||rule.name.includes('\\'))throw Error('oracle source asset rule is invalid');
  const parts=relative(rule.root,source).split(sep);
  return parts.length>rule.depth?join(rule.root,...parts.slice(0,rule.depth),rule.name):null;
}

export type CheckerImportRelation={file:string;specifier:string;pos:number;end:number;target:string;sourceSha256:string};
export function checkerImportIdentity(relation:CheckerImportRelation):string{
  return createHash('sha256').update(JSON.stringify([relation.file,relation.specifier,relation.pos,relation.end,relation.target,relation.sourceSha256])).digest('hex');
}
/** A canonical parent pins this read-only record after complete validation. */
export type DependencySealIdentity={dev:string;ino:string;uid:string;mode:string;nlink:string;size:string;mtimeNs:string;ctimeNs:string};
export type DependencyRunSeal={version:1;nodeVersion:string;record:string;readySha256:string;semanticSha256:string;identity:DependencySealIdentity};
export const DEPENDENCY_SEAL_FIELDS=['dev','ino','uid','mode','nlink','size','mtimeNs','ctimeNs'] as const;
export function dependencySealIdentity(file:string):DependencySealIdentity{
  const info=lstatSync(file,{bigint:true});
  if(!info.isFile()||info.nlink!==1n||(info.mode&0o222n)!==0n)throw dependencySealError(file);
  return Object.fromEntries(DEPENDENCY_SEAL_FIELDS.map(key=>[key,String(info[key])])) as DependencySealIdentity;
}
export function dependencySealError(record:string):Error&{code:string}{
  return Object.assign(new Error('oracle dependency seal changed: '+record),{code:'NTS_ORACLE_SEAL_CHANGED'});
}
/** Only exact owned canonical handoffs can carry a run seal. */
export function ownsDependencyRun(cap:{seal?:DependencyRunSeal},env:NodeJS.ProcessEnv,required=false):boolean{
  if(!required&&!cap.seal)return false;
  const raw=env.NTS_ORACLE_DEPENDENCIES,declared=env.NTS_GATE_ENV_CONTEXT;
  if(!declared){if(required)throw dependencySealError(cap.seal?.record??'missing canonical run');return false;}
  try{
    const context=JSON.parse(declared);
    if(!raw||JSON.stringify(cap)!==raw||context.report?.version!==1||context.owned?.NTS_ORACLE_DEPENDENCIES!==raw||context.report.host?.NTS_ORACLE_DEPENDENCIES!==raw)throw Error('invalid owned handoff');
    return true;
  }catch{throw dependencySealError(cap.seal?.record??'invalid canonical handoff');}
}
/** One lstat and compare; no source, package, Git or helper-process work. */
export function dependencySealReady(cap:{version:number;directory:string;ownerStep?:string|null;admission?:{kind:string;temporary?:{parent:string}};seal?:DependencyRunSeal},env:NodeJS.ProcessEnv=process.env,nodeVersion=process.versions.node):string|null{
  if(!ownsDependencyRun(cap,env))return null;
  const began=performance.now(),seal=cap.seal!,record=join(cap.directory,'node-'+nodeVersion,'ready.json');
  const identity=seal.identity;
  if(cap.version!==1||seal.version!==1||seal.record!==record||seal.nodeVersion!==nodeVersion||!isAbsolute(cap.directory)||
     !/^26\.\d+\.\d+$/.test(nodeVersion)||!identity||Object.keys(identity).sort().join(',')!==[...DEPENDENCY_SEAL_FIELDS].sort().join(',')||
     DEPENDENCY_SEAL_FIELDS.some(key=>typeof identity[key]!=='string'||!/^\d+$/.test(identity[key]))||
     !/^[0-9a-f]{64}$/.test(seal.readySha256)||!/^[0-9a-f]{64}$/.test(seal.semanticSha256))throw dependencySealError(record);
  try{const actual=dependencySealIdentity(record);if(DEPENDENCY_SEAL_FIELDS.some(key=>actual[key]!==identity[key]))throw dependencySealError(record);}
  catch{throw dependencySealError(record);}
  // Telemetry never changes product authority and never fsyncs a hit.
  try{
    const root=cap.admission?.kind==='gate'?cap.admission.temporary?.parent:cap.directory;
    if(root)appendFileSync(join(root,'oracle-dependency-calls.jsonl'),JSON.stringify({version:1,step:cap.ownerStep??null,nodeVersion,directory:dirname(record),mode:'hit',sealed:true,helperProcess:false,wallMs:performance.now()-began,pnpmSelectionCommands:0})+'\n');
  }catch{}
  return record;
}

/** A parent-pinned metadata file. Its path is relative to one snapshot. */
export type OracleSnapshotReference=Readonly<{path:string;sha256:string}>;
/** A record moved out of its bucket: its JSON's hash and size, and the content-addressed chunks it is written in, none past the bucket bound. */
export type SnapshotMovedRecord={sha256:string;bytes:number;chunks:{sha256:string;bytes:number}[]};
type SnapshotBucket={version:1;slot:number;entries:([string,unknown]|[string,null,SnapshotMovedRecord])[]};
export type SnapshotSlotIndex={version:2;slots:number;slotBytes:40;table:OracleSnapshotReference;data:OracleSnapshotReference&{bytes:number}};
// Capture descriptor operations and hashing before governed code replaces
// public builtin methods. Every returned value comes from these checked bytes.
const snapshotIO={open:openSync,read:readSync,close:closeSync,stat:fstatSync,kind:lstatSync};
const snapshotCryptoHash=cryptoHash;
export const snapshotHash=(bytes:Buffer|string)=>snapshotCryptoHash('sha256',bytes,'buffer');
export const snapshotSlot=(key:string,slots:number)=>snapshotHash(key).readUInt32LE(0)&(slots-1);
export const SNAPSHOT_SLOT_BYTES=40,MAX_SNAPSHOT_SLOTS=65536,MAX_SNAPSHOT_BUCKET_RECORDS=64,MAX_SNAPSHOT_BUCKET_BYTES=16*2**20;
const snapshotReference=(directory:string,reference:OracleSnapshotReference,extension:'json'|'bin'='json')=>{
  if(!reference||Object.keys(reference).sort().join(',')!=='path,sha256'||
     typeof reference.path!=='string'||typeof reference.sha256!=='string'||
     !/^[a-f0-9]{64}$/.test(reference.sha256)||reference.path!=='runtime-index/'+reference.sha256+'.'+extension)
    throw Error('oracle snapshot metadata reference is invalid');
  const path=resolve(directory,reference.path),part=relative(directory,path);
  if(part==='..'||part.startsWith('..'+sep)||isAbsolute(part))throw Error('oracle snapshot metadata escapes its owner');
  return path;
};
const snapshotRead=(file:string,size?:number,offset=0,expectedSize?:number):Buffer=>{
  const fd=snapshotIO.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const info=snapshotIO.stat(fd),count=size??info.size;
    if(!info.isFile()||expectedSize!==undefined&&info.size!==expectedSize||!Number.isSafeInteger(count)||count<0||offset<0||offset+count>info.size||count>(size===undefined?65536:MAX_SNAPSHOT_BUCKET_BYTES))throw Error('oracle snapshot metadata size changed: '+file);
    const bytes=Buffer.allocUnsafe(count);let at=0;
    while(at<count){const read=snapshotIO.read(fd,bytes,at,count-at,offset+at);if(!read)throw Error('oracle snapshot metadata read changed: '+file);at+=read;}
    return bytes;
  }finally{snapshotIO.close(fd);}
};
const hex64=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const snapshotSize=(value:unknown,most:number):value is number=>Number.isSafeInteger(value)&&(value as number)>0&&(value as number)<=most;
/** A moved record's row, checked before any of its chunks is opened. */
class SnapshotMoved {
  readonly record:SnapshotMovedRecord;
  constructor(record:SnapshotMovedRecord){
    const keys=(value:object,names:string)=>Object.keys(value).sort().join(',')===names;
    if(typeof record!=='object'||record===null||!keys(record,'bytes,chunks,sha256')||!hex64(record.sha256)||!snapshotSize(record.bytes,Number.MAX_SAFE_INTEGER)
       ||!Array.isArray(record.chunks)||!record.chunks.length
       ||record.chunks.some(chunk=>typeof chunk!=='object'||chunk===null||!keys(chunk,'bytes,sha256')||!hex64(chunk.sha256)||!snapshotSize(chunk.bytes,MAX_SNAPSHOT_BUCKET_BYTES))
       ||record.chunks.reduce((sum,chunk)=>sum+chunk.bytes,0)!==record.bytes)
      throw Error('oracle snapshot metadata moved record is malformed');
    this.record=record;
  }
}
/** One parent-root identity and private checked table per reader. Only the
 * selected bucket is read, and a moved record only when its key is asked
 * for; missing keys never prove filesystem absence. */
export function readOracleSnapshotIndex(directory:string,root:OracleSnapshotReference){
  const directoryInfo=snapshotIO.kind(join(directory,'runtime-index'));
  if(!directoryInfo.isDirectory()||directoryInfo.isSymbolicLink())throw Error('oracle snapshot metadata directory changed');
  const bytes=snapshotRead(snapshotReference(directory,root));
  if(snapshotHash(bytes).toString('hex')!==root.sha256)throw Error('oracle snapshot metadata descriptor changed');
  const descriptor=JSON.parse(bytes.toString('utf8')) as SnapshotSlotIndex;
  if(!descriptor||Object.keys(descriptor).sort().join(',')!=='data,slotBytes,slots,table,version'||descriptor.version!==2||descriptor.slotBytes!==SNAPSHOT_SLOT_BYTES||!Number.isInteger(descriptor.slots)||descriptor.slots<1||descriptor.slots>MAX_SNAPSHOT_SLOTS||(descriptor.slots&(descriptor.slots-1))!==0||!descriptor.data||Object.keys(descriptor.data).sort().join(',')!=='bytes,path,sha256'||!Number.isSafeInteger(descriptor.data.bytes)||descriptor.data.bytes<0||descriptor.data.bytes>=2**32)throw Error('oracle snapshot metadata descriptor is malformed');
  const table=snapshotRead(snapshotReference(directory,descriptor.table,'bin'),descriptor.slots*SNAPSHOT_SLOT_BYTES,0,descriptor.slots*SNAPSHOT_SLOT_BYTES);
  if(snapshotHash(table).toString('hex')!==descriptor.table.sha256)throw Error('oracle snapshot metadata table changed');
  const data=snapshotReference(directory,{path:descriptor.data.path,sha256:descriptor.data.sha256},'bin'),cache=new Map<number,Map<string,unknown>>();
  // Observation only; deterministic guards bind these to actual read/hash sites.
  const cost={descriptorBytes:bytes.length,tableBytes:table.length,bucketBytes:0,bucketReads:0,recordsParsed:0,authenticationHashes:2,movedReads:0,movedBytes:0};
  // Each chunk at its exact recorded size, into one buffer: the record is
  // parsed only once every chunk and then the whole record has been checked.
  const movedValue=({record}:SnapshotMoved):unknown=>{
    const whole=Buffer.allocUnsafe(record.bytes);let at=0;
    for(const chunk of record.chunks){
      const file=snapshotReference(directory,{path:'runtime-index/'+chunk.sha256+'.bin',sha256:chunk.sha256},'bin');
      let fd:number;
      try{fd=snapshotIO.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);}
      catch(error){throw Error('oracle snapshot metadata moved record chunk is missing: '+file,{cause:error});}
      try{
        const info=snapshotIO.stat(fd);if(!info.isFile()||info.size!==chunk.bytes)throw Error('oracle snapshot metadata size changed: '+file);
        for(let done=0;done<chunk.bytes;){const read=snapshotIO.read(fd,whole,at+done,chunk.bytes-done,done);if(!read)throw Error('oracle snapshot metadata read changed: '+file);done+=read;}
      }finally{snapshotIO.close(fd);}
      cost.authenticationHashes++;
      if(snapshotHash(whole.subarray(at,at+chunk.bytes)).toString('hex')!==chunk.sha256)throw Error('oracle snapshot metadata changed: moved record chunk');
      at+=chunk.bytes;
    }
    cost.authenticationHashes++;cost.movedReads++;cost.movedBytes+=record.bytes;
    if(snapshotHash(whole).toString('hex')!==record.sha256)throw Error('oracle snapshot metadata changed: moved record');
    return JSON.parse(whole.toString('utf8'));
  };
  return {get cost(){return Object.freeze({...cost});},get(key:string):unknown{
    if(typeof key!=='string')throw Error('oracle snapshot metadata query key is invalid');
    const slot=snapshotSlot(key,descriptor.slots),previous=cache.get(slot);
    if(previous){
      const value=previous.get(key);if(!(value instanceof SnapshotMoved))return value;
      const read=movedValue(value);previous.set(key,read);return read;
    }
    const offset=table.readUInt32LE(slot*SNAPSHOT_SLOT_BYTES),length=table.readUInt32LE(slot*SNAPSHOT_SLOT_BYTES+4),entries=new Map<string,unknown>();
    if(length){
      if(length>MAX_SNAPSHOT_BUCKET_BYTES||offset+length>descriptor.data.bytes)throw Error('oracle snapshot metadata bucket bounds changed');
      const bytes=snapshotRead(data,length,offset,descriptor.data.bytes);cost.bucketReads++;cost.bucketBytes+=bytes.length;cost.authenticationHashes++;
      if(!snapshotHash(bytes).equals(table.subarray(slot*SNAPSHOT_SLOT_BYTES+8,(slot+1)*SNAPSHOT_SLOT_BYTES)))throw Error('oracle snapshot metadata changed: bucket');
      const record=JSON.parse(bytes.toString('utf8')) as SnapshotBucket;
      if(!record||Object.keys(record).sort().join(',')!=='entries,slot,version'||record.version!==1||record.slot!==slot||!Array.isArray(record.entries)||record.entries.length<1||record.entries.length>MAX_SNAPSHOT_BUCKET_RECORDS)throw Error('oracle snapshot metadata bucket is malformed');
      for(const row of record.entries){
        if(!Array.isArray(row)||!(row.length===2||row.length===3&&row[1]===null)||typeof row[0]!=='string'||entries.has(row[0])||snapshotSlot(row[0],descriptor.slots)!==slot)throw Error('oracle snapshot metadata bucket has invalid or duplicate keys');
        entries.set(row[0],row.length===3?new SnapshotMoved(row[2]):row[1]);cost.recordsParsed++;
      }
    }else if(offset!==0||!table.subarray(slot*SNAPSHOT_SLOT_BYTES+8,(slot+1)*SNAPSHOT_SLOT_BYTES).equals(Buffer.alloc(32)))throw Error('oracle snapshot metadata empty slot is malformed');
    cache.set(slot,entries);
    const value=entries.get(key);if(!(value instanceof SnapshotMoved))return value;
    const read=movedValue(value);entries.set(key,read);return read;
  }};
}

export type NodeResolutionOptions={flags:string[];nodeOptions:string};
export type NodeExecutableIdentity={dev:string;ino:string};
export type NodeResolutionSession={version:1;directory:string;token:string;nodeVersion:string;nodeSha256:string;executable:NodeExecutableIdentity;holder:{pid:number;birth:string};owner:{pid:number;birth:string};options:NodeResolutionOptions;conditions:{esm:string[];cjs:string[]};helperSha256:string};
const executableStat=statSync,processIdentityRead=readFileSync;
export const nodeExecutableIdentity=(pid:number):NodeExecutableIdentity=>{const info=executableStat('/proc/'+pid+'/exe',{bigint:true});return {dev:String(info.dev),ino:String(info.ino)};};
export const nodeProcessBirth=(pid:number)=>{const text=processIdentityRead('/proc/'+pid+'/stat','utf8'),end=text.lastIndexOf(')');if(end<0)throw Error('invalid process identity');const fields=text.slice(end+2).split(' ');if(fields[0]==='Z'||!fields[19])throw Error('process is not alive');return fields[19];};
export const nodeProcessAlive=(owner:{pid:number;birth:string})=>{try{return nodeProcessBirth(owner.pid)===owner.birth;}catch{return false;}};
export function nodeResolutionOptions(flags:string[],env:NodeJS.ProcessEnv=process.env,bootstrap?:string,preloads:readonly string[]=[]):NodeResolutionOptions{
  // Keep all execution flags, except the exact owned bootstrap and these
  // presentation/profiling options. Unknown options never silently reuse a
  // probe. NODE_OPTIONS remains exact, including its original spelling.
  const execution:string[]=[];
  for(let index=0;index<flags.length;index++){
    const flag=flags[index]!;
    if(flag==='--import'&&(flags[index+1]===bootstrap||preloads.includes(flags[index+1]??''))){index++;continue;}
    // Node's esm/resolve.js applies input-type only to the initial string
    // entry, never imported file URLs. The driver text is not a resolver flag.
    if(['-e','--eval','-p','--print'].includes(flag)){index++;continue;}
    if(flag==='--input-type'){index++;continue;}
    if(flag.startsWith('--input-type='))continue;
    if(flag==='--no-warnings'||flag==='--enable-source-maps'||flag==='--no-enable-source-maps'||flag==='--cpu-prof'||flag==='--heap-prof')continue;
    if(/^--(?:cpu|heap)-prof-(?:dir|name|interval)(?:=|$)/.test(flag)){if(!flag.includes('='))index++;continue;}
    execution.push(flag);
  }
  return {flags:execution,nodeOptions:env.NODE_OPTIONS??''};
}
export function checkNodeResolutionSession(session:NodeResolutionSession,options:NodeResolutionOptions):void{
  try{
    if(session.version!==1||session.nodeVersion!==process.versions.node||JSON.stringify(session.options)!==JSON.stringify(options))throw Error('oracle resolution options identity changed');
    if(!/^[a-f0-9]{64}$/.test(session.nodeSha256)||!nodeProcessAlive(session.holder)||!nodeProcessAlive(session.owner))throw Error('oracle Node executable holder changed');
    const self=nodeExecutableIdentity(process.pid),holder=nodeExecutableIdentity(session.holder.pid);
    if(self.dev!==session.executable.dev||self.ino!==session.executable.ino||holder.dev!==self.dev||holder.ino!==self.ino)throw Error('oracle Node executable holder changed');
  }catch(error){if(error instanceof Error&&error.message.startsWith('oracle '))throw error;throw Error('oracle Node executable holder changed',{cause:error});}
}

export type ObservationKind='file'|'fileExists'|'directoryExists'|'entries'|'realpath'|'readlink'|'runtimeEntries'|'runtimeKind';
export type DirectoryEntries={files:string[];directories:string[]};
export type HostObservation={kind:ObservationKind;path:string;value:string|null|boolean|DirectoryEntries|string[]};
/** Immutable output namespaces; the construction count is a deterministic cost guard. */
export class OraclePathPrefixes{
  readonly paths:readonly string[];
  readonly constructionMemberships:number;
  private readonly roots:Set<string>;
  private readonly descendants=new Map<string,readonly string[]>();
  constructor(paths:Iterable<string>){
    const all=new Set([...paths].map(path=>resolve(path)));let memberships=0;
    this.paths=Object.freeze([...all].filter(root=>{
      for(let parent=dirname(root);parent!==root;parent=dirname(parent)){
        memberships++;if(all.has(parent))return false;
        if(parent===dirname(parent))break;
      }
      return true;
    }));
    this.roots=new Set(this.paths);
    const descendants=new Map<string,string[]>();
    for(const root of this.paths)for(let parent=root;;parent=dirname(parent)){
      memberships++;
      const children=descendants.get(parent)??[];children.push(root);descendants.set(parent,children);
      if(parent===dirname(parent))break;
    }
    for(const [parent,children] of descendants)this.descendants.set(parent,Object.freeze(children));
    this.constructionMemberships=memberships;
  }
  private covering(path:string,cost?:{memberships:number}):string|undefined{
    for(let parent=resolve(path);;parent=dirname(parent)){
      if(cost)cost.memberships++;
      if(this.roots.has(parent))return parent;
      if(parent===dirname(parent))return undefined;
    }
  }
  has(path:string,cost?:{memberships:number}){return this.covering(path,cost)!==undefined;}
  /** Only namespaces capable of excluding a member of these captured roots. */
  overlapping(paths:Iterable<string>):string[]{
    const result=new Set<string>();
    for(const path of paths){
      const root=resolve(path),ancestor=this.covering(root);
      if(ancestor!==undefined)result.add(ancestor);
      else for(const child of this.descendants.get(root)??[])result.add(child);
    }
    return [...result];
  }
}
export type CapturedModulePath=string&{readonly capturedModulePath:unique symbol};
export type CapturedAlias={path:string;target:string};
/** Canonical module identity through the captured graph, with no host reads. */
export function capturedModuleIdentity(aliases:readonly CapturedAlias[]|((path:string)=>string|undefined)){
  const links=new Map<string,string>(),owners=new Map<string,CapturedModulePath|null>();
  for(const alias of typeof aliases==='function'?[]:aliases){
    if(!alias||Object.keys(alias).sort().join(',')!=='path,target'||!isAbsolute(alias.path)||!isAbsolute(alias.target)||links.has(alias.path))throw Error('invalid oracle captured alias identity');
    links.set(alias.path,alias.target);
  }
  const target=(path:string)=>typeof aliases==='function'?aliases(path):links.get(path);
  const identity=(path:string,active:Set<string>,trace?:Set<string>):CapturedModulePath|null=>{
    if(!isAbsolute(path))throw Error('oracle module identity is not absolute');
    path=resolve(path);const parts:string[]=[];
    for(let part=path;;part=dirname(part)){parts.push(part);if(part===parse(part).root)break;}
    // Follow the first link encountered from the filesystem root, as Node
    // does, rather than looking up an alias spelling as another module.
    const alias=parts.reverse().find(part=>target(part)!==undefined);
    if(!alias)return path as CapturedModulePath;
    if(active.has(alias))return null;
    let owner:CapturedModulePath|null|undefined;
    if(trace){trace.add(alias);owner=identity(target(alias)!,new Set([...active,alias]),trace);}
    else{owner=owners.get(alias);if(owner===undefined){owner=identity(target(alias)!,new Set([...active,alias]));owners.set(alias,owner);}}
    return owner===null?null:identity(resolve(owner,relative(alias,path)),active,trace);
  };
  for(const alias of links.keys())if(!owners.has(alias))owners.set(alias,identity(links.get(alias)!,new Set([alias])));
  const canonical=(path:string)=>identity(path,new Set());
  canonical.trace=(path:string)=>{const aliases=new Set<string>(),owner=identity(path,new Set(),aliases);return {path:owner,aliases:[...aliases]};};
  return canonical;
}
/** Coverage metadata from the unique, already captured package bytes. */
function valid(observation:HostObservation):void{
  if(!observation||typeof observation!=='object'||Object.keys(observation).sort().join(',')!=='kind,path,value'||
     typeof observation.path!=='string'||!isAbsolute(observation.path))throw Error('invalid oracle filesystem observation');
  const value=observation.value;
  switch(observation.kind){
    case 'file':if(value===null||typeof value==='string'&&/^[0-9a-f]{64}$/.test(value))return;break;
    case 'fileExists':case 'directoryExists':if(typeof value==='boolean')return;break;
    case 'realpath':if(typeof value==='string'&&isAbsolute(value))return;break;
    case 'readlink':if(value===null||typeof value==='string')return;break;
    case 'runtimeEntries':if(Array.isArray(value)&&value.every(name=>typeof name==='string'&&!name.includes(sep)&&name!=='.'&&name!=='..'))return;break;
    case 'runtimeKind':if(value===null||['file','directory','symlink','other'].includes(value as string))return;break;
    case 'entries':if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='directories,files'&&
      (['files','directories'] as const).every(key=>Array.isArray(value[key])&&value[key].every(name=>typeof name==='string'&&!name.includes(sep)&&name!=='.'&&name!=='..')))return;break;
  }
  throw Error('invalid oracle filesystem '+observation.kind+' observation: '+observation.path);
}
export function sameOracleObservation(a:HostObservation['value'],b:HostObservation['value']){
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&JSON.stringify(a)===JSON.stringify(b);
  if(a&&b&&typeof a==='object'&&typeof b==='object')return JSON.stringify([a.files,a.directories])===JSON.stringify([b.files,b.directories]);
  return a===b;
}
export function validateRuntimeObservations(observations:HostObservation[],read:(kind:ObservationKind,path:string)=>HostObservation['value']):{count:number;wallMs:number}{
  const start=performance.now();
  if(!Array.isArray(observations))throw Error('oracle filesystem observations are missing');
  for(const observation of observations){
    valid(observation);
    if(!sameOracleObservation(observation.value,read(observation.kind,observation.path)))
      throw Error(`oracle filesystem ${observation.kind} changed: ${observation.path}`);
  }
  return {count:observations.length,wallMs:performance.now()-start};
}

export type ResolutionPackageFact={directory:string;valid:boolean;main:string|null;name:string|null;exports:unknown};
/** Candidate suffixes from Node's legacyMainResolve; all selection stays in Node. */
export const ORACLE_NODE_RESOLUTION_RECIPE=Object.freeze({version:1,nodeMajors:Object.freeze([26]),extensions:Object.freeze(['.js','.json','.node']),
  mainSuffixes:Object.freeze(['','.js','.json','.node','/index.js','/index.json','/index.node']),
  packageIndexSuffixes:Object.freeze(['/index.js','/index.json','/index.node'])});
export function oracleLegacyMainQueries(directory:string,main:string|null):string[]{
  return [...(main?ORACLE_NODE_RESOLUTION_RECIPE.mainSuffixes.map(suffix=>resolve(directory,main+suffix)):[]),
    ...ORACLE_NODE_RESOLUTION_RECIPE.packageIndexSuffixes.map(suffix=>resolve(directory,'.'+suffix))];
}
export type ResolutionDomainRecord={recipe:typeof ORACLE_NODE_RESOLUTION_RECIPE;roots:string[];excluded:string[];aliases:CapturedAlias[];files:string[];directories:string[];absent:string[];scopeAbsent:string[];moduleAbsent:string[];packages:ResolutionPackageFact[]};
export type SparseResolutionDomainRecord={recipe:typeof ORACLE_NODE_RESOLUTION_RECIPE;roots:string[];excluded:string[]|Pick<OraclePathPrefixes,'has'>;aliases:(path:string)=>string|undefined;lookup:(path:string)=>{kind:string|null;absent?:boolean;scopeAbsent?:boolean;moduleAbsent?:boolean;package?:Omit<ResolutionPackageFact,'directory'>}|undefined};
export type ResolutionQuery={kind:'file'|'package'|'node_modules';path:string};
export type ResolutionProof={complete:boolean;queries:ResolutionQuery[];reason?:string};
const intrinsicFileURLToPath=fileURLToPath,IntrinsicURL=URL;
/** Node's ESM finalizeResolution validates the file URL before its first
 * filesystem query. This proves only that Node will reject it, never absence. */
export function oracleFileUrlErrorProof(request:{nodeMajor:number;mode:'esm'|'cjs';specifier:string}):ResolutionProof|undefined{
  if(request.mode!=='esm'||!ORACLE_NODE_RESOLUTION_RECIPE.nodeMajors.includes(request.nodeMajor)||!/^file:/i.test(request.specifier))return;
  try{
    const url=new IntrinsicURL(request.specifier);
    if(url.protocol!=='file:')return;
    intrinsicFileURLToPath(url);
  }catch(error){
    if(error&&typeof error==='object'&&'code' in error&&(error.code==='ERR_INVALID_FILE_URL_HOST'||error.code==='ERR_INVALID_FILE_URL_PATH'))return {complete:true,queries:[]};
  }
  return;
}
/** One immutable data authority. It enumerates queries, never a selected file. */
export class OracleResolutionDomain{
  private readonly identity:ReturnType<typeof capturedModuleIdentity>;
  private readonly roots:OraclePathPrefixes;
  private readonly excluded:Pick<OraclePathPrefixes,'has'>;
  private readonly files:Pick<Set<string>,'has'>;
  private readonly directories:Pick<Set<string>,'has'>;
  private readonly absent:Pick<Set<string>,'has'>;
  private readonly scopeAbsent:Pick<Set<string>,'has'>;
  private readonly moduleAbsent:Pick<Set<string>,'has'>;
  private readonly packages:Pick<Map<string,ResolutionPackageFact>,'get'>;
  constructor(record:ResolutionDomainRecord|SparseResolutionDomainRecord){
    if(JSON.stringify(record.recipe)!==JSON.stringify(ORACLE_NODE_RESOLUTION_RECIPE))throw Error('oracle resolution recipe is unsupported');
    this.identity=capturedModuleIdentity(record.aliases);
    const owner=(path:string)=>{const key=this.identity(path);if(key===null)throw Error('oracle cyclic resolution identity: '+path);return key;};
    const keys=(paths:string[])=>new Set(paths.map(owner));
    this.roots=new OraclePathPrefixes(record.roots.map(owner));this.excluded=Array.isArray(record.excluded)?new OraclePathPrefixes(record.excluded.map(owner)):record.excluded;
    if('lookup' in record){
      this.files={has:path=>record.lookup(path)?.kind==='file'};
      this.directories={has:path=>record.lookup(path)?.kind==='directory'};
      this.absent={has:path=>record.lookup(path)?.absent===true};
      this.scopeAbsent={has:path=>record.lookup(path)?.scopeAbsent===true};
      this.moduleAbsent={has:path=>record.lookup(path)?.moduleAbsent===true};
      this.packages={get:path=>{const fact=record.lookup(join(path,'package.json'))?.package;return fact?{directory:path,...fact}:undefined;}};
      return;
    }
    this.files=keys(record.files);this.directories=keys(record.directories);this.absent=keys(record.absent);this.scopeAbsent=keys(record.scopeAbsent);this.moduleAbsent=keys(record.moduleAbsent);
    const packages=new Map<string,ResolutionPackageFact>();this.packages=packages;
    for(const fact of record.packages){
      const key=owner(fact.directory),value={...structuredClone(fact),directory:key},previous=this.packages.get(key);
      if(previous&&JSON.stringify(previous)!==JSON.stringify(value))throw Error('conflicting oracle package facts: '+key);
      packages.set(key,value);
    }
  }
  /** Exact file membership in the same finite namespace used by resolution. */
  queryFile(path:string):ResolutionProof&{file?:boolean}{
    const key=this.identity(path),complete=key!==null&&!this.excluded.has(key)&&
      (this.files.has(key)||this.directories.has(key)||this.absent.has(key)||this.roots.has(key));
    return {complete,queries:[{kind:'file',path}],...(complete?{file:this.files.has(key!)}:{reason:'unobserved captured file: '+path})};
  }
  prove(request:{nodeMajor:number;mode:'esm'|'cjs';specifier:string;parent:string;direct?:string;extensions?:readonly string[]}):ResolutionProof{
    const queries:ResolutionQuery[]=[],seen=new Set<string>();let reason:string|undefined;
    if(!ORACLE_NODE_RESOLUTION_RECIPE.nodeMajors.includes(request.nodeMajor))return {complete:false,queries,reason:'unsupported Node resolution recipe'};
    const rejected=oracleFileUrlErrorProof(request);if(rejected)return rejected;
    if(request.mode==='cjs'&&JSON.stringify(request.extensions)!==JSON.stringify(ORACLE_NODE_RESOLUTION_RECIPE.extensions))return {complete:false,queries,reason:'unproved CommonJS extension registry'};
    const fail=(message:string)=>{reason??=message;return false;};
    const own=(path:string)=>this.identity(path);
    const complete=(path:string)=>{const key=own(path);return key!==null&&(this.files.has(key)||this.roots.has(key))&&!this.excluded.has(key);};
    const query=(kind:ResolutionQuery['kind'],path:string)=>{const key=kind+'\0'+path;if(!seen.has(key)){seen.add(key);queries.push({kind,path});}};
    const scopes=(file:string):{complete:boolean;fact?:ResolutionPackageFact}=>{
      for(let directory=dirname(file);;directory=dirname(directory)){
        // Node stops package scope at a node_modules boundary.
        if(directory.split(sep).at(-1)==='node_modules')return {complete:true};
        const path=join(directory,'package.json'),key=own(path);query('package',path);
        if(key===null)return {complete:fail('cyclic package scope')};
        const fact=this.packages.get(own(directory)!);
        if(fact)return {complete:true,fact};
        if(this.files.has(key))return {complete:fail('missing package facts for captured metadata: '+path)};
        if(!this.scopeAbsent.has(key)&&!complete(path))return {complete:fail('unobserved package scope: '+path)};
        if(directory===dirname(directory))break;
      }
      return {complete:true};
    };
    const candidate=(path:string)=>{
      query('file',path);const key=own(path);
      if(key===null||!complete(path))return fail('incomplete module candidate: '+path);
      return !this.files.has(key)||scopes(path).complete&&scopes(key).complete;
    };
    const direct=(path:string)=>{
      query('file',path);const key=own(path);
      if(key===null)return fail('cyclic direct module');
      // A runtime-rewritten TS route is not an observed missing JS module.
      if(!this.files.has(key)&&!this.directories.has(key)&&!this.absent.has(key))return fail('unprepared direct module request: '+path);
      if(!complete(path))return fail('incomplete direct module domain: '+path);
      return !this.files.has(key)||scopes(path).complete&&scopes(key).complete;
    };
    // Node26 legacyMainResolve: main itself, three extensions, three
    // main/index variants, then three package/index fallbacks. No selection.

    const metadata=(directory:string)=>{
      const path=join(directory,'package.json'),key=own(directory);query('package',path);
      return key===null?undefined:this.packages.get(key);
    };
    const exportTargets=(directory:string,value:unknown):boolean=>{
      if(value===null)return true;
      if(typeof value==='string'){
        if(!value.startsWith('./')||value.includes('*')||value.includes('%')||value.includes('\\'))return fail('unproved package export target');
        return candidate(resolve(directory,value));
      }
      if(Array.isArray(value))return value.every(item=>exportTargets(directory,item));
      if(value&&typeof value==='object'){
        if(Object.keys(value).some(key=>key.includes('*')))return fail('unproved package export pattern');
        return Object.values(value).every(item=>exportTargets(directory,item));
      }
      return fail('unproved package exports shape');
    };
    const packageDomain=(directory:string,subpath:string,mode:'esm'|'cjs'='esm'):boolean=>{
      const fact=metadata(directory);
      if(!candidate(join(directory,'package.json')))return false;
      if(fact&&!fact.valid)return true; // Node owns the original parse error.
      if(mode==='esm'&&fact?.exports!=null)return exportTargets(directory,fact.exports);
      if(subpath)return candidate(resolve(directory,subpath));
      return oracleLegacyMainQueries(directory,fact?.main??null).every(candidate);
    };
    if(request.mode==='cjs'){
      if(!isAbsolute(request.specifier)||!request.direct||!isAbsolute(request.direct))fail('unproved CommonJS route');
      else {
        if([request.direct,...ORACLE_NODE_RESOLUTION_RECIPE.extensions.map(ext=>request.direct+ext)].every(candidate)){
          const key=own(request.direct);
          if(key!==null&&this.directories.has(key))packageDomain(request.direct,'','cjs');
        }
      }
    }else if(request.direct)direct(request.direct);
    else {
      const specifier=request.specifier;
      if(specifier.startsWith('#')||specifier.includes('%')||specifier.includes('\\')||specifier.split('/').some(part=>part==='.'||part==='..'))fail('unproved ESM request kind');
      else {
        const parts=specifier.split('/'),count=specifier.startsWith('@')?2:1,name=parts.slice(0,count).join('/'),subpath=parts.slice(count).join('/');
        if(!name||count===2&&parts.length<2||parts.some(part=>!part)||name.startsWith('.')||name.includes(':'))fail('unproved ESM package name');
        else {
          const scope=scopes(request.parent);
          if(!scope.complete)return {complete:false,queries,reason};
          const self=scope.fact;
          if(self&&!self.valid)return {complete:true,queries};
          if(self?.name===name&&self.exports!=null)packageDomain(self.directory,subpath);
          else {
            
            for(let directory=dirname(request.parent);;directory=dirname(directory)){
              const modules=join(directory,'node_modules'),target=join(modules,name),key=own(target),moduleKey=own(modules);query('node_modules',target);
              if(key!==null&&this.directories.has(key)){packageDomain(target,subpath);break;}
              if(moduleKey===null||!this.moduleAbsent.has(moduleKey)&&!complete(target)){fail('unobserved node_modules query: '+target);break;}
              if(directory===dirname(directory))break;
            }
            // If every ancestor lookup through filesystem root was observed
            // missing, Node owns the ordinary package-not-found exception.
          }
        }
      }
    }
    return {complete:reason===undefined,queries,...(reason?{reason}:{})};
  }
}


export type OracleChildState='reserved'|'begun'|'ready'|'launch-failed';
const eventJSONParse=JSON.parse,eventArrayIsArray=Array.isArray;
/** The parent reader and private launch observer share one exact grammar. */
export function parseOracleLoaderEvents(raw:string){
  if(!raw.endsWith('\n')||!raw.trim())throw Error('oracle loader status is empty or truncated');
  const children=new Map<string,OracleChildState>();let ready=false,instrument:string|undefined;
  for(const line of raw.slice(0,-1).split('\n')){
    const event=eventJSONParse(line);
    if(!event||typeof event!=='object'||eventArrayIsArray(event)||event.version!==1)throw Error('invalid oracle loader status');
    if(['child-start','child-begin','child-ready','child-launch-failed'].includes(event.status)){
      if(Object.keys(event).length!==3||typeof event.execution!=='string'||!/^execution-[A-Za-z0-9-]+$/.test(event.execution))throw Error('invalid oracle child event');
      const previous=children.get(event.execution);
      if(event.status==='child-start'&&previous===undefined)children.set(event.execution,'reserved');
      else if(event.status==='child-begin'&&previous==='reserved')children.set(event.execution,'begun');
      else if(event.status==='child-ready'&&previous==='begun')children.set(event.execution,'ready');
      else if(event.status==='child-launch-failed'&&previous==='reserved')children.set(event.execution,'launch-failed');
      else throw Error('unknown, duplicate or out-of-order oracle child completion');
    }else if(event.status==='ready'&&Object.keys(event).length===2)ready=true;
    else if(event.status==='instrument'&&Object.keys(event).length===3&&typeof event.reason==='string')instrument??=event.reason;
    else throw Error('invalid oracle loader status');
  }
  return {ready,instrument,children};
}
