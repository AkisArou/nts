// Replay the original typed facts. Existence/stat never acquires bytes, and a
// byte copier cannot silently certify source timestamps on a copied object.
import {isAbsolute,join,posix,relative,resolve,sep} from 'node:path';
import {OracleFilesystem,readHostObservation,validateHostObservations} from '../differential/oracle-filesystem.ts';
import {readdirSync} from 'node:fs';
import type {HostObservation} from '../differential/oracle-runtime.ts';
import type {InputSnapshot,ReaderObservation} from './module-closure.ts';
import {metadataParents,membershipIndex,type MetadataChange} from './reader-metadata.ts';

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
    const follow=!['readlink','runtimeKind'].includes(row.kind),physical=filesystem.inputIdentity(row.path,root,follow);
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
        const child=join(row.path,name),target=filesystem.inputIdentity(child,root);
        if(target!==child){filesystem.fileExists(target);filesystem.directoryExists(target);}
      }
    }
  }
  return filesystem.captured().map(observation=>({observation:structuredClone(observation),causes:[...causes.get(JSON.stringify([observation.kind,observation.path]))!.values()]}));
}

export function readerObservationDependency(root:string,row:ReaderObservation):{path:string;bytes:boolean;directoryStat:boolean}|undefined{
  const path=relative(root,row.observation.path).split(sep).join('/');
  if(path==='..'||path.startsWith('../')||isAbsolute(path))return;
  const value=row.observation.value,directoryStat=row.observation.kind==='stat'&&!!value&&typeof value==='object'&&'mode' in value&&(value.mode&0o170000)===0o040000;
  return {path,bytes:row.observation.kind==='file'||row.observation.kind==='stat'&&!directoryStat,directoryStat};
}

/** Typed facts retain their original kinds. Only facts beside a changed path,
 * or below a changed ancestor, are considered; a full census never rescans
 * every observation for every tracked file. */
export function readerObservationIndex<R extends ReaderObservation>(root:string,rows:Iterable<R>,paths:Iterable<string>,names?:ReturnType<typeof membershipIndex>){
  const tracked=new Set(paths),members=names??membershipIndex(tracked),directories=new Map<string,Set<R>>(),ancestors=new Map<string,Set<R>>();
  const dependencies=new Map<R,NonNullable<ReturnType<typeof readerObservationDependency>>>();
  const add=(map:Map<string,Set<R>>,path:string,row:R)=>{const values=map.get(path)??new Set<R>();values.add(row);map.set(path,values);};
  for(const row of rows){
    const dependency=readerObservationDependency(root,row);if(!dependency)continue;dependencies.set(row,dependency);
    for(let parent=dependency.path;;parent=posix.dirname(parent)){
      add(ancestors,parent==='.'?'':parent,row);if(parent===''||parent==='.')break;
    }
    if(dependency.directoryStat||['entries','runtimeEntries','directoryExists','runtimeKind'].includes(row.observation.kind))add(directories,dependency.path,row);
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
      const dependency=dependencies.get(row)!,path=dependency.path,kind=row.observation.kind;
      const ancestor=changes.some(change=>change.path!==path&&under(change.path,path));
      let changed=ancestor;
      if(!changed&&!dependency.bytes){
        if(['entries','runtimeEntries'].includes(kind)||dependency.directoryStat){
          changed=members.affected({directory:path,context:{entry:row.context.entry,dataNamespaces:{}}},changes)
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
export function validateReaderSourceObservations(snapshot:InputSnapshot,source:string):void{
  const owned=new Set(snapshot.ownedFiles);
  for(const row of snapshot.observations){
    const name=nameIn(source,row.observation.path);
    if(name!=='')metadataParents(source,row.observation.path,'reader observation');
    if(row.observation.kind==='file'&&row.observation.value!==null&&!owned.has(name))
      throw Error('reader byte observation has no immutable owned input: '+name+' ('+row.reader+')');
    validateHostObservations([row.observation]);
  }
}

export class NonPortableReaderObservation extends Error{
  readonly reader:string;readonly protocol:ReaderObservation['protocol'];
  readonly source:HostObservation;readonly destination:HostObservation;
  constructor(row:ReaderObservation,destination:HostObservation){
    super('fixture reader observation is not portable: '+row.reader+' ['+row.protocol+'] '+row.observation.kind+' '+row.observation.path+
      '\nsource='+JSON.stringify(row.observation)+'\ndestination='+JSON.stringify(destination));
    this.reader=row.reader;this.protocol=row.protocol;this.source=structuredClone(row.observation);this.destination=structuredClone(destination);
  }
}

/** These parser/Node facts carry no data ownership. A context's namespace
 * prefix cannot substitute them, including immutable byte overlap. */
export function replayFixtureReaderObservations(snapshot:InputSnapshot,source:string,destination:string,
  fixtureEntries:ReadonlySet<string>,sourceLinks=false):void{
  source=resolve(source);destination=resolve(destination);
  const owned=new Set(snapshot.ownedFiles);
  for(const row of snapshot.observations){
    if(row.context.entry!=='<entry>'&&!fixtureEntries.has(row.context.entry))continue;
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
