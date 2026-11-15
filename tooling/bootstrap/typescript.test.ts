import {gitArguments} from '../gate/git-arguments/main.ts';
import {fixtureEnvironment} from '../gate/test-environment.ts';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {corpusPin,typescriptDefinition} from './typescript.ts';
import {corpus} from '../inputs/corpus.ts';
import {testScratch} from '../gate/test-scratch.ts';
function source(root:string,pin:string){
  const path=join(root,'tooling/bootstrap/typescript.pin'),vendor=join(root,'third_party/tsrs/UPSTREAM.json');
  for(const file of [path,vendor])mkdirSync(dirname(file),{recursive:true});
  writeFileSync(path,pin+'\n');writeFileSync(vendor,JSON.stringify({typescript_commit:pin}));
}
test('the corpus and checker must name one TypeScript revision',t=>{
  const root=testScratch(t,'typescript-native-pin'),pin='a'.repeat(40),other='b'.repeat(40);source(root,pin);
  assert.equal(corpusPin(root),pin);
  writeFileSync(join(root,'third_party/tsrs/UPSTREAM.json'),JSON.stringify({typescript_commit:other}));
  assert.throws(()=>corpusPin(root),(error:Error)=>error.message.includes(pin)&&error.message.includes(other)&&error.message.includes('vendor.ts --source'));
});
test('an existing checkout is verified without moving it or hiding local edits',t=>{
  const own=testScratch(t,'typescript-verify'),root=join(own,'upstream'),env=fixtureEnvironment(t);mkdirSync(root);
  const git=(...args:string[])=>execFileSync('git',gitArguments(args),{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');const file=join(root,'tsc/testdata/tests/cases/probe.ts');mkdirSync(dirname(file),{recursive:true});writeFileSync(file,'export const value=1;\n');
  git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@invalid','commit','-qm','source');
  const pin=git('rev-parse','--verify','HEAD^{commit}');source(own,pin);
  corpus(typescriptDefinition(own)).verify(root,env);
  source(own,'f'.repeat(40));assert.throws(()=>corpus(typescriptDefinition(own)).verify(root,env),/requires/);
  assert.equal(git('rev-parse','--verify','HEAD^{commit}'),pin);source(own,pin);
  writeFileSync(file,'export const value=2;\n');assert.throws(()=>corpus(typescriptDefinition(own)).verify(root,env),/local changes/);
});
