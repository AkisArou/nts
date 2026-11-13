// Replay the original typed facts. Existence/stat never acquires bytes, and a
// byte copier cannot silently certify source timestamps on a copied object.
import {isAbsolute,join,relative,resolve,sep} from 'node:path';
import {readHostObservation,validateHostObservations} from '../differential/oracle-filesystem.ts';
import type {HostObservation} from '../differential/oracle-runtime.ts';
import type {InputSnapshot,ReaderObservation} from './module-closure.ts';
import {metadataParents} from './reader-metadata.ts';

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
