import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixtureEnvironment} from './test-environment.ts';
import {testScratch} from './test-scratch.ts';
import {TEST_PROFILE_MANIFEST} from './test-profile.ts';
import {assertDoctestPreparation} from './doctest-preparation.ts';

test('listing doctests prepares the identical graph, including dev dependency features',t=>{
  const root=testScratch(t,'doctest-build'),target=join(root,'external-target');
  for(const name of ['subject','dependency'])mkdirSync(join(root,name,'src'),{recursive:true});
  const profile=readFileSync(TEST_PROFILE_MANIFEST,'utf8').split(/(?=^\[)/m).find(part=>part.startsWith('[profile.nts-dev]'));
  writeFileSync(join(root,'Cargo.toml'),'[workspace]\nmembers=["subject","dependency"]\nresolver="2"\n'+profile);
  writeFileSync(join(root,'dependency/Cargo.toml'),'[package]\nname="dependency"\nversion="0.0.0"\nedition="2024"\n[features]\ndoc_feature=[]\n');
  const dependency=join(root,'dependency/src/lib.rs');
  writeFileSync(dependency,'#[cfg(feature="doc_feature")] pub fn answer() -> u32 { 42 }\n');
  writeFileSync(join(root,'subject/Cargo.toml'),'[package]\nname="subject"\nversion="0.0.0"\nedition="2024"\n[dependencies]\ndependency={path="../dependency"}\n[dev-dependencies]\ndependency={path="../dependency",features=["doc_feature"]}\n');
  const subject=join(root,'subject/src/lib.rs');
  writeFileSync(subject,'/// ```\n/// assert_eq!(subject::answer(), 42);\n/// ```\npub fn answer() -> u32 { dependency::answer() }\n');
  const env={...fixtureEnvironment(t),CARGO_TARGET_DIR:target,CARGO_INCREMENTAL:undefined,NTS_TEST_PROFILE:undefined,
    NTS_DOCTEST_CRATES:'subject',NTS_DOCTEST_PREPARATION:join(root,'prepared.json'),NTS_BUILD_DOCTESTS:'1'};
  const run=(list:boolean)=>{
    const artifacts=join(root,list?'prepared.json':'executed.json');
    const ran=spawnSync(process.execPath,[new URL('./test-profile.ts',import.meta.url).pathname,'--artifacts',artifacts,list?'doctests-build':'doctests'],{cwd:root,env,encoding:'utf8'});
    assert.equal(ran.status,0,ran.stdout+ran.stderr);
    const rows=JSON.parse(readFileSync(artifacts,'utf8')).artifacts as {fresh:boolean}[];
    assert.ok(rows.length);return {rows,output:ran.stdout+ran.stderr};
  };
  assert.ok(run(true).rows.some(row=>!row.fresh),'cold preparation compiles');
  assert.doesNotThrow(()=>assertDoctestPreparation(env,root));
  for(const changed of [{NTS_DOCTEST_PREPARATION:undefined},{NTS_DOCTEST_CRATES:'dependency'},{CARGO_TARGET_DIR:root}])
    assert.throws(()=>assertDoctestPreparation({...env,...changed},root),/doctests needs successful shared build preparation/);
  const reused=run(false);assert.ok(reused.rows.every(row=>row.fresh),'execution compiles no library');assert.match(reused.output,/1 passed/);
  assert.ok(run(false).rows.every(row=>row.fresh),'warm execution stays warm');
  writeFileSync(dependency,readFileSync(dependency,'utf8')+'\npub fn changed() {}\n');
  assert.ok(run(true).rows.some(row=>!row.fresh),'changed dependency compiles in preparation');
  assert.ok(run(false).rows.every(row=>row.fresh),'changed dependency is fresh at execution');
  writeFileSync(subject,readFileSync(subject,'utf8').replace('answer(), 42','answer(), 0'));
  run(true);
  const broken=spawnSync(process.execPath,[new URL('./doctests.ts',import.meta.url).pathname],{cwd:root,env,encoding:'utf8'});
  assert.equal(broken.status,1,broken.stdout+broken.stderr);assert.match(broken.stdout+broken.stderr,/FAILED/);
});

test('doctest execution refuses missing preparation before Cargo or disk admission',t=>{
  const root=testScratch(t,'doctest-unprepared');
  const ran=spawnSync(process.execPath,[new URL('./doctests.ts',import.meta.url).pathname],{cwd:root,env:fixtureEnvironment(t),encoding:'utf8'});
  assert.equal(ran.status,2,ran.stdout+ran.stderr);assert.match(ran.stderr,/doctests needs successful shared build preparation/);
});
