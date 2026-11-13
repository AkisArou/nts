import {lstatSync,readdirSync,type Stats} from 'node:fs';
import {dirname,isAbsolute,join,relative,sep} from 'node:path';
import type {DirectoryEntry,MemberType,MembershipDeclaration} from './reader-inputs/main.ts';

/** Never dereference a link to decide a metadata type. */
export function memberType(stat:Stats,path:string):MemberType{
  if(stat.isSymbolicLink())return 'symlink';
  if(stat.isFile())return 'file';
  if(stat.isDirectory())return 'directory';
  throw Error('reader metadata has an unsupported child type: '+path);
}

export function directoryEntries(path:string):DirectoryEntry[]{
  return readdirSync(path).sort().map(name=>({name,type:memberType(lstatSync(join(path,name)),join(path,name))}));
}

/** Check components before touching a leaf. lstat sees dangling links too;
 * ENOENT on realpath must never skip an existing symlinked ancestor. A missing
 * owned parent is harmless to an absence fact and is never created here. */
export function metadataParents(root:string,path:string,purpose:string):boolean{
  const part=relative(root,relative(root,path)===''?root:dirname(path));
  if(isAbsolute(part)||part==='..'||part.startsWith('..'+sep))throw Error(purpose+' escapes its metadata root: '+path);
  let current=root;
  for(const component of ['',...part.split(sep).filter(Boolean)]){
    current=join(current,component);
    let stat:Stats;
    try{stat=lstatSync(current);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
    if(!stat.isDirectory()||stat.isSymbolicLink())throw Error(purpose+' ancestor is not an owned directory: '+current);
  }
  return true;
}

export type MetadataChange={path:string;added?:boolean;deleted?:boolean;sameMode?:boolean};
type Counts={leaf:number;nested:number;fixed:boolean};
const under=(directory:string,path:string)=>path===directory||path.startsWith(directory+'/');
const childOf=(directory:string,path:string)=>directory===''?path:path.startsWith(directory+'/')?path.slice(directory.length+1):undefined;
const shape=(value:Counts)=>value.fixed||value.nested?'directory':value.leaf?'leaf':undefined;

/** The canonical graph supplies its tracked snapshot once. Cache child counts
 * privately per namespace; each query changes only touched children. Both
 * endpoint shapes are reconstructed together, independent of which endpoint
 * supplied the snapshot. Untracked children remain explicit staging facts;
 * they never suppress a committed structural obligation. */
export function membershipIndex(paths:Iterable<string>){
  const tracked=new Set(paths),groups=new Map<string,Map<string,Counts>>();
  function affected(row:Pick<MembershipDeclaration,'directory'|'context'>,changes:readonly MetadataChange[]):boolean{
    const directory=row.directory,grants=Object.keys(row.context.dataNamespaces).sort();
    if(grants.some(name=>under(name,directory)))return false;
    const key=JSON.stringify([directory,grants]);
    let baseline=groups.get(key);
    if(!baseline){
      baseline=new Map();
      for(const path of tracked){
        if(grants.some(name=>under(name,path)))continue;
        const local=childOf(directory,path);if(!local)continue;
        const slash=local.indexOf('/'),name=slash<0?local:local.slice(0,slash);
        const count=baseline.get(name)??{leaf:0,nested:0,fixed:false};
        if(slash<0)count.leaf++;else count.nested++;
        baseline.set(name,count);
      }
      // A granted directory and every ancestor needed to reach it exist in
      // the fixture regardless of the production population's first/last file.
      for(const grant of grants){
        const local=childOf(directory,grant);if(!local)continue;
        const name=local.split('/')[0]!;
        baseline.set(name,{leaf:0,nested:0,fixed:true});
      }
      groups.set(key,baseline);
    }
    const updates=new Map<string,{added:boolean;deleted:boolean;mayChangeType:boolean}>();
    for(const change of changes){
      const value=updates.get(change.path)??{added:false,deleted:false,mayChangeType:false};
      value.added||=change.added===true;value.deleted||=change.deleted===true;
      value.mayChangeType||=!change.added&&!change.deleted&&change.sameMode!==true;
      updates.set(change.path,value);
    }
    const touched=new Map<string,{before:Counts;after:Counts}>();
    for(const [path,change]of updates){
      if(grants.some(name=>under(name,path)))continue;
      if(path===directory)return true;
      const local=childOf(directory,path);if(!local)continue;
      const slash=local.indexOf('/'),name=slash<0?local:local.slice(0,slash),base=baseline.get(name)??{leaf:0,nested:0,fixed:false};
      if(base.fixed)continue;
      if(slash<0&&change.mayChangeType)return true;
      if(!change.added&&!change.deleted)continue;
      // A replacement at one leaf with unknown endpoint types remains owed.
      if(slash<0&&change.added&&change.deleted)return true;
      const pair=touched.get(name)??{before:{...base},after:{...base}},field=slash<0?'leaf':'nested';
      if(tracked.has(path)){pair.before[field]--;pair.after[field]--;}
      if(change.deleted)pair.before[field]++;
      if(change.added)pair.after[field]++;
      touched.set(name,pair);
    }
    return [...touched.values()].some(pair=>shape(pair.before)!==shape(pair.after));
  }
  return {affected};
}
