// Pin-addressed corpus acquisition, selection and linking share one owner.
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,rmdirSync,symlinkSync,unlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {gitArguments} from '../gate/git-arguments/main.ts';
import {ToolingInstrumentError} from '../differential/command-entry/instrument.ts';
export type Corpus={pinSource:URL;upstream:string;sparse:readonly string[];slot:string};
const failure=(message:string)=>new ToolingInstrumentError('tooling-setup',message);
export function corpus(definition:Corpus){
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(definition.slot))throw failure('invalid corpus slot');
  const {slot,upstream}=definition,sparse=[...definition.sparse],pin=readFileSync(definition.pinSource,'utf8').trim();
  if(!/^[a-f0-9]{40}$/.test(pin))throw failure(`invalid ${slot} corpus pin at ${definition.pinSource.href}`);
  const git=(cwd:string,args:string[],env:NodeJS.ProcessEnv):string=>{
    try{return execFileSync('git',gitArguments(args),{cwd,env,encoding:'utf8',maxBuffer:16*2**20,stdio:['ignore','pipe','pipe']}).trim();}
    catch(error){throw failure(`${slot} corpus Git operation at ${cwd}: ${String(error)}`);}
  };
  const checkout=(shared:string)=>join(shared,'third_party',slot+'.d',pin);
  const verify=(destination:string,env:NodeJS.ProcessEnv):void=>{
    if(!existsSync(destination))throw failure(`${slot} corpus is missing at ${destination}; acquire the pin-addressed checkout ${pin}`);
    const actual=git(destination,['rev-parse','--verify','HEAD^{commit}'],env);
    if(actual!==pin)throw failure(`${slot} corpus at ${destination} is ${actual}, requires ${pin}; preserve this directory and acquire a fresh pin-addressed checkout; existing checkouts are never moved`);
    if(realpathSync(git(destination,['rev-parse','--show-toplevel'],env))!==realpathSync(destination))throw failure(`${slot} corpus is not its own checkout: ${destination}`);
    if(git(destination,['status','--porcelain','--untracked-files=all'],env))throw failure(`${slot} corpus has local changes at ${destination}; preserve or discard them explicitly before reusing it`);
    for(const path of sparse)if(!existsSync(join(destination,path)))throw failure(`${slot} corpus is missing ${path} at ${destination}; reapply its sparse checkout`);
  };
  const acquire=(shared:string,env:NodeJS.ProcessEnv):string=>{
    const destination=checkout(shared);
    if(existsSync(destination)){verify(destination,env);return destination;}
    mkdirSync(dirname(destination),{recursive:true});
    const stage=mkdtempSync(join(dirname(destination),'.acquire-'));
    try{
      git(stage,['init','--quiet'],env);git(stage,['remote','add','origin',upstream],env);
      if(sparse.length)git(stage,['sparse-checkout','set',...sparse],env);
      git(stage,['fetch','--depth','1','--filter=blob:none','origin',pin],env);
      git(stage,['checkout','--detach','FETCH_HEAD'],env);verify(stage,env);
      if(existsSync(destination)){verify(destination,env);return destination;}
      try{renameSync(stage,destination);}catch(error){if(!existsSync(destination))throw error;verify(destination,env);}
    }finally{rmSync(stage,{recursive:true,force:true});}
    return destination;
  };
  const sharedRoot=(tree:string,env:NodeJS.ProcessEnv):string=>{
    if(realpathSync(git(tree,['rev-parse','--show-toplevel'],env))!==realpathSync(tree))throw failure(`${slot} reader root is not its own repository: ${tree}`);
    return dirname(git(tree,['rev-parse','--path-format=absolute','--git-common-dir'],env));
  };
  const resolveCheckout=(tree:string,env:NodeJS.ProcessEnv):string|null=>{
    if(!existsSync(join(tree,'.git')))return null;
    const path=checkout(sharedRoot(tree,env));
    if(!existsSync(path))return null;
    verify(path,env);return path;
  };
  const link=(shared:string,tree:string,env:NodeJS.ProcessEnv):string=>{
    const destination=join(tree,'third_party',slot);
    let present;try{present=lstatSync(destination);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(present&&!present.isSymbolicLink()){
      try{rmdirSync(destination);}catch{throw failure(`${slot} link destination is owned and must be kept: ${destination}`);}
    }
    const source=acquire(shared,env);mkdirSync(dirname(destination),{recursive:true});
    const directory=mkdtempSync(join(dirname(destination),'.corpus-link-')),temporary=join(directory,'source');
    try{symlinkSync(source,temporary,'dir');renameSync(temporary,destination);}
    finally{if(existsSync(temporary))unlinkSync(temporary);rmdirSync(directory);}
    return source;
  };
  return {pin,checkout,verify,acquire,sharedRoot,resolve:resolveCheckout,link};
}
