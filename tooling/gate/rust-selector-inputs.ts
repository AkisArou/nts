// These key inputs acquire byte capabilities. Native matching replay has its
// own lazy parse-only session and never constructs a Program.
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {gitArguments} from './git-arguments/main.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {captureToolchain,type Capture} from '../differential/oracle-toolchain.ts';
import type {TrackedFile} from './rust-selector-material.ts';
import {installationCatalogTrust} from '../inputs/dependency-inputs.ts';

export function selectorTrackedFiles(root:string):TrackedFile[]{
  const text=infrastructureProbe({purpose:'Rust selector tracked population',command:'git',args:gitArguments(['ls-files','--stage','-z','--cached']),cwd:root,maxBuffer:64<<20}).stdout;
  const seen=new Set<string>();
  return text.split('\0').filter(Boolean).map(row=>{
    const match=/^([0-7]{6}) [a-f0-9]+ ([0-3])\t([\s\S]+)$/.exec(row);
    if(!match||match[2]!=='0')throw Error('Rust selector tracked population has an unmerged entry');
    const path=match[3]!;if(seen.has(path))throw Error('Rust selector tracked population has a duplicate: '+path);seen.add(path);
    return {path,mode:match[1]!};
  }).sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
export function selectorInstalledSdk():Capture{
  const require=createRequire(import.meta.url);
  return captureToolchain(dirname(require.resolve('typescript/package.json')));
}
/** Direct selection calls use the real source owner's existing cache path. */
export function selectorDependencyCatalog(root:string){
  const common=infrastructureProbe({purpose:'Rust selector installation owner',command:'git',args:gitArguments(['rev-parse','--path-format=absolute','--git-common-dir']),cwd:root}).stdout.trim();
  return installationCatalogTrust(dirname(common),root);
}
