// Expensive writer only. Ordinary selection reads rust-selector-record.ts;
// neither the execution owner nor a current-record read imports this module.
import {dirname,join,resolve} from 'node:path';
import {selectorInstalledSdk} from './rust-selector-inputs.ts';
export {selectorInstalledSdk,selectorTrackedFiles} from './rust-selector-inputs.ts';
import {moduleGraph} from './module-closure.ts';
import {readFileSync} from 'node:fs';
import {rustSelectorRoles} from './rust-selector-roles.ts';
import {rustRuntimeInputGraph} from './rust-runtime-inputs.ts';
import type {CargoRuntimeLinkage} from './cargo-inputs.ts';
import type {RustRuntimeManifest,RustRuntimeTarget} from './rust-runtime-declarations.ts';
import {captureToolchain,type Capture} from '../differential/oracle-toolchain.ts';
import type {HostObservation} from '../differential/oracle-runtime.ts';
import {readHostObservation} from '../differential/oracle-filesystem.ts';
import {metadataParents} from './reader-metadata.ts';
import {generatedProjectFact} from './generated-project.ts';
import {selectionInput} from './reader-inputs/main.ts';
import type {DependencyCatalogTrust} from '../inputs/dependency-catalog.ts';
import {durableRecord} from './durable-record.ts';
import {encodeRustSelectorRecord,type RustSelectorRecord} from './rust-selector-record.ts';
import {RUST_SELECTOR_RECORD,SELECTOR_SCHEMA_SHA256,selectorHash,selectorFile,selectorFact,selectorPopulation,validateRustSelectorMaterial,parseRustSelectorMaterial,
  type RustSelectorMaterial,type RustSelectorMaterialTarget,type SelectorFact,type TrackedFile,type SelectorRoots} from './rust-selector-material.ts';

const orderedValues=<T>(rows:ReadonlyMap<string,T>):T[]=>[...rows].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,row])=>row);

export function verifySelectorSources(sources:Iterable<{path:string;sha256:string}>,files:readonly RustSelectorMaterial['key']['files'][number][]):void{
  const captured=new Map(files.filter(row=>row.path.root==='source').map(row=>[row.path.path,row.sha256]));
  for(const source of sources)if(captured.get(source.path)!==source.sha256)throw Error('Rust selector source changed after parse: '+source.path);
}
export function buildRustSelectorMaterial(options:{sourceRoot:string;manifest:RustRuntimeManifest;inventory:()=>readonly RustRuntimeTarget[];
  declarations:string;engine?:readonly string[];cargoInputs:readonly string[];tracked:()=>readonly TrackedFile[];installed?:Capture;linkage?:CargoRuntimeLinkage;dependencyCatalog?:DependencyCatalogTrust|null;
  composition?:(source:string,composition:ReturnType<ReturnType<typeof rustRuntimeInputGraph>['describe']>['composition'])=>void}):RustSelectorMaterial{
  const installed=options.installed??selectorInstalledSdk(),root=resolve(options.sourceRoot);
  const roots:SelectorRoots={source:root,sdk:installed.root,native:installed.nativeRoot};
  // Bind the engine, declaration bytes and Cargo inputs before invoking the
  // inventory owner or any target walk, then recheck those endpoints below.
  let engine:RustSelectorMaterial['key']['engine'];
  if(options.engine)engine=[...options.engine].sort().map(path=>selectorFile(roots,join(root,path)));
  else{
    const graph=moduleGraph({sourceRoot:root});
    try{
      const snapshot=graph.describe(['tooling/gate/rust-selector-write.ts','tooling/gate/rust-selector.ts','tooling/gate/rust-selector-live.ts']);
      engine=snapshot.files.filter(path=>path!==RUST_SELECTOR_RECORD).sort().map(path=>selectorFile(roots,join(root,path)));
      for(const source of graph.sourceInputs())if(engine.find(row=>row.path.root==='source'&&row.path.path===source.path)?.sha256!==source.sha256)
        throw Error('Rust selector engine changed during discovery: '+source.path);
    }finally{graph.close();}
  }
  const declarations=selectorFile(roots,join(root,options.declarations));
  if(selectorHash(JSON.parse(readFileSync(join(root,options.declarations),'utf8')))!==selectorHash(options.manifest))
    throw Error('Rust selector declarations disagree with their captured input: '+options.declarations);
  const cargoInputs=[...options.cargoInputs].sort().map(path=>selectorFile(roots,join(root,path)));
  const inventory=structuredClone([...options.inventory()]),tracked=[...options.tracked()];
  const owner=rustRuntimeInputGraph({sourceRoot:root,manifest:options.manifest,inventory,nodeMajor:26,dependencyCatalog:options.dependencyCatalog??null,...(options.linkage?{linkage:options.linkage}:{})});
  const targets:RustSelectorMaterialTarget[]=[],files=new Set<string>(),facts=new Map<string,SelectorFact>(),candidates=new Map<string,RustSelectorMaterial['key']['candidates'][number]>(),populations=new Map<string,RustSelectorMaterial['key']['populations'][number]>();
  const sourceInputs=new Map<string,string>(),projects=new Map<string,RustSelectorMaterial['key']['projects'][number]>();
  const fact=(row:HostObservation)=>{
    const portable=selectorFact(roots,row),key=JSON.stringify([portable.kind,portable.path]),previous=facts.get(key);
    if(previous&&selectorHash(previous)!==selectorHash(portable))throw Error('Rust selector input changed during projection: '+row.kind+' '+row.path);
    facts.set(key,portable);
  };
  const parents=(path:string)=>{
    metadataParents(root,path,'Rust selector metadata');
    let parent=dirname(path);
    for(;;){fact({kind:'runtimeKind',path:parent,value:readHostObservation('runtimeKind',parent)});if(parent===root)break;
      const next=dirname(parent);if(next===parent)throw Error('Rust selector metadata parent escaped source root: '+path);parent=next;
    }
  };
  try{
    const targetOrder=new Map(inventory.map((target,index)=>[target.source,index]));
    for(const described of owner.describeAll().sort((a,b)=>targetOrder.get(a.target.source)!-targetOrder.get(b.target.source)!)){
      const {snapshot,byteInputs}=described;
      options.composition?.(described.target.source,described.composition);
      for(const source of described.sourceInputs){
        const previous=sourceInputs.get(source.path);
        if(previous&&previous!==source.sha256)throw Error('Rust selector source changed during discovery: '+source.path);
        sourceInputs.set(source.path,source.sha256);
      }
      for(const path of snapshot.files)files.add(path);
      for(const row of described.candidates)candidates.set(JSON.stringify([row.reader,row.path]),row);
      for(const row of snapshot.observations){
        if(row.observationOnly)continue;
        if(row.dependency)continue; // Installed contents are represented by the pin observations, never repository bytes.
        if(row.capability?.kind==='generated-project'){
          // These prepared private bytes/names are determined by the declared
          // recipe and validated before disposal. No private host answer or
          // path is reused in the committed projection.
          if(!generatedProjectFact(row.capability,row.observation))throw Error('generated project recipe fact changed: '+row.observation.path);
        }else fact(row.observation);
      }
      for(const match of snapshot.projectMatches){
        const key=JSON.stringify(match.request),previous=projects.get(key);
        if(previous&&selectorHash(previous.files)!==selectorHash(match.files))throw Error('Rust selector project discovery changed during projection: '+match.request.path);
        projects.set(key,{request:structuredClone(match.request),files:[...match.files]});
      }
      for(const row of snapshot.optionalFiles.filter(selectionInput)){
        const path=join(root,row.path);parents(path);fact({kind:'runtimeKind',path,value:row.present?'file':null});
      }
      for(const row of snapshot.memberships){
        const path=join(root,row.directory);parents(path===root?join(path,'<member>'):path);
        fact({kind:'runtimeKind',path,value:'directory'});
        fact({kind:'runtimeEntries',path,value:row.entries.map(entry=>entry.name)});
        for(const entry of row.entries)fact({kind:'runtimeKind',path:join(path,entry.name),value:entry.type});
      }
      for(const row of snapshot.directories){
        const population=selectorPopulation({directory:row.directory,...(row.member?{member:row.member}:{})},tracked);
        populations.set(JSON.stringify([population.directory,population.member??null]),population);
      }
      targets.push({target:described.target,roles:rustSelectorRoles(root,snapshot,byteInputs)});
    }
    owner.assertComplete();
  }finally{owner.close();}
  const capturedFiles=[...files].sort().map(path=>selectorFile(roots,join(root,path)));
  verifySelectorSources([...sourceInputs].map(([path,sha256])=>({path,sha256})),capturedFiles);
  const sdkFiles=[...installed.files.keys()].map(path=>join(installed.root,path)).concat([...installed.nativeFiles.keys()].map(path=>join(installed.nativeRoot,path)));
  const key:RustSelectorMaterial['key']={engine,declarations,cargo:{inputs:cargoInputs,targets:inventory},
    sdk:{...installed.identity},files:[...capturedFiles,...sdkFiles.sort().map(path=>selectorFile(roots,path))],
    facts:orderedValues(facts),projects:orderedValues(projects),candidates:orderedValues(candidates),populations:orderedValues(populations)};
  const record=parseRustSelectorMaterial({version:1,schemaSha256:SELECTOR_SCHEMA_SHA256,key,targets,keySha256:selectorHash(key),targetsSha256:selectorHash(targets)});
  // Validate again after every graph transaction and key read. A concurrent
  // input change cannot publish roles measured from a different answer.
  const checked=validateRustSelectorMaterial(record,{roots,inventory,tracked:options.tracked(),sdk:()=>captureToolchain(installed.root)});
  if(checked.state==='pending')throw Error('Rust selector projection changed before publication: '+checked.pending.kind+' '+checked.pending.path+': '+checked.pending.reason);
  return record;
}
export function writeRustSelectorRecord(path:string,record:RustSelectorMaterial):void{
  publishRustSelectorRecord(path,encodeRustSelectorRecord(parseRustSelectorMaterial(record)));
}
/** Publishes an already encoded record, for callers that inspect its key first. */
export function publishRustSelectorRecord(path:string,record:RustSelectorRecord):void{
  durableRecord(path,record,{compact:true});
}
