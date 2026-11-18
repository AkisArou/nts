import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {committedProjectPaths} from './committed-project-paths.ts';
import {gitArguments} from './git-arguments/main.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {testScratch} from './test-scratch.ts';

function fixture(t:Parameters<typeof testScratch>[0]){
  const tree=testScratch(t,'committed-project-paths'),env=fixtureEnvironment(t);
  const put=(path:string,text:string)=>{mkdirSync(join(tree,path,'..'),{recursive:true});writeFileSync(join(tree,path),text);};
  const git=(...args:string[])=>execFileSync('git',gitArguments(args),{cwd:tree,env,encoding:'utf8'}).trim();
  git('init','--quiet');
  const commit=()=>{git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','source identities');return git('rev-parse','HEAD');};
  return {tree,put,commit,link:(path:string,target:string)=>symlinkSync(target,join(tree,path)),git};
}

test('committed identities retain chains and relative parent targets without reading live aliases',t=>{
  const f=fixture(t);f.put('physical/gone.ts','export {};');f.put('replacement/gone.ts','export {};');
  f.link('alias2','physical');f.link('alias','alias2');f.put('nested/anchor','');f.link('nested/relative','../alias');
  const revision=f.commit(),source={tree:f.tree,revision};
  assert.deepEqual(committedProjectPaths(source).identity('alias/gone.ts'),['alias/gone.ts','alias','alias2','physical/gone.ts']);
  assert.ok(committedProjectPaths(source).identity('nested/relative/gone.ts').includes('physical/gone.ts'));
  rmSync(join(f.tree,'alias2'));f.link('alias2','replacement');f.git('add','alias2');
  assert.ok(committedProjectPaths(source).identity('alias/gone.ts').includes('physical/gone.ts'),'staged/live aliases cannot replace base blobs');
  const tip=f.commit();assert.ok(committedProjectPaths({tree:f.tree,revision:tip}).identity('alias/gone.ts').includes('replacement/gone.ts'));
  assert.ok(committedProjectPaths(source).identity('alias/gone.ts').includes('physical/gone.ts'),'the old revision stays independent of HEAD');
});

test('an alias added at the tip cannot manufacture a base identity',t=>{
  const f=fixture(t);f.put('physical/main.ts','export {};');const base=f.commit();
  f.link('added','physical');const tip=f.commit();
  assert.equal(committedProjectPaths({tree:f.tree,revision:base}).hasAlias('added/main.ts'),false);
  assert.throws(()=>committedProjectPaths({tree:f.tree,revision:base}).identity('added/main.ts'),/absent/);
  assert.deepEqual(committedProjectPaths({tree:f.tree,revision:tip}).identity('added/main.ts'),['added/main.ts','added','physical/main.ts']);
});

test('outside targets, cycles and non-file identities refuse by name',t=>{
  const f=fixture(t);f.put('physical/main.ts','');f.link('outside','../outside');f.link('absolute','/outside');f.link('a','b');f.link('b','a');
  const owner=committedProjectPaths({tree:f.tree,revision:f.commit()});
  for(const path of ['outside/main.ts','absolute/main.ts'])assert.throws(()=>owner.identity(path),/committed project match leaves source/);
  assert.throws(()=>owner.identity('a/main.ts'),/symlink cycle/);
  assert.throws(()=>owner.identity('physical'),/not a source file/);
  assert.throws(()=>owner.identity('../physical/main.ts'),/invalid committed project match/);
});

test('one committed owner reads each tree and alias blob once across file identities',t=>{
  const f=fixture(t);f.put('physical/one.ts','');f.put('physical/two.ts','');f.link('one','physical');f.link('two','physical');
  const calls:string[]=[],owner=committedProjectPaths({tree:f.tree,revision:f.commit()},request=>{calls.push(request.args?.[1]??'');return infrastructureProbe(request);});
  const names=owner.identity('one/one.ts');names.length=0;
  assert.ok(owner.identity('one/one.ts').includes('physical/one.ts'));owner.identity('two/two.ts');assert.equal(owner.hasAlias('one/two.ts'),true);
  assert.equal(calls.filter(call=>call==='ls-tree').length,1);
  assert.equal(calls.filter(call=>call==='cat-file').length,1,'identical link blobs are shared inside this revision only');
});
