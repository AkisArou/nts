// A repository namespace is acquired through its exact canonical ancestry.
// These facts certify only identity-walk components, never an endpoint access.
import {lstatSync} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import type {HostObservation} from '../differential/oracle-runtime.ts';
import type {RuntimeClaimAnswer} from './rust-input-claims.ts';

type RootStat={dev:bigint;ino:bigint;isDirectory:()=>boolean;isSymbolicLink:()=>boolean};
const inspectRoot=(path:string):RootStat=>lstatSync(path,{bigint:true});
export function runtimeSourceAnchor(root:string,inspect:(path:string)=>RootStat=inspectRoot){
  if(!isAbsolute(root)||resolve(root)!==root)throw Error('Rust source anchor needs a canonical absolute root');
  const ancestors=new Set<string>();let acquired:RootStat|undefined;
  for(let path=root;;path=dirname(path)){
    const stat=inspect(path);
    if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Rust source anchor has a non-directory or symbolic ancestor: '+path);
    if(path===root)acquired=stat;ancestors.add(path);if(dirname(path)===path)break;
  }
  const identity={root,dev:String(acquired!.dev),ino:String(acquired!.ino)};
  const check=()=>{
    const current=inspect(root);
    if(!current.isDirectory()||current.isSymbolicLink()||String(current.dev)!==identity.dev||String(current.ino)!==identity.ino)
      throw Error('Rust source anchor changed during assessment: '+root);
  };
  return {identity:{...identity},fence<T>(operation:()=>T):T{
    check();let result:{ok:true;value:T}|{ok:false;error:unknown};
    try{result={ok:true,value:operation()};}catch(error){result={ok:false,error};}
    try{check();}catch(error){
      if(!result.ok)throw new AggregateError([result.error,error],'Rust source assessment and anchor validation both failed',{cause:result.error});
      throw error;
    }
    if(!result.ok)throw result.error;return result.value;
  },
    component(observation:HostObservation):RuntimeClaimAnswer{
      if(observation.kind!=='runtimeKind'||observation.value!=='directory'||!ancestors.has(observation.path))
        return {kind:'uncovered',reason:'outside component needs its bound external protocol'};
      return {kind:'claimed',claims:[{role:'source-anchor',reader:'<acquired canonical source root>',path:observation.path,anchor:{...identity}}]};
    }};
}
