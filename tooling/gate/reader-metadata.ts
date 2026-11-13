import {lstatSync,readdirSync,type Stats} from 'node:fs';
import {dirname,isAbsolute,join,relative,sep} from 'node:path';
import type {DirectoryEntry,MemberType} from './reader-inputs/main.ts';

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
  const part=relative(root,dirname(path));
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
