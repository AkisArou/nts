import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,readFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {testScratch} from './test-scratch.ts';
import {durableRecord} from './durable-record.ts';
import {installationCatalog,dependencyHash,type DependencyCatalogTrust} from '../inputs/dependency-catalog.ts';
import type {Identity} from '../inputs/dependency-inputs.ts';
import {projectDependencies} from './project-dependencies.ts';
import {projectInputOwner} from './project-inputs.ts';
import {moduleGraph} from './module-closure.ts';
import {projectConfig} from './reader-inputs/main.ts';
import {readHostObservation} from '../differential/oracle-filesystem.ts';
import {validateReaderSourceObservations,readerObservationDependency,replayFixtureReaderObservations} from './reader-observations.ts';
import {runtimeRepositoryClaims} from './rust-input-claims.ts';

function fixture(t:Parameters<typeof testScratch>[0]){
  const scratch=testScratch(t,'project-installed-catalog'),root=join(scratch,'source');
  const put=(path:string,text:string)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);};
  put('package.json','{"name":"catalog-control","private":true}');put('pnpm-lock.yaml','supplied lock input\n');put('recipe.ts','// supplied producer input\n');
  put('tsconfig.json','{"compilerOptions":{"module":"preserve","moduleResolution":"bundler","types":[]},"files":["main.ts"]}');
  put('main.ts',"import type {Value} from 'fixture-package';export const value:Value=1;");
  const packagePath='node_modules/.pnpm/fixture-package@1.0.0/node_modules/fixture-package';
  put(packagePath+'/package.json','{"name":"fixture-package","version":"1.0.0","types":"index.d.ts"}');
  put(packagePath+'/index.d.ts','export type Value=number;');
  symlinkSync('.pnpm/fixture-package@1.0.0/node_modules/fixture-package',join(root,'node_modules/fixture-package'));
  const input={version:2 as const,pnpm:'10.15.0',manager:'supplied manager',node:process.versions.node,platform:process.platform,arch:process.arch,
    inputs:['package.json','pnpm-lock.yaml'].map(path=>({path,sha256:dependencyHash(readFileSync(join(root,path)))})),importers:['.']};
  const identity:Identity={...input,key:dependencyHash(JSON.stringify(input))};
  // The supplied install identity is separate from the actual finite inventory
  // algorithm under test; the verified install/publication has its own controls.
  const catalog=installationCatalog(root,identity,[{path:'recipe.ts',sha256:dependencyHash(readFileSync(join(root,'recipe.ts')))}]);
  const path=join(scratch,'catalog.json');durableRecord(path,catalog);
  const trust:DependencyCatalogTrust={catalogPath:path,catalogSha256:dependencyHash(readFileSync(path))};
  return {root,packagePath,trust};
}

test('declared Program package reads retain finite identity and only repository pin reach',t=>{
  const f=fixture(t),owner=moduleGraph({sourceRoot:f.root,dependencyCatalog:f.trust});
  try{
    const snapshot=owner.describe([projectConfig(pathToFileURL(join(f.root,'tsconfig.json')))]);
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
