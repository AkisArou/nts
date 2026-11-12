// Recreate the recorded source in an independent repository, never a worktree.
import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {hostEnvironment} from '../../../tooling/gate/canonical-environment.ts';
import {newTestScratch} from '../../../tooling/gate/test-scratch.ts';
import {removable} from '../../../tooling/gate/run-temporary.ts';

const pin='08852c508f035ff4e946eb91e36dd180ace498ec',repository=fileURLToPath(new URL('../../..',import.meta.url));
if(!process.argv[2])throw Error('usage: reproduce.ts <output directory>');
assert.equal(process.version,'v26.13.0','the record names its Node version');
const output=resolve(process.argv[2]);mkdirSync(output,{recursive:true});
const source=newTestScratch('728-reproduction-source');
const base=hostEnvironment(process.env),env={...base,GIT_DIR:join(source,'.git'),GIT_WORK_TREE:source,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
// Only this read asks the shared repository for an object location. All writes
// below have an explicit private GIT_DIR and disabled global/system config.
const objects=resolve(repository,execFileSync('/usr/bin/git',['rev-parse','--git-path','objects'],{cwd:repository,encoding:'utf8',env:base}).trim());
const git=(...args:string[])=>execFileSync('/usr/bin/git',args,{cwd:source,encoding:'utf8',env,maxBuffer:64<<20});
try{
  git('init','--quiet','--initial-branch=source');
  mkdirSync(join(source,'.git/objects/info'),{recursive:true});
  writeFileSync(join(source,'.git/objects/info/alternates'),objects+'\n');
  git('read-tree',pin);git('checkout-index','--all');git('update-ref','HEAD',pin);
  // The graph rejects assets resolving outside its root. A private directory
  // of hard links keeps the immutable provisioned packages inside that root;
  // neither the census nor its parser writes package bytes.
  execFileSync('/usr/bin/cp',['--archive','--link',join(repository,'node_modules'),join(source,'node_modules')],{env:base});
  const scripts=dirname(fileURLToPath(import.meta.url));
  for(const [name,args]of [['census',[source,output,'--full']],['frontiers',[output]],['classify',[output]],['plan',[output]],['index',[output]]]as const){
    execFileSync(process.execPath,[join(scripts,name+'.ts'),...args],{cwd:source,env,stdio:'inherit'});
  }
}finally{removable(source);rmSync(source,{recursive:true,force:true});}
