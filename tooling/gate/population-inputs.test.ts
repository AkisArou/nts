import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {cargoInputs,installationInputs} from './reader-inputs/main.ts';
import {moduleGraph} from './module-closure.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {testScratch} from './test-scratch.ts';
import {spawnTest} from './test-wait.ts';
import {gitArguments} from './git-arguments/main.ts';
import {withPackageManager} from '../inputs/package-manager.ts';
import {dependencyCache,installDependencies,installationCatalogTrust} from '../inputs/dependency-inputs.ts';
import {runtimeRepositoryClaims} from './rust-input-claims.ts';

test('Cargo metadata inputs follow the existing tracked population as a crate is added',t=>{
  const root=testScratch(t,'cargo-population-reader'),destination=testScratch(t,'cargo-population-copy');
  const put=(path:string,value:string)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),value);};
  const git=(...args:string[])=>{const result=spawnTest('git',gitArguments(args),{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);};
  put('Cargo.toml','[workspace]\nmembers=["first"]\n');put('first/Cargo.toml','[package]\nname="first"\nversion="0.1.0"\n');
  put('unrelated.txt','not Cargo metadata');git('init','-q');git('add','.');
  const entry=cargoInputs(pathToFileURL(root+'/'));
  const describe=()=>{const graph=moduleGraph({sourceRoot:root});try{return graph.describe([entry]);}finally{graph.close();}};
  const before=describe();assert.ok(before.runtimeFiles!.includes('first/Cargo.toml'));assert.ok(!before.files.includes('unrelated.txt'));
  put('second/Cargo.toml','[package]\nname="second"\nversion="0.1.0"\n');put('Cargo.toml','[workspace]\nmembers=["first","second"]\n');git('add','.');
  const after=describe();assert.ok(after.runtimeFiles!.includes('second/Cargo.toml'));
  copyModuleClosure([entry],destination,{sourceRoot:root});
  assert.equal(readFileSync(join(destination,'second/Cargo.toml'),'utf8'),readFileSync(join(root,'second/Cargo.toml'),'utf8'));
});

test('verified installation pins acquire a new workspace manifest without a declaration edit',async t=>{
  const parent=testScratch(t,'installation-population'),shared=join(parent,'shared'),root=join(parent,'source');
  mkdirSync(shared);mkdirSync(root);
  const cache=dependencyCache(shared);
  t.after(()=>rmSync(cache,{recursive:true,force:true}));
  const put=(path:string,value:string)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),value);};
  const git=(...args:string[])=>{const result=spawnTest('git',gitArguments(args),{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);};
  put('package.json',JSON.stringify({name:'owned-pins',private:true,packageManager:'pnpm@10.15.0'}));
  put('pnpm-workspace.yaml',"packages:\n  - 'packages/*'\n");put('.gitignore','node_modules/\n');
  put('packages/first/package.json',JSON.stringify({name:'first-owned-pin',version:'1.0.0'}));
  put('Cargo.toml','[package]\nname="installation-reader-control"\nversion="0.1.0"\nedition="2021"\n');put('src/lib.rs','');
  put('tooling/gate/all.sh',`#!/bin/sh
if [ "$1" = --list ]; then printf '%s\\n' proof; exit; fi
step "proof" node tooling/private/pins.ts
`);
  put('tooling/gate/run.mjs','');put('tooling/gate/tooling-test-exclusions.json','[]');put('tooling/empty.test.ts','');
  put('tooling/gate/reader-inputs/main.ts','export const installationInputs=url=>({url});');
  put('tooling/private/pins.ts',"import {installationInputs} from '../gate/reader-inputs/main.ts';installationInputs(new URL('../..',import.meta.url));");
  put('docs/ordinary.md','prose');
  git('init','-q');git('add','.');
  const refresh=async()=>{
    await withPackageManager(root,{},manager=>manager.run(['install','--offline','--lockfile-only','--ignore-scripts']));
    git('add','.');await installDependencies(shared,root);
    const trust=installationCatalogTrust(shared,root);assert.ok(trust);return trust;
  };
  const entry=installationInputs(pathToFileURL(root+'/'));
  const describe=(trust:ReturnType<typeof installationCatalogTrust>,selection=false)=>{
    const graph=moduleGraph({sourceRoot:root,dependencyCatalog:trust,unavailableInputs:selection?'conservative':'refuse'});try{return graph.describe([entry]);}finally{graph.close();}
  };
  const select=(trust:ReturnType<typeof installationCatalogTrust>)=>{
    const script=`import {owed,gateSteps,inputMetadataDeclarations} from ${JSON.stringify(new URL('./owed.mjs',import.meta.url).href)};
const trust=${JSON.stringify({acceptedRustRecordBlob:null,dependencyCatalog:trust})};
const choose=path=>{const rows=owed([{path,sameMode:true,before:'old',after:'new'}],trust);return {steps:gateSteps(rows),unknown:rows.filter(row=>row.name.startsWith('installation inputs unknown:'))};};
console.log(JSON.stringify({ordinary:choose('docs/ordinary.md'),pin:choose('pnpm-lock.yaml'),metadata:inputMetadataDeclarations(trust)}));`;
    const result=spawnTest(process.execPath,['--input-type=module','-e',script],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);
    return JSON.parse(result.stdout) as {ordinary:{steps:string[];unknown:{name:string;steps:string[]}[]};pin:{steps:string[]};metadata:{unavailableInputs:{reason:string;steps:string[]}[]}};
  };
  const original=await refresh(),before=describe(original);
  assert.ok(before.runtimeFiles!.includes('packages/first/package.json'));
  assert.equal(runtimeRepositoryClaims(root,before).match({kind:'content',following:'follow'},{state:'resolved',path:join(root,'pnpm-lock.yaml')}).kind,'claimed');
  assert.throws(()=>describe(null),/installation input population is unavailable: installation catalog is missing/);
  const missing=describe(null,true);assert.equal(missing.unavailableInputs?.length,1);
  assert.match(missing.unavailableInputs![0]!.reason,/installation catalog is missing/);
  assert.ok(!missing.files.includes('packages/first/package.json'));
  const nullSelection=select(null);
  assert.ok(nullSelection.ordinary.steps.includes('proof'));
  assert.ok(nullSelection.ordinary.unknown.some(row=>/installation catalog is missing/.test(row.name)&&row.steps.includes('proof')));
  assert.ok(nullSelection.metadata.unavailableInputs.some(row=>/installation catalog is missing/.test(row.reason)&&row.steps.includes('proof')));
  put('packages/second/package.json',JSON.stringify({name:'second-owned-pin',version:'1.0.0'}));
  const current=await refresh(),after=describe(current);
  assert.ok(after.runtimeFiles!.includes('packages/second/package.json'));
  const currentSelection=select(current);
  assert.ok(!currentSelection.ordinary.steps.includes('proof'));assert.deepEqual(currentSelection.ordinary.unknown,[]);
  assert.ok(currentSelection.pin.steps.includes('proof'));assert.deepEqual(currentSelection.metadata.unavailableInputs,[]);
  assert.throws(()=>describe(original),/catalog digest mismatch|installation input population is unavailable: .*pin changed/);
  const destination=join(parent,'copy');mkdirSync(destination);
  assert.throws(()=>copyModuleClosure([entry],destination,{sourceRoot:root,dependencyCatalog:null,unavailableInputs:'conservative'}),/fixture closure.*installation input population is unavailable/);
  copyModuleClosure([entry],destination,{sourceRoot:root,dependencyCatalog:current});
  assert.equal(readFileSync(join(destination,'packages/second/package.json'),'utf8'),readFileSync(join(root,'packages/second/package.json'),'utf8'));
  put('pnpm-lock.yaml',readFileSync(join(root,'pnpm-lock.yaml'),'utf8')+'\n# changed pin\n');
  assert.throws(()=>describe(current),/installation input population is unavailable: .*pin changed: pnpm-lock.yaml/);
  assert.match(describe(current,true).unavailableInputs![0]!.reason,/pin changed: pnpm-lock.yaml/);
  const staleSelection=select(current);
  assert.ok(staleSelection.ordinary.steps.includes('proof'));
  assert.ok(staleSelection.ordinary.unknown.some(row=>/pin changed: pnpm-lock.yaml/.test(row.name)&&row.steps.includes('proof')));
});
