import {lstatSync,readdirSync,type Stats} from 'node:fs';
import {join} from 'node:path';
import type {DirectoryEntry,MemberType} from './reader-inputs/main.ts';

/** Never dereference a link to decide a metadata type. */
export function memberType(stat:Stats):MemberType{
  return stat.isSymbolicLink()?'symlink':stat.isFile()?'file':stat.isDirectory()?'directory':'other';
}

export function directoryEntries(path:string):DirectoryEntry[]{
  return readdirSync(path).sort().map(name=>({name,type:memberType(lstatSync(join(path,name)))}));
}
