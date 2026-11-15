import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {cargoInputs,installationInputs,dependencySourceInputs,installationStatusInputs} from './reader-inputs/main.ts';
import {moduleGraph} from './module-closure.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {testScratch} from './test-scratch.ts';
import {spawnTest} from './test-wait.ts';
import {gitArguments} from './git-arguments/main.ts';
import {withPackageManager} from '../inputs/package-manager.ts';
import {dependencyCache,installDependencies,installationCatalogTrust} from '../inputs/dependency-inputs.ts';
import {runtimeRepositoryClaims} from './rust-input-claims.ts';
import {readDependencyCatalog} from '../inputs/dependency-catalog.ts';
import {oracleWorkspaceFixture} from '../differential/oracle-workspace-fixture.ts';
import {dependencySourceCandidates} from '../inputs/dependency-source-candidates.ts';
import {installationSelectionPath,installationStatusCandidates,gitStatusInputPopulation} from '../inputs/dependency-input-names.ts';

test('Git fence descriptors follow their indexed owners and retain control-file absences',t=>{
  const root=testScratch(t,'git-fence-populations');
  const put=(path:string,text:string)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);};
  const git=(...args:string[])=>{const result=spawnTest('git',gitArguments(args),{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);};
  put('tooling/first.ts','export const value=1;');put('tests/programs/not-tooling.ts','corpus');
  put('.gitattributes','*.ts text\n');put('package.json','{"private":true}');
  put('packages/one/package.json','{"name":"one","bin":"./command.js"}');put('packages/one/command.js','#!/usr/bin/env node\n');put('packages/one/value.txt','workspace bytes');
  put('packages/one/.gitignore','ignored\n');git('init','-q');git('add','.');
  const describe=(kind:'producer'|'installation')=>{
    const graph=moduleGraph({sourceRoot:root});
    try{return graph.describe([kind==='producer'?dependencySourceInputs(pathToFileURL(root+'/')):installationStatusInputs(pathToFileURL(root+'/'))]);}
    finally{graph.close();}
  };
  const producer=describe('producer');
  assert.deepEqual(producer.runtimeFiles!.filter(path=>path.endsWith('.ts')),dependencySourceCandidates(root));
  assert.ok(producer.runtimeFiles!.includes('.gitattributes'));assert.ok(!producer.files.includes('tests/programs/not-tooling.ts'));
  assert.ok(producer.optionalFiles.some(row=>row.path==='tooling/.gitignore'&&!row.present));
  assert.ok(!producer.placingFiles.includes('tooling/first.ts'),'a Git content read never places that module for execution');
  const installed=describe('installation');
  for(const path of ['packages/one/package.json','packages/one/command.js','packages/one/.gitignore'])assert.ok(installed.runtimeFiles!.includes(path),path);
  assert.ok(!installed.files.includes('packages/one/value.txt'),'workspace code is a consumer input, not an installation input');
  assert.ok(installed.optionalFiles.some(row=>row.path==='packages/one/.npmrc'&&!row.present),'an importer retains its absent installation configuration');
  assert.ok(!installed.directories.some(row=>row.directory==='packages/one'&&row.kind==='inspection'));
  put('tooling/next.ts','export const value=2;');put('packages/two/package.json','{"name":"two"}');git('add','.');
  assert.ok(describe('producer').runtimeFiles!.includes('tooling/next.ts'));
  assert.ok(describe('installation').runtimeFiles!.includes('packages/two/package.json'));
  const names=['package.json','packages/one/package.json','packages/two/package.json'];
  assert.ok(names.filter(installationSelectionPath).every(path=>installationStatusCandidates(names,path=>readFileSync(join(root,path),'utf8')).includes(path)));
  const literal=gitStatusInputPopulation(['space/glob[1]*?.ts'],['space/glob[1]*?.ts','space/glob1ZZ.ts']);
  assert.deepEqual(literal.files,['space/glob[1]*?.ts']);assert.ok(literal.controls.includes('space/.gitattributes'));
});

test('oracle workspace staging consumes verified installer pins without unrelated manifests',t=>{
  const source=fileURLToPath(new URL('../..',import.meta.url)),tree=testScratch(t,'oracle-workspace-pins');
  const git=(root:string,...args:string[])=>{
    const result=spawnTest('git',gitArguments(args),{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout;
  };
  const shared=dirname(git(source,'rev-parse','--path-format=absolute','--git-common-dir').trim());
  const catalog=readDependencyCatalog(installationCatalogTrust(shared,source),source);assert.equal(catalog.state,'current');
  const pins=new Set(catalog.catalog.identity.inputs.filter(row=>row.sha256!=='absent').map(row=>row.path));
  const outside=git(source,'ls-files','-z','--',':(glob)**/package.json').split('\0').find(path=>path&&!pins.has(path));assert.ok(outside);
  oracleWorkspaceFixture(t,tree,source);
  for(const path of pins)assert.deepEqual(readFileSync(join(tree,path)),readFileSync(join(source,path)),path);
  assert.equal(existsSync(join(tree,outside)),false,'a non-importer manifest is not an installation input');
  const staged=git(tree,'ls-files','-z','--',':(glob)**/package.json').split('\0').filter(Boolean);
  assert.ok(staged.every(path=>pins.has(path)),'all staged package manifests come from the installation owner');
});

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

test('population and host leaves do not inherit the execution fences',()=>{
  const root=fileURLToPath(new URL('../..',import.meta.url)),graph=moduleGraph({sourceRoot:root});
  try{
    for(const entry of ['tooling/inputs/dependency-source-candidates.ts','tooling/gate/host-environment.ts','tooling/inputs/dependency-catalog.ts','tooling/gate/module-closure.ts']){
      const snapshot=graph.describe([entry]);
      assert.ok(!snapshot.files.includes('tooling/tasks/new.ts'),entry+' owns no tooling-wide status reads');
      assert.ok(!snapshot.moduleFiles.includes('tooling/inputs/dependency-source-state.ts'),entry+' never executes the source fence');
      assert.ok(!snapshot.moduleFiles.includes('tooling/differential/oracle-dependencies.ts'),entry+' never prepares a dependency image');
    }
    assert.ok(graph.describe(['tooling/inputs/dependency-source-state.ts']).files.includes('tooling/tasks/new.ts'),'the actual executable fence keeps its declared population');
  }finally{graph.close();}
});

test('fixture staging separates fence inspection from reproductive facts with order-independent promotion',t=>{
  const root=testScratch(t,'staging-roles'),put=(name:string,body:string)=>{mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),body);};
  put('tooling/gate/reader-inputs/main.ts','export const dependencySourceInputs=(url:URL)=>({url});');
  put('tooling/fence.ts',"import {dependencySourceInputs} from './gate/reader-inputs/main.ts';export const input=dependencySourceInputs(new URL('../',import.meta.url));");
  put('tooling/unrelated.ts','export const value=1;');put('.gitignore','ignored\n');
  const git=(...args:string[])=>{const result=spawnTest('git',gitArguments(args),{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);};git('init','-q');git('add','.');
  const describe=(entries:Parameters<ReturnType<typeof moduleGraph>['describe']>[0])=>{const graph=moduleGraph({sourceRoot:root});try{return graph.describe(entries);}finally{graph.close();}};
  const selected=describe(['tooling/fence.ts']);
  assert.ok(selected.files.includes('tooling/unrelated.ts'));assert.ok(!selected.placingFiles.includes('tooling/unrelated.ts'));assert.ok(!selected.stagingFiles.includes('tooling/unrelated.ts'));
  assert.ok(selected.optionalFiles.some(row=>row.path==='.gitignore'&&row.inspectionOnly));
  const destination=testScratch(t,'stage-fence');copyModuleClosure(['tooling/fence.ts'],destination,{sourceRoot:root});
  assert.equal(existsSync(join(destination,'tooling/unrelated.ts')),false);assert.equal(existsSync(join(destination,'.gitignore')),false);
  for(const entries of [['tooling/fence.ts','tooling/unrelated.ts'],['tooling/unrelated.ts','tooling/fence.ts']]){
    assert.ok(describe(entries).stagingFiles.includes('tooling/unrelated.ts'));
    const promoted=testScratch(t,'stage-promotion');copyModuleClosure(entries,promoted,{sourceRoot:root});assert.equal(readFileSync(join(promoted,'tooling/unrelated.ts'),'utf8'),'export const value=1;');
  }
  const direct=dependencySourceInputs(pathToFileURL(root+'/')),explicit=testScratch(t,'stage-explicit');
  assert.ok(describe([direct]).stagingFiles.includes('tooling/unrelated.ts'));copyModuleClosure([direct],explicit,{sourceRoot:root});
  assert.equal(readFileSync(join(explicit,'.gitignore'),'utf8'),'ignored\n');assert.ok(existsSync(join(explicit,'tooling/unrelated.ts')));
});
