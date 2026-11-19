// One selector projection; callback causes remain in the canonical snapshot
// and runtime evidence, never in a role payload which does not consume them.
import type {ByteInputDeclaration,InputSnapshot} from './module-closure.ts';
import type {ReaderProtocol,DirectoryDeclaration,MembershipDeclaration,OptionalFileDeclaration} from './reader-inputs/main.ts';
import {selectionInput} from './reader-inputs/main.ts';
import {readerObservationProjection,type ReaderDependency} from './reader-observations.ts';

export type RustSelectorRoles={files:string[];moduleFiles:string[];placingFiles:string[];
  directories:(Omit<DirectoryDeclaration,'files'>&{fileCount:number})[];optionalFiles:OptionalFileDeclaration[];memberships:MembershipDeclaration[];byteInputs:ByteInputDeclaration[];
  typedDependencies:{reader:string;protocol:ReaderProtocol;dependency:ReaderDependency}[]};

// Traversal order is not a role. Keep every declared occurrence, but give the
// producer one order independently of Program or snapshot acquisition order.
function ordered<T>(rows:T[]):T[]{
  return rows.map(row=>({key:JSON.stringify(row),row})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map(({row})=>row);
}

export function rustSelectorRoles(root:string,snapshot:InputSnapshot,byteInputs:readonly ByteInputDeclaration[]):RustSelectorRoles{
  return {files:[...snapshot.files],moduleFiles:[...snapshot.moduleFiles],placingFiles:[...snapshot.placingFiles],
    directories:ordered(structuredClone(snapshot.directories.map(({files,...row})=>({...row,fileCount:files.length})))),
    optionalFiles:ordered(snapshot.optionalFiles.filter(selectionInput).map(({reader,path,present,context})=>structuredClone({reader,path,present,context}))),memberships:ordered(structuredClone(snapshot.memberships)),byteInputs:ordered(byteInputs.map(row=>({...row}))),
    typedDependencies:ordered(snapshot.observations.flatMap(row=>{
      if(row.observationOnly)return [];
      const dependency=readerObservationProjection(root,row);return dependency?[{reader:row.reader,protocol:row.protocol,dependency}]:[];
    }))};
}
