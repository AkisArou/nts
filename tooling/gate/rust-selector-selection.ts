import {join,relative,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fileInput} from './reader-inputs/main.ts';
import {readRustRuntimeManifest,type RustRuntimeTarget} from './rust-runtime-declarations.ts';
import {selectorInstalledSdk,selectorTrackedFiles,selectorDependencyCatalog} from './rust-selector-inputs.ts';
import {readDependencyCatalog,readDependencyCatalogTrust} from '../inputs/dependency-catalog.ts';
import {acceptedRustSelectorIdentity,rustSelectorRecordAtBlob,selectRustInputs,type RustSelectorTrust} from './rust-selector.ts';
import {liveRustSelectorTargets} from './rust-selector-live.ts';
import {cargoRuntimeTargets} from './cargo-inputs.ts';
import {selectorHash,RUST_SELECTOR_RECORD} from './rust-selector-material.ts';
import type {CommittedSelectorSource} from './owed-range.ts';

const DECLARATIONS=fileInput(new URL('./rust-runtime-inputs.json',import.meta.url));
export const RUST_RUNTIME_DECLARATIONS=relative(fileURLToPath(new URL('../..',import.meta.url)),fileURLToPath(DECLARATIONS));
/** Omitted direct calls acquire main; explicit null remains absent. */
export type RustSelectorOptions=RustSelectorTrust&{readonly committedSource?:CommittedSelectorSource};
export function rustSelectorTrust(root:string,trust?:RustSelectorOptions):RustSelectorOptions{
  const blob=trust===undefined?acceptedRustSelectorIdentity(root)?.blob??null:trust.acceptedRustRecordBlob;
  if(blob!==null&&(typeof blob!=='string'||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(blob)))throw Error('Rust selector accepted blob input is malformed');
  const dependencyCatalog=trust===undefined?selectorDependencyCatalog(root):readDependencyCatalogTrust(trust.dependencyCatalog??null);
  const source=trust?.committedSource;
  if(source===undefined)return {acceptedRustRecordBlob:blob,dependencyCatalog};
  if(!source||typeof source.tree!=='string'||!isAbsolute(source.tree)||resolve(source.tree)!==source.tree
      ||typeof source.revision!=='string'||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(source.revision))throw Error('Rust selector committed source input is malformed');
  const committedSource={tree:source.tree,revision:source.revision,dependencyCatalog:readDependencyCatalogTrust(source.dependencyCatalog)};
  return {acceptedRustRecordBlob:blob,dependencyCatalog:committedSource.dependencyCatalog,committedSource};
}
export function rustSelectorInputs(root:string,inventory:readonly RustRuntimeTarget[],report:(message:string)=>void,trust:RustSelectorOptions){
  const source=trust.committedSource?.tree??root;
  if(selectorHash(cargoRuntimeTargets(source))!==selectorHash(inventory))throw Error('Rust selector Cargo inventory disagrees with the crate graph');
  const installed=selectorInstalledSdk(),catalog=readDependencyCatalog(trust.dependencyCatalog??null,source);
  const selected=selectRustInputs({root:source,candidatePath:join(root,RUST_SELECTOR_RECORD),key:{roots:{source,sdk:installed.root,native:installed.nativeRoot},inventory,tracked:selectorTrackedFiles(source),sdk:selectorInstalledSdk},
    accepted:()=>rustSelectorRecordAtBlob(root,trust),report,
    ...(catalog.state==='pending'?{catalogPending:catalog.reason}:{catalogCurrent:true}),
    live:()=>liveRustSelectorTargets({sourceRoot:source,inventory,manifest:readRustRuntimeManifest(join(source,RUST_RUNTIME_DECLARATIONS)),dependencyCatalog:trust.dependencyCatalog??null})});
  cargoRuntimeTargets(source);return selected;
}
