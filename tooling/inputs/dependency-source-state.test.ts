import {dependencySourceCandidates} from './dependency-source-candidates.ts';
import assert from 'node:assert/strict';
import {mkdirSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {gitArguments} from '../gate/git-arguments/main.ts';
import {spawnTest} from '../gate/test-wait.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {dependencyRecipeModules} from './dependency-inputs.ts';
import {sourceState,assertSourceState} from './dependency-source-state.ts';

test('literal source pathspecs fence clean, dirty, renamed and unusual members only',t=>{
  const root=testScratch(t,'dependency-source-state');
  const names=['tooling/clean.ts','tooling/dirty.ts','tooling/space member.ts','tooling/glob[1]*?.ts',':literal.ts'];
  const git=(...args:string[])=>{
    const result=spawnTest('git',gitArguments(args),{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout;
  };
  for(const name of [...names,'unrelated.txt','tooling/glob1ZZ.ts']){
    mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),'export const value=1;\n');
  }
  git('init','-q');git('add','.');git('-c','user.name=source control','-c','user.email=source@example.invalid','commit','-qm','tracked sources');
  writeFileSync(join(root,'tooling/dirty.ts'),'export const value=2;\n');
  const before=sourceState(root,names);
  assert.deepEqual([...before.index.keys()].sort(),[...names].sort());
  assert.deepEqual([...before.status.keys()],['tooling/dirty.ts']);
  writeFileSync(join(root,'unrelated.txt'),'unrelated tracked edit');
  writeFileSync(join(root,'tooling/untracked.ts'),'untracked non-member');
  writeFileSync(join(root,'tooling/glob1ZZ.ts'),'a wildcard sibling must stay outside the snapshot');
  assert.deepEqual(sourceState(root,names),before);
  assert.doesNotThrow(()=>assertSourceState(root,before,names,'producer'));
  for(const name of ['tooling/clean.ts','tooling/dirty.ts','tooling/space member.ts','tooling/glob[1]*?.ts',':literal.ts']){
    const snapshot=sourceState(root,[name]);writeFileSync(join(root,name),'export const value=3;\n');
    assert.throws(()=>assertSourceState(root,snapshot,[name],'producer'),/source changed during installation/,name);
  }
  assert.throws(()=>assertSourceState(root,before,['tooling/untracked.ts'],'producer'),/was not captured before installation/);
  git('add','.');git('-c','user.name=source control','-c','user.email=source@example.invalid','commit','-qm','private edits');
  const old='tooling/space member.ts',next='tooling/renamed member.ts',renamed=sourceState(root,[old,next]);
  renameSync(join(root,old),join(root,next));git('add','--all');
  const after=sourceState(root,[old,next]);
  assert.ok(after.status.get(next)?.startsWith('2 '),'the actual porcelain rename row is retained');
  assert.equal(after.status.get(old),after.status.get(next),'the original path carries the same rename observation');
  assert.throws(()=>assertSourceState(root,renamed,[old],'producer'),/untracked or ignored|source changed/);
});

test('the actual installation recipe belongs to the strict tooling module inventory',()=>{
  const root=fileURLToPath(new URL('../..',import.meta.url)),candidates=dependencySourceCandidates(root),members=dependencyRecipeModules(root);
  assert.ok(candidates.length>0);assert.ok(members.length>0);
  const snapshot=sourceState(root,candidates);
  assert.doesNotThrow(()=>assertSourceState(root,snapshot,members,'producer'));
});

test('imported JSON is data while executable code outside tooling refuses the source fence',t=>{
  const root=testScratch(t,'dependency-recipe-code');mkdirSync(join(root,'tooling/inputs'),{recursive:true});
  writeFileSync(join(root,'tooling/inputs/dependency-inputs.ts'),"import data from '../../data.json' with {type:'json'}; import value from '../../outside.ts'; export {data,value};");
  writeFileSync(join(root,'data.json'),'{"value":1}');writeFileSync(join(root,'outside.ts'),'export default 1;');
  for(const args of [['init','-q'],['add','.']]){
    const result=spawnTest('git',gitArguments(args),{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  }
  const members=dependencyRecipeModules(root);
  assert.ok(!members.includes('data.json'));assert.ok(members.includes('outside.ts'));
  const snapshot=sourceState(root,dependencySourceCandidates(root));
  assert.throws(()=>assertSourceState(root,snapshot,members,'producer'),/not captured before installation: outside\.ts.*git add <path>/);
});
