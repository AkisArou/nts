// Explicit generated-config requests retain their real private ConfigDir.
// Only these prepared bytes/names are derived facts; other filesystem reads
// remain ordinary repository or installed-toolchain observations.
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,rmSync,realpathSync,lstatSync} from 'node:fs';
import {userInfo} from 'node:os';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';
import {FIXTURE_ENVIRONMENT} from './cache-capabilities.ts';
import {sameOracleObservation,type HostObservation} from '../differential/oracle-runtime.ts';
import {durableRecord} from './durable-record.ts';
import type {GeneratedInclude} from './reader-inputs/main.ts';
export type {GeneratedInclude} from './reader-inputs/main.ts';

export type GeneratedProjectCapability={kind:'generated-project';root:string;config:string;body:string;extends:string;directory:string;include:string;includeKind:GeneratedInclude};
const inside=(root:string,path:string)=>{const name=relative(root,path);return name!== '..'&&!name.startsWith('..'+sep)&&!isAbsolute(name);};
export function generatedProjectBase(env:NodeJS.ProcessEnv=process.env):string{
  const cache=join(userInfo().homedir,'.cache'),tmp=env.TMPDIR;
  if(tmp&&isAbsolute(tmp)&&inside(cache,resolve(tmp)))return tmp;
  if(env[FIXTURE_ENVIRONMENT]!==undefined)throw Error('generated project has no owned temporary capability');
  return join(cache,'nts/project-inputs');
}
export function prepareGeneratedProject(options:{source:string;extends:string;directory:string;include:GeneratedInclude;parent?:string}){
  const source=realpathSync(options.source),base=resolve(source,options.extends),directory=resolve(source,options.directory);
  if(!inside(source,base)||!inside(source,directory))throw Error('generated project bindings escape source root');
  if(/["\\\x00-\x1f]/.test(base+directory))throw Error('generated project bindings are unsupported by the original literal JSON recipes');
  if(options.include!=='directory'&&options.include!=='typescript-tree')throw Error('unsupported generated project include recipe');
  const include=directory+(options.include==='typescript-tree'?'/**/*.ts':''),json={extends:base,include:[include]},body=JSON.stringify(json)+'\n';
  const parent=options.parent??generatedProjectBase();mkdirSync(parent,{recursive:true});
  const root=mkdtempSync(join(parent,'project-config-')),config=join(root,'tsconfig.json');
  try{
    durableRecord(config,json,{compact:true});
    const identity=lstatSync(root),capability:GeneratedProjectCapability={kind:'generated-project',root,config,body,extends:base,directory,include,includeKind:options.include};
    return {config,capability,close(){
      const current=lstatSync(root);if(current.isSymbolicLink()||current.dev!==identity.dev||current.ino!==identity.ino)throw Error('generated project temporary was replaced: '+root);
      rmSync(root,{recursive:true});
    }};
  }catch(error){try{rmSync(root,{recursive:true});}catch(cleanup){throw new AggregateError([error,cleanup],'generated project setup and cleanup failed',{cause:error});}throw error;}
}
/** No private timestamp, unknown child or other callback gains portability.
 * These three exact answers are determined by the prepared config owner. */
export function generatedProjectFact(capability:GeneratedProjectCapability,observation:HostObservation):boolean{
  if(capability.kind!=='generated-project'||!isAbsolute(capability.root)||capability.config!==join(capability.root,'tsconfig.json'))return false;
  if(!['directory','typescript-tree'].includes(capability.includeKind)||capability.include!==capability.directory+(capability.includeKind==='typescript-tree'?'/**/*.ts':''))return false;
  if(capability.body!==JSON.stringify({extends:capability.extends,include:[capability.include]})+'\n')return false;
  if(observation.path===capability.config&&observation.kind==='file')return observation.value===createHash('sha256').update(capability.body).digest('hex');
  if(observation.path!==capability.root)return false;
  if(observation.kind==='realpath')return observation.value===capability.root;
  return observation.kind==='entries'&&sameOracleObservation(observation.value,{files:['tsconfig.json'],directories:[]});
}
