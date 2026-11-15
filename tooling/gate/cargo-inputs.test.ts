import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {cargoMetadata,cargoRuntimeTargets,cargoInputPaths} from './cargo-inputs.ts';
import {testScratch} from './test-scratch.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {spawnTest} from './test-wait.ts';
import {gitArguments} from './git-arguments/main.ts';
import {buildRustSelectorMaterial} from './rust-selector-build.ts';

test('Cargo inventory detaches callers and refuses new file keys bound to old target rows',t=>{
  const root=testScratch(t,'cargo-input-generation'),env=fixtureEnvironment(t);mkdirSync(join(root,'src'));
  const manifest='[package]\nname="cargo-generation"\nversion="0.0.0"\nedition="2021"\n';
  writeFileSync(join(root,'Cargo.toml'),manifest);writeFileSync(join(root,'src/lib.rs'),'');
  for(const args of [['init','-q'],['add','.']]){const result=spawnTest('git',gitArguments(args),{cwd:root,env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
  const first=cargoMetadata(root),targets=cargoRuntimeTargets(root);assert.equal(targets.length,1);first.packages.length=0;
  assert.equal(cargoMetadata(root).packages.length,1,'caller mutation does not alter the captured inventory');
  const declarations={version:1 as const,targets:targets.map(target=>({target,declarations:{imports:[],assets:[]}}))};
  writeFileSync(join(root,'declarations.json'),JSON.stringify(declarations));
  writeFileSync(join(root,'Cargo.toml'),manifest+'\n[lib]\ntest=false\ndoctest=true\n');
  assert.throws(()=>cargoRuntimeTargets(root),/Cargo inventory inputs changed since acquisition/);
  assert.throws(()=>buildRustSelectorMaterial({sourceRoot:root,manifest:declarations,inventory:()=>cargoRuntimeTargets(root),declarations:'declarations.json',engine:['src/lib.rs'],cargoInputs:cargoInputPaths(root),tracked:()=>[{path:'src/lib.rs',mode:'100644'}]}),/Cargo inventory inputs changed since acquisition/);
});
