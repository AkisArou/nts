// Canonical graph adapter only. Runtime execution retains its Node-only Cargo
// identity owner and does not import this module, its graph or its SDK.
import {rustBuildModules,validateRustBuildModules,type BuildModuleInputs,type RustModuleCandidate} from './rust-modules.ts';
import {moduleGraph,type ModuleClosureOptions,type ModuleDescription} from './module-closure.ts';
import {bindRustRuntimeDeclarations,type RustRuntimeManifest,type RustRuntimeTarget} from './rust-runtime-declarations.ts';
import {cargoRuntimeLinkage,cargoRuntimeRoots,type CargoRuntimeLinkage} from './cargo-inputs.ts';
import type {DependencyCatalogTrust} from '../inputs/dependency-catalog.ts';

/** Both selection and post-run validation ask this same graph for the target
 * snapshot. The manifest supplies shared reader rows, never observed-path
 * allowlists. Route booleans stay separate from portable Cargo identity. */
export function rustRuntimeInputGraph(options:{sourceRoot:string;manifest:RustRuntimeManifest;inventory:readonly RustRuntimeTarget[];nodeMajor?:26;linkage?:CargoRuntimeLinkage;dependencyCatalog?:DependencyCatalogTrust|null}){
  const declarations=bindRustRuntimeDeclarations(options.manifest,options.inventory);
  const linkage=structuredClone(options.linkage??cargoRuntimeLinkage(options.sourceRoot));
  const targets=new Map(options.inventory.map(row=>[row.source,structuredClone(row)]));
  const entered=new Set<string>(),described=new Set<string>();
  const graph=moduleGraph({sourceRoot:options.sourceRoot,declarations,dependencyCatalog:options.dependencyCatalog??null,...(options.nodeMajor===undefined?{}:{nodeMajor:options.nodeMajor})});
  function prepare(source:string,buildRoot:(source:string)=>BuildModuleInputs){
    const target=targets.get(source);if(!target)throw Error('Rust runtime inputs: no Cargo owner for '+source);
    const roots=cargoRuntimeRoots(linkage,source),sources=[...new Set(roots.map(row=>row.target.source))];
    const imports=new Map<string,string[]>(),files=new Set<string>(),candidates=new Map<string,RustModuleCandidate>(),captured=new Map<string,string>();
    const counts=new Map<string,number>();
    // Merge structural edges before one canonical transaction. No target
    // snapshot is cached: all readers and observations remain fresh.
    for(const entry of sources){
      const build=buildRoot(entry);counts.set(entry,build.files.size);
      for(const file of build.files)files.add(file);
      for(const [file,edges]of build.imports)imports.set(file,[...new Set([...(imports.get(file)??[]),...edges])]);
      for(const row of build.candidates){
        const key=JSON.stringify([row.reader,row.path]),before=candidates.get(key);
        if(before&&before.present!==row.present)throw Error('Rust runtime inputs: inherited module candidate changed: '+row.path);
        candidates.set(key,row);
      }
      for(const row of build.sources){
        const before=captured.get(row.path);if(before&&before!==row.sha256)throw Error('Rust runtime inputs: inherited source changed: '+row.path);
        captured.set(row.path,row.sha256);
      }
    }
    const buildModules:BuildModuleInputs={imports,files,candidates:[...candidates.values()],sources:[...captured].map(([path,sha256])=>({path,sha256}))};
    return {target,roots,sources,counts,files,buildModules};
  }
  const buildRoot=(entry:string)=>rustBuildModules(options.sourceRoot,entry,path=>declarations.has(path));
  function finish(prepared:ReturnType<typeof prepare>,result:ModuleDescription){
    const {target,roots,counts,files,buildModules}=prepared,{snapshot,byteInputs}=result;
    for(const file of snapshot.moduleFiles){
      if(file.endsWith('.rs')&&!declarations.has(file))throw Error('Rust runtime inputs: traversed Rust reader has no declaration: '+file);
      entered.add(file);
    }
    described.add(target.source);return {target:structuredClone(target),snapshot,byteInputs,candidates:structuredClone(buildModules.candidates),
      // Progressive capture evidence, not this target's source closure: graph
      // reads include earlier targets and omit targets not visited yet. Only
      // the union over the complete batch describes its graph-wide inputs.
      sourceInputs:[...structuredClone(buildModules.sources),...graph.sourceInputs()],
      composition:{roots:roots.map(row=>({...structuredClone(row),readerCount:counts.get(row.target.source)!})),readerCount:files.size,
        structuralPolicy:'including-cfg-test' as const}};
  }
  function mapAll<T>(project:(description:ReturnType<typeof finish>)=>T):T[]{
    // Unique Cargo roots are described once within this explicit call. Per-
    // target canonical visitors still retain their own context and provenance.
    const builds=new Map<string,BuildModuleInputs>();
    try{
      const prepared=[...targets.keys()].map(source=>prepare(source,entry=>{
        let build=builds.get(entry);if(!build){build=buildRoot(entry);builds.set(entry,build);}return build;
      }));
      const results=graph.mapDescriptions(prepared.map(row=>({entries:row.sources,buildModules:row.buildModules})),
        (result,index)=>project(finish(prepared[index]!,result)));
      for(const build of builds.values())validateRustBuildModules(options.sourceRoot,build);
      return results;
    }finally{builds.clear();}
  }
  return {graph,describe(source:string,directory?:ModuleClosureOptions['directory'],byteInput?:ModuleClosureOptions['byteInput']){
    const prepared=prepare(source,buildRoot),byteInputs:ModuleDescription['byteInputs']=[];
    const snapshot=graph.describe(prepared.sources,directory,row=>{byteInputs.push({...row});byteInput?.(row);},prepared.buildModules);
    return finish(prepared,{snapshot,byteInputs});
  },describeAll:()=>mapAll(description=>description),mapAll,assertComplete(){
    for(const source of targets.keys())if(!described.has(source))throw Error('Rust runtime inputs: Cargo target was not described: '+source);
    for(const row of options.manifest.readers??[])if(!entered.has(row.source))throw Error('Rust runtime inputs: shared reader has no traversed Cargo owner: '+row.source);
  },close:()=>graph.close()};
}
