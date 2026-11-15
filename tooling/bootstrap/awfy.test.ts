import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {test} from 'node:test';
import {testScratch} from '../gate/test-scratch.ts';
import {fixtureEnvironment} from '../gate/test-environment.ts';
import {gitArguments} from '../gate/git-arguments/main.ts';
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {corpusPin,prepare,verifyCheckout} from './awfy.ts';

function repository(parent:string,env:NodeJS.ProcessEnv){
  const root=join(parent,'upstream');mkdirSync(root);
  const git=(...args:string[])=>execFileSync('git',gitArguments(args),{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');
  for(const path of ['benchmarks/C++/src/bounce.h','benchmarks/Java/src/Bounce.java','docs/README.md']){
    mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),'first\n');
  }
  git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@example.test','commit','-qm','First corpus');
  const pin=git('rev-parse','--verify','HEAD^{commit}');
  return {root,pin,git};
}
test('fresh acquisition selects the pin rather than the upstream default and preserves an existing checkout',t=>{
  const own=testScratch(t,'awfy-acquisition'),env=fixtureEnvironment(t),f=repository(own,env);
  writeFileSync(join(f.root,'docs/README.md'),'second\n');f.git('add','.');f.git('-c','user.name=fixture','-c','user.email=fixture@example.test','commit','-qm','Advance default branch');
  const destination=join(own,'acquired');prepare(destination,{pin:f.pin,source:f.root,env});
  verifyCheckout(destination,f.pin,env);assert.equal(readFileSync(join(destination,'docs/README.md'),'utf8'),'first\n');
  prepare(destination,{pin:f.pin,source:join(own,'absent-upstream'),env});
  const second=f.git('rev-parse','--verify','HEAD^{commit}');
  assert.throws(()=>prepare(destination,{pin:second,source:f.root,env}),error=>error instanceof Error&&error.message.includes(destination)&&error.message.includes(f.pin)&&error.message.includes(second));
  verifyCheckout(destination,f.pin,env);
  writeFileSync(join(destination,'docs/README.md'),'local edit\n');
  assert.throws(()=>verifyCheckout(destination,f.pin,env),/local changes/);
  assert.equal(readFileSync(join(destination,'docs/README.md'),'utf8'),'local edit\n');
});
test('the real linker checks its candidate pin before linking and refuses mismatched or dirty shared sources',t=>{
  const own=testScratch(t,'awfy-link'),env=fixtureEnvironment(t),f=repository(own,env),shared=join(own,'shared'),tree=join(own,'candidate');
  mkdirSync(tree);copyModuleClosure(['tooling/inputs/link.sh','tooling/bootstrap/awfy.ts'],tree);
  // Other acquisition owners are private stand-ins in this linker control.
  for(const path of ['tooling/inputs/node-inputs.ts','tooling/inputs/dependency-inputs.ts'])writeFileSync(join(tree,path),'process.exitCode=0;\n');
  writeFileSync(join(tree,'tooling/bootstrap/awfy.pin'),f.pin+'\n');
  const corpus=join(shared,'third_party/are-we-fast-yet');prepare(corpus,{pin:f.pin,source:f.root,env});
  const link=()=>spawnSync('sh',[join(tree,'tooling/inputs/link.sh'),'work',shared,tree],{cwd:tree,env,encoding:'utf8'});
  const ok=link();assert.equal(ok.status,0,ok.stderr);assert.equal(readlinkSync(join(tree,'third_party/are-we-fast-yet')),corpus);
  writeFileSync(join(tree,'tooling/bootstrap/awfy.pin'),'f'.repeat(40)+'\n');
  const mismatch=link();assert.notEqual(mismatch.status,0);assert.match(mismatch.stderr,/requires f{40}/);assert.equal(readlinkSync(join(tree,'third_party/are-we-fast-yet')),corpus);
  writeFileSync(join(tree,'tooling/bootstrap/awfy.pin'),f.pin+'\n');writeFileSync(join(corpus,'docs/README.md'),'dirty\n');
  const dirty=link();assert.notEqual(dirty.status,0);assert.match(dirty.stderr,/local changes/);
  assert.equal(readFileSync(join(corpus,'docs/README.md'),'utf8'),'dirty\n');assert.ok(existsSync(join(corpus,'.git')));
});
test('the data pin is one full revision',()=>assert.match(corpusPin(),/^[a-f0-9]{40}$/));
