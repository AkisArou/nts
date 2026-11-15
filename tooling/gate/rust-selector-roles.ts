// One selector projection; callback causes remain in the canonical snapshot
// and runtime evidence, never in a role payload which does not consume them.
import type {ByteInputDeclaration,InputSnapshot} from './module-closure.ts';
import type {ReaderProtocol,DirectoryDeclaration,MembershipDeclaration,OptionalFileDeclaration} from './reader-inputs/main.ts';
import {selectionInput} from './reader-inputs/main.ts';
import {readerObservationProjection,type ReaderDependency} from './reader-observations.ts';

export type RustSelectorRoles={files:string[];moduleFiles:string[];placingFiles:string[];
  directories:(Omit<DirectoryDeclaration,'files'>&{fileCount:number})[];optionalFiles:OptionalFileDeclaration[];memberships:MembershipDeclaration[];byteInputs:ByteInputDeclaration[];
  typedDependencies:{reader:string;protocol:ReaderProtocol;dependency:ReaderDependency}[]};

export function rustSelectorRoles(root:string,snapshot:InputSnapshot,byteInputs:readonly ByteInputDeclaration[]):RustSelectorRoles{
  return {files:[...snapshot.files],moduleFiles:[...snapshot.moduleFiles],placingFiles:[...snapshot.placingFiles],
    directories:structuredClone(snapshot.directories.map(({files,...row})=>({...row,fileCount:files.length}))),
    optionalFiles:snapshot.optionalFiles.filter(selectionInput).map(({reader,path,present,context})=>structuredClone({reader,path,present,context})),memberships:structuredClone(snapshot.memberships),byteInputs:byteInputs.map(row=>({...row})),
    typedDependencies:snapshot.observations.flatMap(row=>{
      const dependency=readerObservationProjection(root,row);return dependency?[{reader:row.reader,protocol:row.protocol,dependency}]:[];
    })};
}
