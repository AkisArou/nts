// A declared Program's installed reads owe repository pins. The finite
// installation catalog identifies packages; no prefix grants arbitrary bytes.
import {isAbsolute,relative,resolve,sep,posix} from 'node:path';
import {readDependencyCatalog,type DependencyCatalogTrust,type DependencyPackage} from '../inputs/dependency-catalog.ts';
import type {DependencyEntry} from '../inputs/dependency-inventory.ts';
import type {HostObservation} from '../differential/oracle-runtime.ts';

export type InstalledProjectDependency={kind:'installed-project-dependency';source:string;catalog:DependencyCatalogTrust;package?:DependencyPackage};
export function projectDependencies(source:string,trust:DependencyCatalogTrust|null){
  const read=readDependencyCatalog(trust,source);
  if(read.state==='pending')return {state:'pending' as const,reason:read.reason};
  const {catalog}=read,entries=new Map(catalog.entries.map(row=>[row.path.split(sep).join('/'),row]));
  const directories=new Set<string>();
  for(const row of entries.values()){
    if(row.kind==='directory')directories.add(row.path);
    for(let parent=posix.dirname(row.path);parent!=='.';parent=posix.dirname(parent))directories.add(parent);
  }
  const moduleRoots=catalog.identity.importers.map(path=>posix.join(path,'node_modules'));
  const packages=[...catalog.packages].sort((a,b)=>b.path.length-a.path.length);
  const under=(parent:string,path:string)=>path===parent||path.startsWith(parent+'/');
  function canonical(path:string,follow=true):string{
    let parts=path.split('/'),at='',links=0;
    while(parts.length){
      const next=posix.join(at,parts.shift()!),row=entries.get(next);
      if(row?.kind==='link'&&(follow||parts.length)){
        if(++links>40)throw Error('installed package catalog has a cyclic alias: '+path);
        const target=posix.normalize(posix.join(posix.dirname(next),row.target));
        if(target==='..'||target.startsWith('../')||target.startsWith('/'))throw Error('installed package catalog alias escapes its tree: '+next);
        parts=[...target.split('/'),...parts];at='';
      }else at=next;
    }
    return at;
  }
  const entry=(path:string):DependencyEntry|undefined=>entries.get(path);
  const kind=(path:string)=>{const row=entry(path);return row?.kind==='link'?'symlink':row?.kind??(directories.has(path)?'directory':null);};
  const compare=(a:string,b:string)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
  const children=(path:string)=>[...entries.keys()].filter(name=>posix.dirname(name)===path).map(name=>posix.basename(name)).sort(compare);
  const knownNegative=(path:string):boolean=>{
    for(let at=path;at!=='.';at=posix.dirname(at)){
      if(kind(at)!==null)return at!==path&&kind(at)!=='directory';
      if(entries.get(posix.dirname(at))?.kind==='directory')return true;
    }
    return false;
  };
  return {state:'current' as const,pins:[...new Set([...catalog.identity.inputs,...catalog.recipes].map(row=>row.path))],
    match(observation:HostObservation):InstalledProjectDependency|undefined{
      const local=relative(source,observation.path).split(sep).join('/');
      if(isAbsolute(local)||local==='..'||local.startsWith('../')||!moduleRoots.some(root=>under(root,local)))return;
      const physical=canonical(local),path=canonical(local,observation.kind!=='runtimeKind'&&observation.kind!=='readlink');
      const row=entry(path),actualKind=kind(path),negative=actualKind===null&&knownNegative(path);
      const selected=packages.find(row=>under(row.path,physical));
      let matches=false;
      switch(observation.kind){
        case 'file':matches=row?.kind==='file'&&!!selected?observation.value===row.sha256:negative&&observation.value===null;break;
        case 'fileExists':matches=(actualKind!==null||negative)&&observation.value===(actualKind==='file');break;
        case 'directoryExists':matches=(actualKind!==null||negative)&&observation.value===(actualKind==='directory');break;
        case 'runtimeKind':matches=(actualKind!==null||negative)&&observation.value===actualKind;break;
        case 'readlink':matches=(actualKind!==null||negative)&&observation.value===(row?.kind==='link'?row.target:null);break;
        case 'realpath':matches=observation.value===(kind(physical)!==null?resolve(source,physical):negative?observation.path:null);break;
        case 'stat':{
          const value=observation.value;
          matches=actualKind===null?negative&&value===null:!!value&&typeof value==='object'&&'mode' in value&&
            (actualKind==='file'?(value.mode&0o170000)===0o100000&&row?.kind==='file'&&value.size===row.bytes:(value.mode&0o170000)===0o040000)&&
            row!==undefined&&row.kind!=='link'&&(value.mode&0o777)===row.mode;
          break;
        }
        case 'runtimeEntries':matches=JSON.stringify(observation.value)===JSON.stringify(actualKind==='directory'?children(path):negative||actualKind==='file'?[]:null);break;
        case 'entries':{
          const names=actualKind==='directory'?children(path):[];
          const value={files:names.filter(name=>kind(canonical(posix.join(path,name)))==='file'),directories:names.filter(name=>kind(canonical(posix.join(path,name)))==='directory')};
          matches=(actualKind==='directory'||negative||actualKind==='file')&&JSON.stringify(observation.value)===JSON.stringify(value);break;
        }
      }
      if(!matches)throw Error('declared Program read is not in the authenticated installation catalog: '+observation.kind+' '+observation.path);
      return {kind:'installed-project-dependency',source,catalog:{...trust!},...(selected?{package:{...selected}}:{})};
    }};
}
