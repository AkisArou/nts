// A stale projection uses the same live graph as runtime validation. This
// route does not serialize observations or require their portability.
import {rustRuntimeInputGraph} from './rust-runtime-inputs.ts';
import {rustSelectorRoles} from './rust-selector-roles.ts';
import type {RustRuntimeManifest,RustRuntimeTarget} from './rust-runtime-declarations.ts';
import type {RustSelectorTarget} from './rust-selector-record.ts';
import type {CargoRuntimeLinkage} from './cargo-inputs.ts';
import type {DependencyCatalogTrust} from '../inputs/dependency-catalog.ts';

export function liveRustSelectorTargets(options:{sourceRoot:string;manifest:RustRuntimeManifest;inventory:readonly RustRuntimeTarget[];linkage?:CargoRuntimeLinkage;dependencyCatalog?:DependencyCatalogTrust|null}):RustSelectorTarget[]{
  const owner=rustRuntimeInputGraph({...options,nodeMajor:26}),targets:RustSelectorTarget[]=[];
  try{
    owner.mapAll(({target,snapshot,byteInputs})=>{
      targets.push({target:structuredClone(target),roles:rustSelectorRoles(options.sourceRoot,snapshot,byteInputs)});
    });
    owner.assertComplete();return targets;
  }finally{owner.close();}
}
