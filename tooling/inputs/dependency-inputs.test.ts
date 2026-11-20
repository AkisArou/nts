import {gitArguments} from "../gate/git-arguments/main.ts";
import assert from "node:assert/strict";
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join} from "node:path";
import {test} from "node:test";
import {spawnTest} from "../gate/test-wait.ts";
import {dependencyCache,identity,installDependencies,installationCatalogState,installationIdentityPath,installationCatalogPath,installationCatalogTrust} from "./dependency-inputs.ts";
import {installedCatalogFixture} from '../gate/installed-catalog-fixture.ts';
import {readDependencyCatalog} from './dependency-catalog.ts';
import {withPackageManager} from "./package-manager.ts";
import {registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {fixtureEnvironment} from '../gate/test-environment.ts';

test('the real offline CLI bootstraps its catalog from a tracked tree with no node_modules',async t=>{
  const tree=testScratch(t,'catalog-empty-install'),source=fileURLToPath(new URL('../..',import.meta.url)),env=fixtureEnvironment(t);
  const common=spawnTest('git',gitArguments(['rev-parse','--path-format=absolute','--git-common-dir']),{cwd:source,env,encoding:'utf8'});assert.equal(common.status,0,common.stderr);
  const shared=dirname(common.stdout.trim()),state=installationIdentityPath(shared,tree),catalogPath=installationCatalogPath(shared,tree);
  t.after(()=>{rmSync(state,{force:true});rmSync(catalogPath,{force:true});});
  copyModuleClosure(['tooling/inputs/dependency-inputs.ts'],tree);
  const current=await withPackageManager(source,{},manager=>identity(source,manager));
  // Copy the installation owner's actual pinning inputs, including workspace
  // manifests, so this is the real frozen install rather than a stand-in SDK.
  for(const row of current.inputs)if(row.sha256!=='absent'){
    const output=join(tree,row.path);mkdirSync(dirname(output),{recursive:true});writeFileSync(output,readFileSync(join(source,row.path)));
  }
  writeFileSync(join(tree,'.gitignore'),'node_modules/\n');
  const git=(args:string[])=>{const result=spawnTest('git',gitArguments(args),{cwd:tree,env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);};
  git(['init','-q']);git(['add','.']);git(['-c','user.name=catalog control','-c','user.email=control@example.invalid','commit','-qm','tracked empty installation']);
  assert.equal(existsSync(join(tree,'node_modules')),false);
  const result=spawnTest(process.execPath,['tooling/inputs/dependency-inputs.ts','--offline',shared,tree],{cwd:tree,env,encoding:'utf8',maxBuffer:64<<20});
  assert.equal(result.status,0,result.stdout+result.stderr);
  const trust=installationCatalogTrust(shared,tree);assert.ok(trust);
  const catalog=readDependencyCatalog(trust,tree);assert.equal(catalog.state,'current');
  if(catalog.state==='current')assert.ok(catalog.catalog.packages.some(row=>row.name==='typescript'));
});

test("dependency preparation and old-paths accept a tracked inventory larger than 1 MiB",async t=>{
  const scratch=mkdtempSync(join(tmpdir(),"nts-dependency-inventory-"));
  const root=join(scratch,"shared"),tree=join(scratch,"tree");
  mkdirSync(root);mkdirSync(tree);
  t.after(()=>{rmSync(dependencyCache(root),{recursive:true,force:true});rmSync(scratch,{recursive:true,force:true});});
  const git=(...args:string[])=>{
    const result=spawnTest("git",gitArguments(args),{cwd:tree,encoding:"utf8",maxBuffer:Infinity});
    assert.equal(result.status,0,result.error?.message??result.stderr);return result.stdout;
  };
  git("init","--quiet");
  writeFileSync(join(tree,"package.json"),JSON.stringify({name:"large-inventory-control",private:true,packageManager:"pnpm@10.15.0"}));
  writeFileSync(join(tree,'.gitignore'),'node_modules/\n');
  writeFileSync(join(tree,"pnpm-lock.yaml"),"lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n");
  await withPackageManager(tree,{},manager=>manager.run(["install","--offline","--lockfile-only","--ignore-scripts"]));
  mkdirSync(join(tree,"inventory"));
  for(let i=0;i<5000;i++)writeFileSync(join(tree,"inventory",`${"x".repeat(210)}-${i}.txt`),"");
  const tracked=join(tree,"fixture/node_modules/source.txt");
  mkdirSync(join(tree,"fixture/node_modules"),{recursive:true});writeFileSync(tracked,"tracked source\n");
  git("add","--all");
  const inventoryBytes=Buffer.byteLength(git("ls-files","-z"));
  assert.ok(inventoryBytes>1024*1024,"the preparation must cross Node's default output ceiling");
  t.diagnostic(`tracked inventory: ${inventoryBytes} bytes`);
  const stale=join(tree,"node_modules/stale.txt");
  mkdirSync(join(tree,"node_modules"));writeFileSync(stale,"old installation\n");
  const identity=await installDependencies(root,tree);
  assert.match(identity!,/^[0-9a-f]{64}$/);
  assert.equal(existsSync(stale),false);
  assert.equal(readFileSync(tracked,"utf8"),"tracked source\n");
  assert.equal(JSON.parse(readFileSync(join(tree,"package.json"),"utf8")).name,"large-inventory-control");
  const trust=installationCatalogTrust(root,tree);assert.ok(trust);
  const catalog=readDependencyCatalog(trust,tree);assert.equal(catalog.state,'current');
  if(catalog.state==='current')assert.equal(catalog.catalog.identity.key,identity);
  const originalLock=readFileSync(join(tree,'pnpm-lock.yaml'));
  writeFileSync(join(tree,'pnpm-lock.yaml'),Buffer.concat([originalLock,Buffer.from('\n# changed lock input\n')]));
  const staleCatalog=readDependencyCatalog(trust,tree);assert.equal(staleCatalog.state,'pending');
  if(staleCatalog.state==='pending')assert.match(staleCatalog.reason,/pin changed: pnpm-lock.yaml/);
  writeFileSync(join(tree,'pnpm-lock.yaml'),originalLock);
  rmSync(installationCatalogPath(root,tree));
  assert.equal(installationCatalogTrust(root,tree),null);
  assert.equal(readDependencyCatalog(trust,tree).state,'pending');
  assert.equal(await installDependencies(root,tree),identity,'a current old installation still enters the verified offline owner');
  const backfilled=installationCatalogTrust(root,tree);assert.ok(backfilled);
  assert.equal(readDependencyCatalog(backfilled,tree).state,'current','an ordinary call backfills the missing catalog after verification');
  const oldPaths=spawnTest(process.execPath,[new URL("../migrate/old-paths.ts",import.meta.url).pathname],{cwd:tree,encoding:"utf8"});
  assert.equal(oldPaths.status,0,oldPaths.error?.message??oldPaths.stderr);
  assert.match(oldPaths.stdout,/0 file\(s\) under an old root, 0 line\(s\) naming one/);
});

for(const sameSource of [false,true])for(const mutation of ['clean','dirty','unrelated'] as const)test(`catalog publication fences ${mutation} changes with ${sameSource?'one source root':'independent target pins'}`,async t=>{
  const scratch=mkdtempSync(join(tmpdir(),'nts-catalog-generation-')),shared=join(scratch,'shared'),producer=join(scratch,'producer'),tree=sameSource?producer:join(scratch,'tree');
  for(const path of new Set([shared,tree,producer]))mkdirSync(path);
  t.after(()=>{rmSync(dependencyCache(shared),{recursive:true,force:true});rmSync(scratch,{recursive:true,force:true});});
  copyModuleClosure(['tooling/inputs/dependency-inputs.ts'],producer);
  writeFileSync(join(tree,'package.json'),JSON.stringify({name:'catalog-generation-control',private:true,packageManager:'pnpm@10.15.0'}));
  writeFileSync(join(tree,'.gitignore'),'node_modules/\n');
  writeFileSync(join(tree,'pnpm-lock.yaml'),"lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n");
  const init=spawnTest('git',gitArguments(['init','--quiet']),{cwd:tree,encoding:'utf8'});assert.equal(init.status,0,init.stderr);
  await withPackageManager(tree,{},manager=>manager.run(['install','--offline','--lockfile-only','--ignore-scripts']));
  for(const args of [['init','-q'],['add','.'],['-c','user.name=catalog control','-c','user.email=control@example.invalid','commit','-qm','tracked producer']]){
    const result=spawnTest('git',gitArguments(args),{cwd:producer,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  }
  const leaf=join(producer,'tooling/inputs/dependency-inventory.ts'),before=readFileSync(leaf,'utf8');
  if(mutation==='dirty')writeFileSync(leaf,before+'\n// pre-existing dirty producer bytes\n');
  const changed=mutation==='unrelated'?join(producer,'unrelated-output.txt'):leaf;
  const query=pathToFileURL(join(producer,'tooling/inputs/dependency-inputs.ts')).href+'?generation-control';
  const supplied='data:text/javascript,'+encodeURIComponent(`
    import {withPackageManager as actual} from ${JSON.stringify(new URL('./package-manager.ts',import.meta.url).href)};
    import {writeFileSync,readFileSync} from 'node:fs';
    export async function withPackageManager(tree,options,operation){return actual(tree,options,manager=>operation({...manager,run:async args=>{
      const result=await manager.run(args);
      if(args[0]==='install'&&args.includes('--frozen-lockfile'))writeFileSync(${JSON.stringify(changed)},${mutation==='unrelated'?JSON.stringify('unrelated output created during installation'):"readFileSync("+JSON.stringify(leaf)+",'utf8')+'\\n// controlled producer edit\\n'"});
      return result;
    }}));}
  `);
  const hooks=registerHooks({resolve(specifier,context,next){
    if(context.parentURL===query&&specifier==='./package-manager.ts')return {url:supplied,shortCircuit:true};
    if(context.parentURL===query&&specifier==='../gate/module-closure.ts')return {url:new URL('../gate/module-closure.ts',import.meta.url).href,shortCircuit:true};
    return next(specifier,context);
  }});
  try{
    const {installDependencies:subject}=await import(query);
    if(mutation==='unrelated'){
      assert.match((await subject(shared,tree))!,/^[a-f0-9]{64}$/);
      assert.equal(readFileSync(changed,'utf8'),'unrelated output created during installation');
      assert.ok(existsSync(installationCatalogPath(shared,tree)),'unrelated output cannot invalidate unchanged producer code');
    }else{
      await assert.rejects(subject(shared,tree),/catalog producer source changed during installation/);
      assert.notEqual(readFileSync(leaf,'utf8'),before,'the real await boundary performed the private edit');
      assert.equal(existsSync(installationCatalogPath(shared,tree)),false,'no new recipe bytes can certify the older producer work');
    }
  }finally{hooks.deregister();}
});

test('a tree\'s catalog state: current, stale by a changed pin with the command that republishes it, and none without a package graph',t=>{
  const fixture=installedCatalogFixture(t),shared='/shared-checkout';
  const current=installationCatalogState(shared,fixture.root,fixture.trust);
  assert.equal(current.state,'current');
  fixture.put('recipe.ts','// a rebased producer input\n');
  const stale=installationCatalogState(shared,fixture.root,fixture.trust);
  assert.deepEqual(stale,{state:'stale',message:`installation catalog pin changed: recipe.ts; publish with node tooling/inputs/linker.ts work "${shared}" "${fixture.root}"`});
  assert.deepEqual(installationCatalogState(shared,fixture.root,null),{state:'stale',message:`installation catalog is missing; publish with node tooling/inputs/linker.ts work "${shared}" "${fixture.root}"`});
  const scratch=testScratch(t,'catalog-no-graph');
  assert.deepEqual(installationCatalogState(shared,scratch,null),{state:'none'},'a tree that installs nothing owes no catalog');
});
