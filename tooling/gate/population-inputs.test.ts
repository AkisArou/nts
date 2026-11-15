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
  git('init','-q');git('add','.');
  const refresh=async()=>{
    await withPackageManager(root,{},manager=>manager.run(['install','--offline','--lockfile-only','--ignore-scripts']));
    git('add','.');await installDependencies(shared,root);
    const trust=installationCatalogTrust(shared,root);assert.ok(trust);return trust;
  };
  const entry=installationInputs(pathToFileURL(root+'/'));
  const describe=(trust:ReturnType<typeof installationCatalogTrust>)=>{
    const graph=moduleGraph({sourceRoot:root,dependencyCatalog:trust});try{return graph.describe([entry]);}finally{graph.close();}
  };
  const original=await refresh(),before=describe(original);
  assert.ok(before.runtimeFiles!.includes('packages/first/package.json'));
  assert.equal(runtimeRepositoryClaims(root,before).match({kind:'content',following:'follow'},{state:'resolved',path:join(root,'pnpm-lock.yaml')}).kind,'claimed');
  assert.throws(()=>describe(null),/installation input population is unavailable: installation catalog is missing/);
  put('packages/second/package.json',JSON.stringify({name:'second-owned-pin',version:'1.0.0'}));
  const current=await refresh(),after=describe(current);
  assert.ok(after.runtimeFiles!.includes('packages/second/package.json'));
  assert.throws(()=>describe(original),/catalog digest mismatch|installation input population is unavailable: .*pin changed/);
  const destination=join(parent,'copy');mkdirSync(destination);
  assert.throws(()=>copyModuleClosure([entry],destination,{sourceRoot:root,dependencyCatalog:null}),/fixture closure.*installation input population is unavailable/);
  copyModuleClosure([entry],destination,{sourceRoot:root,dependencyCatalog:current});
  assert.equal(readFileSync(join(destination,'packages/second/package.json'),'utf8'),readFileSync(join(root,'packages/second/package.json'),'utf8'));
  put('pnpm-lock.yaml',readFileSync(join(root,'pnpm-lock.yaml'),'utf8')+'\n# changed pin\n');
  assert.throws(()=>describe(current),/installation input population is unavailable: .*pin changed: pnpm-lock.yaml/);
});
