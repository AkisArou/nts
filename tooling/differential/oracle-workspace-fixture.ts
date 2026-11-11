import {fixtureEnvironment} from "../gate/test-environment.ts";
// A synthetic gate is an independent source for its oracle. Its package
// graph is committed locally; only acquired registry bytes are shared.
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {DEPENDENCY_ROOT_INPUTS,dependencyCache} from '../inputs/dependency-inputs.ts';
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {RECIPE_SOURCES} from './oracle-results.ts';

export function oracleWorkspaceFixture(t:{after(fn:()=>void):void},tree:string,source=resolve(import.meta.dirname,'../..')):void{
  const git=(root:string,...args:string[])=>execFileSync('git',['-C',root,...args],{encoding:'utf8',env:{...fixtureEnvironment(t),
    GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Oracle workspace fixture',GIT_AUTHOR_EMAIL:'oracle-fixture@invalid',
    GIT_COMMITTER_NAME:'Oracle workspace fixture',GIT_COMMITTER_EMAIL:'oracle-fixture@invalid'}}).trim();
  const metadata=git(source,'ls-files','-z','--',...DEPENDENCY_ROOT_INPUTS,':(glob)**/package.json',':(glob)**/.npmrc').split('\0').filter(Boolean);
  for(const name of metadata){const file=join(tree,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,readFileSync(join(source,name)));}
  symlinkSync(join(source,'node_modules'),join(tree,'node_modules'));
  // Runtime-read assets are not static imports. The reader's own bundle
  // declaration supplies the same recipe files to copied synthetic runners.
  copyModuleClosure(RECIPE_SOURCES.map(name=>'tooling/differential/'+name),tree,{sourceRoot:source});
  writeFileSync(join(tree,'.gitignore'),'tooling/\nnode_modules/\n');
  git(tree,'init','-q','-b','main');git(tree,'add','-f','.gitignore',...metadata);git(tree,'commit','-qm','owned oracle workspace');
  const shared=dirname(git(source,'rev-parse','--path-format=absolute','--git-common-dir')),cache=dependencyCache(tree);
  if(existsSync(cache))throw Error('oracle fixture registry alias already exists: '+cache);
  mkdirSync(dirname(cache),{recursive:true});symlinkSync(dependencyCache(shared),cache,'dir');
  t.after(()=>rmSync(cache,{force:true}));
}
