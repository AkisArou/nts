// Replay the original typed facts. Existence/stat never acquires bytes, and a
// byte copier cannot silently certify source timestamps on a copied object.
import {isAbsolute,join,posix,relative,resolve,sep} from 'node:path';
import {captureToolchain,toolchainDescriptor,toolchainFact,type Capture} from '../differential/oracle-toolchain.ts';
import {OracleFilesystem,readHostObservation,validateHostObservations} from '../differential/oracle-filesystem.ts';
import {readdirSync} from 'node:fs';
import type {HostObservation} from '../differential/oracle-runtime.ts';
import type {InputSnapshot,ReaderObservation} from './module-closure.ts';
import {metadataParents,membershipIndex,type MetadataChange} from './reader-metadata.ts';
import {generatedProjectFact} from './generated-project.ts';
import {projectEnvironmentFact} from './project-environment.ts';
import {projectDependencies} from './project-dependencies.ts';

/** The original callback remains unchanged. Additional real observations
 * retain alias text, intermediate presence/kind and followed target identity.
 * Metadata callbacks derive no content reads. */
export function captureReaderObservations(root:string,rows:readonly HostObservation[]):Pick<ReaderObservation,'observation'|'causes'>[]{
  let cause:{kind:HostObservation['kind'];path:string}|undefined;
  const causes=new Map<string,Map<string,NonNullable<typeof cause>>>();
  const filesystem=new OracleFilesystem(row=>{
    if(!cause)throw Error('reader identity observation has no callback provenance');
    const key=JSON.stringify([row.kind,row.path]),values=causes.get(key)??new Map();
    values.set(JSON.stringify(cause),{...cause});causes.set(key,values);
  });
  for(const row of rows){
    cause={kind:row.kind,path:row.path};filesystem.merge([row]);
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
  return filesystem.captured().map(observation=>({observation:structuredClone(observation),causes:[...causes.get(JSON.stringify([observation.kind,observation.path]))!.values()]}));
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
export type ReaderDependency={path:string;kind:HostObservation['kind'];bytes:boolean;directoryStat:boolean;context:ReaderObservation['context']};
export function readerObservationProjection(root:string,row:ReaderObservation):ReaderDependency|undefined{
  const dependency=readerObservationDependency(root,row);
  return dependency?{...dependency,kind:row.observation.kind,context:structuredClone(row.context)}:undefined;
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
    const supplied=dependencyOf(row);if(!supplied)continue;
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
export function validateReaderBatchObservations(snapshots:readonly InputSnapshot[]):void{
  const installed=derivedReaderValidator(),facts=new Map<string,string>();
  for(const snapshot of snapshots)for(const row of snapshot.observations){
    const key=JSON.stringify([row.observation.kind,row.observation.path]),answer=JSON.stringify(row.observation.value);
    // Each authority descriptor is checked even when another row has the
    // same answer: equality cannot lend declared provenance to ambient rows.
    if(row.environment||row.dependency)installed(row);
    const previous=facts.get(key);
    if(previous!==undefined){
      if(previous!==answer)throw Error('reader batch observation changed during discovery: '+row.observation.kind+' '+row.observation.path);
      continue;
    }
    facts.set(key,answer);
    if(!installed(row))validateHostObservations([row.observation]);
  }
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
}
