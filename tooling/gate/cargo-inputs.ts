// One Node-only Cargo inventory feeds crate reach and portable test identities.
import {dirname,relative,resolve,sep} from 'node:path';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {cargoRustRuntimeTargets,cargoRustTargetInventory,type RustInputTarget} from './rust-runtime-declarations.ts';
import {selectorTrackedFiles} from './rust-selector-inputs.ts';
import {selectorFile,selectorHash} from './rust-selector-material.ts';
import {join} from 'node:path';
import {cargoInputNames} from './cargo-input-population.ts';

type CargoPackage={id:string;name:string;manifest_path:string;targets:unknown[];dependencies:{name:string;kind?:string|null;path?:string;rename?:string|null;target?:string|null}[]};
type CargoNode={id:string;deps:{name:string;pkg:string;dep_kinds:{kind:'dev'|'build'|null;target:string|null}[]}[]};
type CargoMetadata={version:number;workspace_members:string[];packages:CargoPackage[];resolve:{nodes:CargoNode[]}};
type Execute=(command:string,args:string[],options:{cwd:string;encoding:'utf8';stdio:['ignore','pipe','pipe'];maxBuffer:number})=>string|Buffer;
type CargoInputs=ReturnType<typeof selectorFile>[];
const inventories=new Map<string,{metadata:CargoMetadata;inputs:CargoInputs}>();
export function cargoInputPaths(root:string):string[]{return cargoInputNames(selectorTrackedFiles(root));}
function inputKeys(root:string):CargoInputs{
  return cargoInputPaths(root).map(path=>selectorFile({source:root,sdk:root,native:root},join(root,path)));
}
function unchanged(root:string,before:CargoInputs,after:CargoInputs):void{
  if(selectorHash(before)!==selectorHash(after))throw Error('Cargo inventory inputs changed since acquisition: '+root+'; fresh selector process required');
}
export function cargoMetadata(root:string,execute?:Execute):CargoMetadata{
  root=resolve(root);const before=execute?undefined:inventories.get(root),inputs=execute?[]:inputKeys(root);
  if(before){unchanged(root,before.inputs,inputs);return structuredClone(before.metadata);}
  const args=['metadata','--format-version','1','--offline'];
  try{
  const body=execute?execute('cargo',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1<<28}):
    infrastructureProbe({purpose:'selector Cargo inventory',command:'cargo',args,cwd:root,maxBuffer:1<<28}).stdout;
  const value=JSON.parse(String(body)) as CargoMetadata;
  if(!value||!Array.isArray(value.packages)||value.packages.some(row=>!row||typeof row.name!=='string'||typeof row.manifest_path!=='string'||!Array.isArray(row.targets)||!Array.isArray(row.dependencies)
    ||row.dependencies.some(dependency=>!dependency||typeof dependency.name!=='string'||dependency.path!==undefined&&typeof dependency.path!=='string'||dependency.kind!==undefined&&dependency.kind!==null&&typeof dependency.kind!=='string')))
    throw Error('Cargo input inventory has invalid packages');
  // Validate the source/name/kind and independent unit/doctest route fields
  // before retaining one inventory for this process's source snapshot.
  cargoRustRuntimeTargets(value,root);
  if(!value.resolve||!Array.isArray(value.resolve.nodes))throw Error('Cargo input inventory has no resolved graph');
  const packageIds=new Set(value.packages.map(row=>row.id)),byId=new Map(value.packages.map(row=>[row.id,row])),nodes=new Set<string>();
  if(packageIds.size!==value.packages.length)throw Error('Cargo input inventory has duplicate package identities');
  for(const node of value.resolve.nodes){
    if(!node||typeof node.id!=='string'||!packageIds.has(node.id)||nodes.has(node.id)||!Array.isArray(node.deps))throw Error('Cargo input inventory has an invalid resolved owner');
    nodes.add(node.id);
    for(const dependency of node.deps){
      if(!dependency||typeof dependency.name!=='string'||!dependency.name||!packageIds.has(dependency.pkg)||!Array.isArray(dependency.dep_kinds)||!dependency.dep_kinds.length
        ||dependency.dep_kinds.some(row=>!row||![null,'dev','build'].includes(row.kind)||row.target!==null&&typeof row.target!=='string'))throw Error('Cargo input inventory has an invalid resolved dependency: '+node.id);
      const owner=byId.get(dependency.pkg)!,libraryName=owner.targets.some(value=>{
        if(!value||typeof value!=='object'||!('name'in value)||!('kind'in value))return false;
        return value.name===dependency.name&&Array.isArray(value.kind)&&value.kind.some(kind=>['lib','rlib','dylib','cdylib','staticlib','proc-macro'].includes(String(kind)));
      }),declarations=byId.get(node.id)!.dependencies.filter(row=>row.name===owner.name&&
        (row.rename?(row.rename.replace(/-/g,'_')===dependency.name):row.name.replace(/-/g,'_')===dependency.name||libraryName));
      for(const route of dependency.dep_kinds)if(!declarations.some(row=>(row.kind??null)===route.kind&&(row.target??null)===route.target
        &&(!row.path||resolve(row.path)===resolve(dirname(owner.manifest_path)))))throw Error('Cargo input inventory resolved dependency has no matching declaration: '+node.id+' -> '+dependency.pkg);
    }
  }
  for(const id of packageIds)if(!nodes.has(id))throw Error('Cargo input inventory omitted a resolved package: '+id);
  if(!execute){unchanged(root,inputs,inputKeys(root));inventories.set(root,{metadata:structuredClone(value),inputs});}return value;
  }catch(error){
    const stderr=error&&typeof error==='object'&&'stderr' in error?String(error.stderr).trim():'';
    throw Error('cargo '+args.join(' ')+' in '+root+' failed: '+String(error)+(stderr?'\nstderr: '+stderr:''),{cause:error});
  }
}
export function cargoRuntimeTargets(root:string){
  return structuredClone([...cargoRustRuntimeTargets(cargoMetadata(root),resolve(root)).values()].flat());
}

export type CargoRuntimePackage={directory:string;name:string;targets:RustInputTarget[];dependencies:{directory:string;kind:'normal'|'dev'|'build';name:string;rename?:string;target?:string|null}[]};
export type CargoRuntimeLinkage={packages:CargoRuntimePackage[]};
export type CargoRuntimeRoot={target:RustInputTarget;package:string;via:string;reason:'target'|'same-package-library'|'test-binary'|'normal'|'dev'};
const library=(target:RustInputTarget)=>target.kind.some(kind=>['lib','rlib','dylib','cdylib','staticlib','proc-macro'].includes(kind));

/** One metadata response, two phase-specific projections: compile reach may
 * include build edges; runtime linking includes dev edges only at test roots.
 * Local dependencies bind by package path AND name, never the import alias. */
export function cargoRuntimeLinkageFromMetadata(metadata:CargoMetadata,root:string):CargoRuntimeLinkage{
  root=resolve(root);const inventory=cargoRustTargetInventory(metadata,root,'repository');
  const local=(path:string)=>relative(root,path).split(sep).join('/');
  const packages=metadata.packages.filter(row=>inventory.has(local(dirname(row.manifest_path)))),byId=new Map(metadata.packages.map(row=>[row.id,row])),nodes=new Map(metadata.resolve.nodes.map(row=>[row.id,row]));
  return {packages:packages.map(row=>{
    const directory=local(dirname(row.manifest_path)),dependencies:CargoRuntimePackage['dependencies']=[];
    const node=nodes.get(row.id);if(!node)throw Error('Cargo runtime linkage: missing resolved owner: '+row.id);
    for(const dependency of node.deps){
      const owner=byId.get(dependency.pkg);if(!owner)throw Error('Cargo runtime linkage: missing resolved dependency: '+dependency.pkg);
      const linked=local(dirname(owner.manifest_path));if(!inventory.has(linked))continue;
      // pkg is Cargo's resolved identity, including [patch] and renamed edges.
      // Conditions stay recorded and are conservatively retained in both graphs.
      for(const route of dependency.dep_kinds)dependencies.push({directory:linked,name:owner.name,kind:route.kind??'normal',rename:dependency.name,target:route.target});
    }
    return {directory,name:row.name,targets:(inventory.get(directory)??[]).map(({source,name,kind})=>({source,name,kind:[...kind]})),dependencies};
  })};
}
export function cargoRuntimeLinkage(root:string,execute?:Execute):CargoRuntimeLinkage{return cargoRuntimeLinkageFromMetadata(cargoMetadata(root,execute),root);}

/** Structural source traversal remains conservative over cfg(test) modules.
 * We exclude dependency dev edges and standalone harness targets, not test
 * declarations embedded in a linked library's existing source tree. */
export function cargoRuntimeRoots(linkage:CargoRuntimeLinkage,source:string):CargoRuntimeRoot[]{
  const packages=structuredClone(linkage.packages),byDirectory=new Map(packages.map(row=>[row.directory,row]));
  const owners=packages.flatMap(row=>row.targets.filter(target=>target.source===source).map(target=>({owner:row,target})));
  if(owners.length!==1)throw Error('Cargo runtime linkage: source has '+owners.length+' package owners: '+source);
  const {owner,target}=owners[0]!,roots:CargoRuntimeRoot[]=[{target,package:owner.directory,via:source,reason:'target'}],walked=new Set<string>();
  const queue:{owner:CargoRuntimePackage;dev:boolean;via:string}[]=[{owner,dev:true,via:source}];
  const addLibrary=(owner:CargoRuntimePackage,via:string,reason:CargoRuntimeRoot['reason'])=>{
    const libraries=owner.targets.filter(library);
    if(libraries.length!==1)throw Error('Cargo runtime linkage: dependency has '+libraries.length+' library owners: '+owner.directory);
    const linked=libraries[0]!;
    if(linked.source!==source)roots.push({target:linked,package:owner.directory,via,reason});
    queue.push({owner,dev:false,via:linked.source});
  };
  if(!library(target)&&owner.targets.some(library))addLibrary(owner,source,'same-package-library');
  // Cargo exposes its package's production binaries to integration tests and
  // benchmarks. Their fixed readers are conservatively included even if a
  // particular case does not invoke every available CARGO_BIN_EXE entry.
  if(target.kind.some(kind=>kind==='test'||kind==='bench'))for(const bin of owner.targets.filter(row=>row.kind.includes('bin'))){
    roots.push({target:bin,package:owner.directory,via:source,reason:'test-binary'});
    if(owner.targets.some(library))addLibrary(owner,bin.source,'same-package-library');
    queue.push({owner,dev:false,via:bin.source});
  }
  while(queue.length){
    const current=queue.shift()!,key=JSON.stringify([current.owner.directory,current.dev]);if(walked.has(key))continue;walked.add(key);
    for(const dependency of current.owner.dependencies){
      if(dependency.kind==='build'||dependency.kind==='dev'&&!current.dev)continue;
      const linked=byDirectory.get(dependency.directory);
      if(!linked||linked.name!==dependency.name)throw Error('Cargo runtime linkage: missing or mismatched dependency owner: '+dependency.directory);
      addLibrary(linked,current.via,dependency.kind);
    }
  }
  const seen=new Set<string>();return roots.filter(row=>{const key=JSON.stringify(row);if(seen.has(key))return false;seen.add(key);return true;});
}
