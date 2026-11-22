// Replay the original typed facts. Existence/stat never acquires bytes, and a
// byte copier cannot silently certify source timestamps on a copied object.
import {isAbsolute,join,posix,relative,resolve,sep} from 'node:path';
import {captureToolchain,toolchainDescriptor,toolchainFact,type Capture} from '../differential/oracle-toolchain.ts';
import {OracleFilesystem,readHostObservation,validateHostObservations} from '../differential/oracle-filesystem.ts';
import {readdirSync} from 'node:fs';
import {sameOracleObservation,type HostObservation} from '../differential/oracle-runtime.ts';
import type {InputSnapshot,ReaderObservation} from './module-closure.ts';
import {metadataParents,membershipIndex,type MetadataChange} from './reader-metadata.ts';
import {generatedProjectFact} from './generated-project.ts';
import {projectEnvironmentFact} from './project-environment.ts';
import {projectDependencies} from './project-dependencies.ts';
import {projectDiscoveryOwner} from './project-discovery.ts';

/** The original callback remains unchanged. Additional real observations
 * retain alias text, intermediate presence/kind and followed target identity.
 * Metadata callbacks derive no content reads. */
export function readerObservationCapture(root:string){
  let cause:{kind:HostObservation['kind'];path:string}|undefined;
  let acquisitionOnly=false,closed=false;
  const causes=new Map<string,Map<string,NonNullable<typeof cause>>>();
  const only=new Map<string,boolean>(),sourceCauses=new Map<string,NonNullable<typeof cause>>(),files=new Set<string>();
  let addedFiles:string[]=[];
  const filesystem=new OracleFilesystem(row=>{
    if(!cause)throw Error('reader identity observation has no callback provenance');
    const key=JSON.stringify([row.kind,row.path]),values=causes.get(key)??new Map();
    values.set(JSON.stringify(cause),cause);causes.set(key,values);
    only.set(key,(only.get(key)??true)&&acquisitionOnly);
    if(row.kind==='file'&&row.value!==null&&!files.has(row.path)){files.add(row.path);addedFiles.push(row.path);}
  });
  return {add(rows:readonly HostObservation[],matchingEntries:ReadonlySet<string>=new Set()):string[]{
  if(closed)throw Error('reader observation capture is closed');
  addedFiles=[];
  for(const row of rows){
    const key=JSON.stringify([row.kind,row.path]);
    cause=sourceCauses.get(key);if(!cause){cause={kind:row.kind,path:row.path};sourceCauses.set(key,cause);}
    acquisitionOnly=row.kind==='entries'&&matchingEntries.has(row.path);filesystem.merge([row]);
    const follow=!['readlink','runtimeKind'].includes(row.kind),physical=filesystem.inputIdentity(row.path,root,follow).path;
    if(physical!==row.path){
      switch(row.kind){
        case 'file':filesystem.readBytes(physical);break;
        case 'stat':filesystem.stat(physical);break;
        case 'fileExists':filesystem.fileExists(physical);break;
        case 'directoryExists':filesystem.directoryExists(physical);break;
        case 'entries':filesystem.getAccessibleEntries(physical);break;
        case 'runtimeEntries':filesystem.runtimeEntries(physical);break;
        case 'runtimeKind':filesystem.runtimeKind(physical);break;
        case 'readlink':filesystem.readlink(physical);break;
        case 'realpath':filesystem.fileExists(physical);filesystem.directoryExists(physical);break;
      }
    }
    if(row.kind==='entries'){
      let names:string[];
      try{names=readdirSync(row.path);}catch(error){if(!['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))throw error;names=[];}
      for(const name of names){
        const child=join(row.path,name),target=filesystem.inputIdentity(child,root).path;
        if(target!==child){filesystem.fileExists(target);filesystem.directoryExists(target);}
      }
    }
  }
  return addedFiles;
  },finish():Pick<ReaderObservation,'observation'|'causes'|'observationOnly'>[]{
    if(closed)throw Error('reader observation capture is closed');closed=true;
    return filesystem.captured().map(observation=>{
      const key=JSON.stringify([observation.kind,observation.path]);
      return {observation:structuredClone(observation),causes:[...causes.get(key)!.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,cause])=>cause),...(only.get(key)?{observationOnly:true as const}:{})};
    });
  }};
}
/** A standalone transaction uses the same owner as a snapshot's Programs. */
export function captureReaderObservations(root:string,rows:readonly HostObservation[]):Pick<ReaderObservation,'observation'|'causes'>[]{
  const capture=readerObservationCapture(root);capture.add(rows);return capture.finish();
}

export type CapturedReaderObservation=Omit<ReaderObservation,'reader'|'context'|'protocol'>;
/** One reader/context's snapshot transaction. Identical authority can share
 * an answer; another descriptor must still pass its own validator. */
export function projectObservationCapture(root:string){
  const capture=readerObservationCapture(root),facts=new Map<string,CapturedReaderObservation>();
  const descriptors=new Map<string,object>(),identities=new WeakMap<object,{key:string;value:object}>();
  const causes=new Map<string,ReaderObservation['causes'][number]>();
  const causeMembers=new Map<CapturedReaderObservation,Set<ReaderObservation['causes'][number]>>();
  let closed=false;
  function descriptor<T extends object>(input:T):{key:string;value:T}{
    const previous=identities.get(input);if(previous)return previous as {key:string;value:T};
    const key=JSON.stringify(input),value=descriptors.get(key)??structuredClone(input),entry={key,value};
    descriptors.set(key,value);identities.set(input,entry);return entry as {key:string;value:T};
  }
  function merge(row:CapturedReaderObservation):void{
    const capability=row.capability?descriptor(row.capability):undefined,environment=row.environment?descriptor(row.environment):undefined,dependency=row.dependency?descriptor(row.dependency):undefined;
    const key=JSON.stringify([row.observation.kind,row.observation.path,capability?.key,environment?.key,dependency?.key,!!row.selectorOnly]);
    let retained=facts.get(key);
    if(retained){
      if(!sameOracleObservation(retained.observation.value,row.observation.value))throw Error('project observation changed during capture: '+row.observation.kind+' '+row.observation.path);
    }else{
      retained={observation:structuredClone(row.observation),causes:[],...(capability?{capability:capability.value}:{}),...(environment?{environment:environment.value}:{}),...(dependency?{dependency:dependency.value}:{}),...(row.selectorOnly?{selectorOnly:true as const}:{}),...(row.observationOnly?{observationOnly:true as const}:{})};
      facts.set(key,retained);causeMembers.set(retained,new Set());
    }
    const members=causeMembers.get(retained)!;
    for(const cause of row.causes){
      const key=JSON.stringify(cause);let shared=causes.get(key);if(!shared){shared={...cause};causes.set(key,shared);}
      if(!members.has(shared)){members.add(shared);retained.causes.push(shared);}
    }
    if(!row.observationOnly)delete retained.observationOnly;
  }
  return {add(rows:readonly HostObservation[],matchingEntries?:ReadonlySet<string>):string[]{
    if(closed)throw Error('project observation capture is closed');return capture.add(rows,matchingEntries);
  },merge(rows:readonly CapturedReaderObservation[]):string[]{
    if(closed)throw Error('project observation capture is closed');
    for(const row of rows)merge(row);
    return rows.flatMap(row=>row.observation.kind==='file'&&row.observation.value!==null?[row.observation.path]:[]);
  },retain(row:CapturedReaderObservation):void{
    if(closed)throw Error('project observation capture is closed');
    if(!row.capability&&!row.environment&&!row.dependency&&!row.selectorOnly)throw Error('typed project observation needs its authority');
    merge(row);
  },finish():CapturedReaderObservation[]{
    if(closed)throw Error('project observation capture is closed');
    for(const row of capture.finish())merge(row);
    closed=true;
    for(const row of facts.values())row.causes.sort((a,b)=>{const x=JSON.stringify(a),y=JSON.stringify(b);return x<y?-1:x>y?1:0;});
    return [...facts].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,row])=>row);
  }};
}

export function readerObservationDependency(root:string,row:ReaderObservation):{path:string;bytes:boolean;directoryStat:boolean}|undefined{
  if(row.capability||row.environment||row.dependency)return;
  const path=relative(root,row.observation.path).split(sep).join('/');
  if(path==='..'||path.startsWith('../')||isAbsolute(path))return;
  const value=row.observation.value,directoryStat=row.observation.kind==='stat'&&!!value&&typeof value==='object'&&'mode' in value&&(value.mode&0o170000)===0o040000;
  return {path,bytes:row.observation.kind==='file'||row.observation.kind==='stat'&&row.observation.value!==null&&!directoryStat,directoryStat};
}

/** A selector projection retains sensitivity, provenance and paths; it is
 * never a reusable filesystem answer for a copier or runtime consumer. */
export type ReaderDependency={path:string;kind:HostObservation['kind'];bytes:boolean;directoryStat:boolean;context:ReaderObservation['context'];observationOnly?:true};
export function readerObservationProjection(root:string,row:ReaderObservation):ReaderDependency|undefined{
  const dependency=readerObservationDependency(root,row);
  return dependency?{...dependency,kind:row.observation.kind,context:structuredClone(row.context),...(row.observationOnly?{observationOnly:true as const}:{})}:undefined;
}
export function readerObservationIndex<R extends ReaderObservation>(root:string,rows:Iterable<R>,paths:Iterable<string>,names?:ReturnType<typeof membershipIndex>){
  return readerDependencyIndex(rows,row=>readerObservationProjection(root,row),paths,names);
}

/** Typed facts retain their original kinds. Only facts beside a changed path,
 * or below a changed ancestor, are considered; a full census never rescans
 * every observation for every tracked file. */
export function readerDependencyIndex<R>(rows:Iterable<R>,dependencyOf:(row:R)=>ReaderDependency|undefined,paths:Iterable<string>,names?:ReturnType<typeof membershipIndex>){
  const tracked=new Set(paths),members=names??membershipIndex(tracked),directories=new Map<string,Set<R>>(),ancestors=new Map<string,Set<R>>();
  const dependencies=new Map<R,ReaderDependency>();
  const add=(map:Map<string,Set<R>>,path:string,row:R)=>{const values=map.get(path)??new Set<R>();values.add(row);map.set(path,values);};
  for(const row of rows){
    const supplied=dependencyOf(row);if(!supplied||supplied.observationOnly)continue;
    const dependency=structuredClone(supplied);dependencies.set(row,dependency);
    for(let parent=dependency.path;;parent=posix.dirname(parent)){
      add(ancestors,parent==='.'?'':parent,row);if(parent===''||parent==='.')break;
    }
    if(dependency.directoryStat||['entries','runtimeEntries','directoryExists','runtimeKind'].includes(dependency.kind))add(directories,dependency.path,row);
  }
  let nested:Map<string,number>|undefined;
  const descendants=(path:string)=>{
    if(!nested){nested=new Map();for(const file of tracked)for(let parent=posix.dirname(file);;parent=posix.dirname(parent)){
      const key=parent==='.'?'':parent;nested.set(key,(nested.get(key)??0)+1);if(parent==='.')break;
    }}
    return nested.get(path)??0;
  };
  const under=(path:string,file:string)=>path===''||file===path||file.startsWith(path+'/');
  function typeChanged(path:string,kind:string,changes:readonly MetadataChange[]):boolean{
    const before={leaf:Number(tracked.has(path)),nested:descendants(path)},after={...before};
    const merged=new Map<string,{added:boolean;deleted:boolean}>();
    for(const change of changes){
      if(!under(path,change.path))continue;
      if(change.path===path){
        if(!change.added&&!change.deleted&&change.sameMode===true)continue;
        return true;
      }
      const row=merged.get(change.path)??{added:false,deleted:false};row.added||=!!change.added;row.deleted||=!!change.deleted;merged.set(change.path,row);
    }
    for(const [file,change]of merged){
      if(!change.added&&!change.deleted)continue;
      if(tracked.has(file)){before.nested--;after.nested--;}
      if(change.deleted)before.nested++;if(change.added)after.nested++;
    }
    if(kind==='directoryExists')return (before.nested>0)!==(after.nested>0);
    const shape=(value:typeof before)=>value.nested?'directory':value.leaf?'leaf':'absent';
    return shape(before)!==shape(after);
  }
  return {affected(changes:readonly MetadataChange[]):Map<R,string[]>{
    const candidates=new Map<R,Set<string>>();
    const touch=(row:R,path:string)=>{const subjects=candidates.get(row)??new Set<string>();subjects.add(path);candidates.set(row,subjects);};
    for(const change of changes){
      for(const row of ancestors.get(change.path)??[])touch(row,change.path);
      for(let parent=change.path;;parent=posix.dirname(parent)){
        for(const row of directories.get(parent==='.'?'':parent)??[])touch(row,change.path);
        if(parent==='.')break;
      }
    }
    const affected=new Map<R,string[]>();
    for(const [row,subjects]of candidates){
      const dependency=dependencies.get(row)!,path=dependency.path,kind=dependency.kind;
      const ancestor=changes.some(change=>change.path!==path&&under(change.path,path)
        &&(dependency.bytes||kind==='readlink'||change.added||change.deleted||change.sameMode!==true));
      let changed=ancestor;
      if(!changed&&!dependency.bytes){
        if(['entries','runtimeEntries'].includes(kind)||dependency.directoryStat){
          changed=members.affected({directory:path,context:{entry:dependency.context.entry,dataNamespaces:{}}},changes)
            ||dependency.directoryStat&&changes.some(change=>(posix.dirname(change.path)==='.'?'':posix.dirname(change.path))===path);
        }else if(kind==='directoryExists'||kind==='runtimeKind')changed=typeChanged(path,kind,changes);
        else changed=changes.some(change=>change.path===path&&(kind==='readlink'||change.added||change.deleted||change.sameMode!==true));
      }
      if(changed)affected.set(row,[...subjects]);
    }
    return affected;
  }};
}

function nameIn(root:string,path:string):string{
  const name=relative(root,path);
  if(name==='..'||name.startsWith('..'+sep)||isAbsolute(name))throw Error('reader observation needs an external capability: '+path);
  return name.split(sep).join('/');
}
/** Capability replay stays at the authenticated installed paths. It never
 * maps a package fact into a copied root or substitutes private source bytes. */
function derivedReaderValidator(source?:string){
  const captures=new Map<string,Capture>();
  const dependencies=new Map<string,ReturnType<typeof projectDependencies>>();
  return (row:ReaderObservation):boolean=>{
    if(row.dependency){
      const descriptor=row.dependency;
      if(row.protocol!=='project'||descriptor.kind!=='installed-project-dependency'||source!==undefined&&descriptor.source!==resolve(source))throw Error('installed project dependency has no declared source');
      const key=JSON.stringify([descriptor.source,descriptor.catalog]);
      let current=dependencies.get(key);if(!current){current=projectDependencies(descriptor.source,descriptor.catalog);dependencies.set(key,current);}
      if(current.state!=='current')throw Error('installed project dependency catalog is pending: '+current.reason);
      const actual=current.match(row.observation);
      if(!actual||JSON.stringify(actual)!==JSON.stringify(descriptor))throw Error('installed project dependency identity changed: '+row.observation.path);
      validateHostObservations([row.observation]);return true;
    }
    if(row.environment){
      if(row.protocol!=='project'||source!==undefined&&row.environment.source!==resolve(source)||!projectEnvironmentFact(row.environment,row.observation))throw Error('reader project host absence has no declared Program provenance: '+row.observation.path);
      if(readHostObservation('runtimeKind',row.observation.path)!==null)throw Error('reader project host absence is now present: '+row.observation.path);
      validateHostObservations([row.observation]);return true;
    }
    if(!row.capability)return false;
    const descriptor=row.capability;
    if(descriptor.kind==='generated-project'){
      if(!generatedProjectFact(descriptor,row.observation))throw Error('generated project fact does not match its prepared recipe: '+row.observation.path);
      return true;
    }
    if(descriptor.kind!=='typescript-sdk')throw Error('unknown installed reader capability');
    let capture=captures.get(descriptor.root);
    if(!capture){capture=captureToolchain(descriptor.root);captures.set(descriptor.root,capture);}
    if(JSON.stringify(toolchainDescriptor(capture))!==JSON.stringify(descriptor)||!toolchainFact(capture,row.observation))
      throw Error('reader observation is not an authenticated installed SDK fact: '+row.observation.path);
    validateHostObservations([row.observation]);return true;
  };
}
/** One explicit batch validates every distinct answer before returning any
 * snapshot. Deduplication changes only the number of identical replay reads;
 * conflicting answers refuse, and no fact supplies ownership to another row. */
export function validateReaderBatchObservations(snapshots:readonly InputSnapshot[],source:string):void{
  const installed=derivedReaderValidator(),facts=new Map<string,string>();
  const authorityKeys=new WeakMap<object,string>(),authorities=new Map<string,Set<string>>();
  for(const snapshot of snapshots)for(const row of snapshot.observations){
    const key=JSON.stringify([row.observation.kind,row.observation.path]),answer=JSON.stringify(row.observation.value);
    const previous=facts.get(key);
    if(previous!==undefined&&previous!==answer)throw Error('reader batch observation changed during discovery: '+row.observation.kind+' '+row.observation.path);
    // Equal answers share a replay only under equal authority. A different
    // SDK or Program descriptor must still pass its own provenance check.
    const authority=row.dependency??row.environment??row.capability;
    if(authority){
      let identity=authorityKeys.get(authority);if(identity===undefined){identity=JSON.stringify(authority);authorityKeys.set(authority,identity);}
      const checked=authorities.get(identity)??new Set<string>(),subject=JSON.stringify([row.protocol,key]);
      if(!checked.has(subject)){installed(row);checked.add(subject);authorities.set(identity,checked);}
    }else if(previous===undefined){
      validateHostObservations([row.observation]);
    }
    facts.set(key,answer);
  }
  validateProjectMatches(snapshots.flatMap(snapshot=>snapshot.projectMatches),source);
}
/** Matching is replayed by the pinned parser; raw acquisition facts above
 * still guard races and grant no cross-tree selection meaning. */
function validateProjectMatches(matches:InputSnapshot['projectMatches'],source:string):void{
  if(!matches.length)return;
  const owner=projectDiscoveryOwner(source),seen=new Map<string,string>();
  try{for(const match of matches){
    const key=JSON.stringify(match.request),expected=JSON.stringify(match.files),previous=seen.get(key);
    if(previous!==undefined){if(previous!==expected)throw Error('project discovery changed during capture: '+match.request.path);continue;}
    seen.set(key,expected);
    if(JSON.stringify(owner.read(match.request).files)!==expected)throw Error('project discovery matched files changed: '+match.request.path+' ('+match.reader+')');
  }}finally{owner.close();}
}
/** ENOTDIR is an exact negative, witnessed by this callback's own regular
 * blocking component. It grants neither leaf bytes nor alias authority. */
function blockedReaderNegative(snapshot:InputSnapshot,row:ReaderObservation,source:string):boolean{
  const {kind,path,value}=row.observation;
  if(!((kind==='fileExists'||kind==='directoryExists')&&value===false||(kind==='file'||kind==='stat')&&value===null))return false;
  const filesystem=new OracleFilesystem(),identity=filesystem.inputIdentity(path,source);
  if(identity.state!=='not-directory'||identity.kind!=='file'||identity.component===path
    ||filesystem.captured().some(fact=>fact.kind==='readlink'&&fact.value!==null))return false;
  const context=JSON.stringify(row.context);
  const witness=snapshot.observations.some(fact=>fact.reader===row.reader&&fact.protocol===row.protocol&&JSON.stringify(fact.context)===context
    &&fact.observation.kind==='runtimeKind'&&fact.observation.path===identity.component&&fact.observation.value==='file'
    &&fact.causes.some(cause=>cause.kind===kind&&cause.path===path));
  if(!witness)return false;
  metadataParents(source,identity.component,'reader blocking component');
  return true;
}
export function validateReaderSourceObservations(snapshot:InputSnapshot,source:string):void{
  const owned=new Set(snapshot.ownedFiles),installed=derivedReaderValidator(source);
  for(const row of snapshot.observations){
    if(installed(row))continue;
    const name=nameIn(source,row.observation.path);
    if(name!=='')try{metadataParents(source,row.observation.path,'reader observation');}
    catch(error){if(!blockedReaderNegative(snapshot,row,source))throw error;}
    if(row.observation.kind==='file'&&row.observation.value!==null&&!owned.has(name))
      throw Error('reader byte observation has no immutable owned input: '+name+' ('+row.reader+')');
    validateHostObservations([row.observation]);
  }
  validateProjectMatches(snapshot.projectMatches,source);
}

export class NonPortableReaderObservation extends Error{
  readonly reader:string;readonly protocol:ReaderObservation['protocol'];
  readonly source:HostObservation;readonly destination:HostObservation;
  readonly causes:ReaderObservation['causes'];readonly context:ReaderObservation['context'];
  constructor(row:ReaderObservation,destination:HostObservation){
    super('fixture reader observation is not portable: '+row.reader+' ['+row.protocol+'] '+row.observation.kind+' '+row.observation.path+
      '\nsource='+JSON.stringify(row.observation)+'\ndestination='+JSON.stringify(destination));
    this.reader=row.reader;this.protocol=row.protocol;this.source=structuredClone(row.observation);this.destination=structuredClone(destination);
    this.causes=structuredClone(row.causes);this.context=structuredClone(row.context);
  }
}

/** These parser/Node facts carry no data ownership. A context's namespace
 * prefix cannot substitute them, including immutable byte overlap. */
export function replayFixtureReaderObservations(snapshot:InputSnapshot,source:string,destination:string,
  fixtureEntries:ReadonlySet<string>,sourceLinks=false):void{
  source=resolve(source);destination=resolve(destination);
  const owned=new Set(snapshot.ownedFiles),installed=derivedReaderValidator(source);
  for(const row of snapshot.observations){
    if(row.context.entry!=='<entry>'&&!fixtureEntries.has(row.context.entry))continue;
    if(row.observationOnly)continue;
    if(row.dependency)throw Error('fixture requires its own authenticated installation for declared Program: '+row.reader);
    if(installed(row))continue;
    const name=nameIn(source,row.observation.path),path=join(destination,name);
    if(name!=='')metadataParents(destination,path,'fixture reader observation');
    const actual:HostObservation={kind:row.observation.kind,path,value:readHostObservation(row.observation.kind,path)};
    let expected=row.observation.value;
    if(row.observation.kind==='realpath'){
      if(typeof expected!=='string')throw Error('invalid reader realpath observation: '+row.observation.path);
      const mapped=join(destination,nameIn(source,expected));
      // Only previously checked immutable production links retain the source
      // identity. This never admits arbitrary metadata-only ancestor links.
      expected=sourceLinks&&owned.has(name)&&actual.value===expected?expected:mapped;
    }
    try{validateHostObservations([{kind:row.observation.kind,path,value:expected}],()=>actual.value);}
    catch{throw new NonPortableReaderObservation(row,actual);}
  }
  // A source's absent external owner cannot certify a different destination
  // ancestry. Replay the very same nearest-config operation for its modules.
  const ownerLookups=new Set<string>(),filesystem=new OracleFilesystem();
  for(const row of snapshot.observations){
    if(row.context.entry!=='<entry>'&&!fixtureEntries.has(row.context.entry))continue;
    for(const program of row.environment?.programs??[])for(const entry of program.ownerLookups??[])ownerLookups.add(entry);
  }
  for(const entry of ownerLookups){
    const nearest=filesystem.projectFor(filesystem.realpath(join(destination,entry)));
    if(nearest!==null)throw Error('fixture nearest-config ancestry differs for '+entry+': '+nearest);
  }
  validateProjectMatches(snapshot.projectMatches.filter(row=>row.context.entry==='<entry>'||fixtureEntries.has(row.context.entry)),destination);
}
