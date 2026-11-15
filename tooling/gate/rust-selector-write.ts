// The full check refreshes stale projections after landing. The records step
// independently rebuilds an edited current-key candidate before accepting it.
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {cargoRuntimeTargets,cargoInputPaths} from './cargo-inputs.ts';
import {RUST_RUNTIME_DECLARATIONS} from './rust-selector-selection.ts';
import {readRustRuntimeManifest} from './rust-runtime-declarations.ts';
import {buildRustSelectorMaterial,writeRustSelectorRecord} from './rust-selector-build.ts';
import {selectorInstalledSdk,selectorTrackedFiles} from './rust-selector-inputs.ts';
import {RUST_SELECTOR_RECORD,encodeRustSelectorRecord,loadRustSelectorCandidate,parseRustSelectorRecord,validateRustSelectorKey,MAX_RUST_SELECTOR_RECORD_BYTES} from './rust-selector-record.ts';
import {acceptedRustSelectorRecord,verifyRustSelectorDerivation} from './rust-selector.ts';
import {withCommittedSelectorSource,selectorQuestion,type CommittedSelectorSource} from './owed-range.ts';
import {gitArguments} from './git-arguments/main.ts';
import type {DependencyCatalogTrust} from '../inputs/dependency-catalog.ts';

export const RUST_SELECTOR_CASE=RUST_RUNTIME_DECLARATIONS;
function inputs(root:string,dependencyCatalog:DependencyCatalogTrust|null){
  const installed=selectorInstalledSdk(),inventory=cargoRuntimeTargets(root),tracked=selectorTrackedFiles(root);
  const key={roots:{source:root,sdk:installed.root,native:installed.nativeRoot},inventory,tracked,sdk:selectorInstalledSdk};
  const build=()=>buildRustSelectorMaterial({sourceRoot:root,manifest:readRustRuntimeManifest(join(root,RUST_RUNTIME_DECLARATIONS)),inventory:()=>cargoRuntimeTargets(root),
    declarations:RUST_RUNTIME_DECLARATIONS,cargoInputs:cargoInputPaths(root),tracked:()=>selectorTrackedFiles(root),installed,dependencyCatalog});
  return {key,build};
}
/** Derivation observes committed sources; the candidate remains the caller's
 * independently bounded working body. Ignored outputs never enter this key. */
export function withRustSelectorSource<T>(root:string,operation:(source:CommittedSelectorSource)=>T):T{
  const question=(args:string[])=>selectorQuestion('git',gitArguments(args),{purpose:'Rust selector committed source fence',cwd:root,maxBuffer:64<<20});
  const state=()=>({head:question(['rev-parse','--verify','HEAD']).trim(),
    dirty:question(['status','--porcelain=v2','-z','--untracked-files=no','--','.',':(exclude)'+RUST_SELECTOR_RECORD])});
  const before=state();let relevant=false;
  const result=withCommittedSelectorSource(root,source=>{
    if(source.revision!==before.head)throw Error('Rust selector committed source moved before preparation');
    relevant=existsSync(join(source.tree,RUST_RUNTIME_DECLARATIONS));
    if(relevant&&before.dirty)throw Error('Rust selector derivation requires committed source inputs: '+root);
    return operation(source);
  });
  const after=state();if(after.head!==before.head||relevant&&after.dirty)throw Error('Rust selector committed source changed during assessment');
  return result;
}
export function rustSelectorPending(root:string):boolean{
  return withRustSelectorSource(root,source=>{
    if(!existsSync(join(source.tree,RUST_RUNTIME_DECLARATIONS)))return false;
    if(!existsSync(join(root,RUST_SELECTOR_RECORD)))return true;
    return loadRustSelectorCandidate(join(root,RUST_SELECTOR_RECORD),inputs(source.tree,source.dependencyCatalog).key).state==='pending';
  });
}
export function checkRustSelectorRecord(root:string,report:(message:string)=>void):void{
  const result=withRustSelectorSource(root,source=>{
    if(!existsSync(join(source.tree,RUST_RUNTIME_DECLARATIONS)))return;
    if(!existsSync(join(root,RUST_SELECTOR_RECORD))){report(`pending: ${RUST_SELECTOR_CASE} is not recorded in ${RUST_SELECTOR_RECORD} yet`);return;}
    const {key,build}=inputs(source.tree,source.dependencyCatalog);
    return verifyRustSelectorDerivation({root:source.tree,candidatePath:join(root,RUST_SELECTOR_RECORD),key,
      accepted:()=>acceptedRustSelectorRecord(root),build:()=>encodeRustSelectorRecord(build()),report});
  });
  if(result!==undefined)report('Rust selector record '+result);
}
export function recordRustSelector(root:string):void{
  // Publication follows successful source/installation drain and both fences.
  const material=withRustSelectorSource(root,source=>inputs(source.tree,source.dependencyCatalog).build());
  writeRustSelectorRecord(join(root,RUST_SELECTOR_RECORD),material);
}
/** Delta application observes the same committed source as the writer and
 * mandatory derivation. A candidate body supplies no source authority. */
export function rustSelectorSourceKey(root:string,body:string):string|undefined{
  if(Buffer.byteLength(body)>MAX_RUST_SELECTOR_RECORD_BYTES)throw Error('Rust selector record exceeds committed size budget');
  const record=parseRustSelectorRecord(JSON.parse(body) as unknown);
  return withRustSelectorSource(root,source=>existsSync(join(source.tree,RUST_RUNTIME_DECLARATIONS))&&validateRustSelectorKey(record,inputs(source.tree,source.dependencyCatalog).key).state==='key-current'?record.keySha256:undefined);
}
runAsCommand(import.meta.url,()=>{
  if(process.argv.slice(2).join(' ')!=='--write')throw Error('usage: rust-selector-write.ts --write');
  recordRustSelector(process.cwd());
});
