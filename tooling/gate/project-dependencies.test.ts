import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {installedCatalogFixture} from './installed-catalog-fixture.ts';
import {projectDependencies} from './project-dependencies.ts';
import {projectInputOwner} from './project-inputs.ts';
import {moduleGraph} from './module-closure.ts';
import {projectConfig} from './reader-inputs/main.ts';
import {readHostObservation} from '../differential/oracle-filesystem.ts';
import {validateReaderSourceObservations,readerObservationDependency,replayFixtureReaderObservations} from './reader-observations.ts';
import {runtimeRepositoryClaims} from './rust-input-claims.ts';
import {runtimeInstalledInputClassifier} from './rust-input-provenance.ts';

const fixture=installedCatalogFixture;

test('declared Program package reads retain finite identity and only repository pin reach',t=>{
  const f=fixture(t),owner=moduleGraph({sourceRoot:f.root,dependencyCatalog:f.trust});
  try{
    const snapshot=owner.describe([projectConfig(pathToFileURL(join(f.root,'tsconfig.json')),'compiled-program')]);
    const installed=snapshot.observations.filter(row=>row.dependency);
    assert.ok(installed.some(row=>row.observation.kind==='file'&&row.dependency?.package?.name==='fixture-package'&&row.dependency.package.version==='1.0.0'));
    assert.ok(installed.every(row=>readerObservationDependency(f.root,row)===undefined));
    for(const path of ['package.json','pnpm-lock.yaml','recipe.ts']){
      assert.ok(snapshot.files.includes(path),path);
      if(path!=='package.json')assert.ok(!snapshot.runtimeFiles!.includes(path),path+' has selection reach only');
      assert.ok(snapshot.observations.some(row=>row.selectorOnly&&row.observation.kind==='file'&&row.observation.path===join(f.root,path)));
    }
    assert.ok(snapshot.runtimeFiles!.includes('package.json'),'the Program independently reads its source package goal; pinning must not demote it');
    assert.ok(!snapshot.files.some(path=>path.startsWith('node_modules/')));
    validateReaderSourceObservations(snapshot,f.root);
    const runtime=runtimeInstalledInputClassifier(f.root,snapshot),path=join(f.root,f.packagePath,'index.d.ts');
    const descriptor=(target:string)=>({kind:'descriptor' as const,arg:0,fd:3,target,raw:Buffer.from(target).toString('hex')});
    const requirement={kind:'content' as const,following:'follow' as const};
    const classified=runtime.classify(descriptor(path),requirement);
    assert.equal(classified?.kind,'installed-dependency');assert.equal(classified?.dependency.package?.name,'fixture-package');
    assert.equal(runtime.classify(descriptor(join(f.root,'node_modules/unlisted.d.ts')),requirement),undefined);
    assert.equal(runtime.classify(descriptor(path),{kind:'mutation',role:'open',readsContent:false,following:'follow'}),undefined);
    const alias={kind:'path' as const,arg:1,dirfdArg:0,name:join(f.root,'undeclared-alias'),raw:'00',anchor:{kind:'absolute' as const},resolution:{state:'resolved' as const,path,components:[{path:join(f.root,'undeclared-alias'),kind:'symlink' as const,dev:'1',ino:'2',link:path}]}};
    assert.equal(runtime.classify(alias,requirement),undefined,'an undeclared source alias stays commit-changeable');
    const installedAlias={...alias,name:join(f.root,'node_modules/fixture-package/index.d.ts'),resolution:{...alias.resolution,components:[{
      ...alias.resolution.components[0]!,path:join(f.root,'node_modules/fixture-package'),link:'.pnpm/fixture-package@1.0.0/node_modules/fixture-package',
    }]}};
    assert.equal(runtime.classify(installedAlias,requirement)?.kind,'installed-dependency','the verified catalog owns its alias layout even without a Program readlink callback');
    installedAlias.resolution.components[0]!.link='.pnpm/other';
    assert.throws(()=>runtime.classify(installedAlias,requirement),/not in the authenticated installation catalog/);
    assert.throws(()=>replayFixtureReaderObservations({...snapshot,observations:installed},f.root,join(f.root,'copy'),new Set(['<entry>'])),/fixture requires its own authenticated installation/);
    const claims=runtimeRepositoryClaims(f.root,snapshot);
    assert.equal(claims.match({kind:'content',following:'follow'},{state:'resolved',path:join(f.root,'pnpm-lock.yaml')}).kind,'uncovered');
    writeFileSync(join(f.root,'pnpm-lock.yaml'),'changed pin');
    assert.throws(()=>validateReaderSourceObservations(snapshot,f.root),/dependency catalog is pending: .*pin changed: pnpm-lock.yaml/);
  }finally{owner.close();}
});

test('catalog matching authenticates exact membership, aliases, absence and file bytes',t=>{
  const f=fixture(t),owner=projectDependencies(f.root,f.trust);assert.equal(owner.state,'current');if(owner.state!=='current')return;
  const fact=(kind:Parameters<typeof readHostObservation>[0],path:string)=>({kind,path:join(f.root,path),value:readHostObservation(kind,join(f.root,path))});
  for(const [kind,path]of [['file','node_modules/fixture-package/index.d.ts'],['entries','node_modules'],['runtimeEntries','node_modules'],['readlink','node_modules/fixture-package'],['fileExists','node_modules/missing/deep.ts']] as const)
    assert.ok(owner.match(fact(kind,path)),kind+' '+path);
  writeFileSync(join(f.root,'node_modules/unknown.d.ts'),'export {};');
  assert.throws(()=>owner.match(fact('file','node_modules/unknown.d.ts')),/not in the authenticated installation catalog/);
  assert.throws(()=>owner.match(fact('runtimeEntries','node_modules')),/not in the authenticated installation catalog/);
  writeFileSync(join(f.root,f.packagePath,'index.d.ts'),'export type Value=string;');
  assert.throws(()=>owner.match(fact('file','node_modules/fixture-package/index.d.ts')),/not in the authenticated installation catalog/);
  rmSync(join(f.root,'node_modules/fixture-package'));symlinkSync('.pnpm/missing',join(f.root,'node_modules/fixture-package'));
  assert.throws(()=>owner.match(fact('readlink','node_modules/fixture-package')),/not in the authenticated installation catalog/);
});

test('a catalog failure drains the Program transaction and permits a fresh read and close',t=>{
  const f=fixture(t),original=readFileSync(f.trust.catalogPath),owner=projectInputOwner(f.root,undefined,undefined,f.trust);
  try{
    const first=owner.read([{kind:'config',path:'tsconfig.json'}]);assert.ok(first.dependencyObservations.length);
    writeFileSync(f.trust.catalogPath,'malformed changed catalog');
    assert.throws(()=>owner.read([{kind:'config',path:'tsconfig.json'}]),/catalog digest mismatch/);
    writeFileSync(f.trust.catalogPath,original);
    const next=owner.read([{kind:'config',path:'tsconfig.json'}]);assert.ok(next.dependencyObservations.length);
  }finally{owner.close();}
  assert.throws(()=>owner.read([{kind:'config',path:'tsconfig.json'}]),/owner is closed/);
});

test('a pending catalog names the installed packages the Program itself classifies as external',t=>{
  const f=fixture(t);
  f.put('local/tsconfig.json','{"compilerOptions":{"types":[]},"files":["local.ts"]}');f.put('local/local.ts','export const local=1;');
  for(const trust of [f.trust,null]){
    const owner=projectInputOwner(f.root,undefined,undefined,trust);
    try{
      const reached=owner.read([{kind:'config',path:'tsconfig.json'}]).installationReach;
      if(trust)assert.equal(reached,undefined,'a current catalog owes nothing');
      else assert.deepEqual(reached,{reason:'installation catalog is missing',packages:[{package:'fixture-package@1.0.0',file:f.packagePath+'/index.d.ts'}]});
      assert.equal(owner.read([{kind:'config',path:'local/tsconfig.json'}]).installationReach,undefined,'a Program with no installed reach owes nothing');
    }finally{owner.close();}
  }
});
