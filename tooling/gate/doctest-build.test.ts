import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixtureEnvironment} from './test-environment.ts';
import {testScratch} from './test-scratch.ts';
import {TEST_PROFILE_MANIFEST} from './test-profile.ts';

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
  const env={...fixtureEnvironment(t),CARGO_TARGET_DIR:target,CARGO_INCREMENTAL:undefined,NTS_TEST_PROFILE:undefined};
  const run=(list:boolean)=>{
    const artifacts=join(root,list?'prepared.json':'executed.json');
    const ran=spawnSync(process.execPath,[new URL('./test-profile.ts',import.meta.url).pathname,'--artifacts',artifacts,'workspace','--doc','-p','subject',...(list?['--','--list']:[])],{cwd:root,env,encoding:'utf8'});
    assert.equal(ran.status,0,ran.stdout+ran.stderr);
    const rows=JSON.parse(readFileSync(artifacts,'utf8')).artifacts as {fresh:boolean}[];
    assert.ok(rows.length);return {rows,output:ran.stdout+ran.stderr};
  };
  assert.ok(run(true).rows.some(row=>!row.fresh),'cold preparation compiles');
  const reused=run(false);assert.ok(reused.rows.every(row=>row.fresh),'execution compiles no library');assert.match(reused.output,/1 passed/);
  assert.ok(run(false).rows.every(row=>row.fresh),'warm execution stays warm');
  writeFileSync(dependency,readFileSync(dependency,'utf8')+'\npub fn changed() {}\n');
  assert.ok(run(true).rows.some(row=>!row.fresh),'changed dependency compiles in preparation');
  assert.ok(run(false).rows.every(row=>row.fresh),'changed dependency is fresh at execution');
  writeFileSync(subject,readFileSync(subject,'utf8').replace('answer(), 42','answer(), 0'));
  run(true);
  const broken=spawnSync(process.execPath,[new URL('./test-profile.ts',import.meta.url).pathname,'workspace','--doc','-p','subject'],{cwd:root,env,encoding:'utf8'});
  assert.equal(broken.status,101,broken.stdout+broken.stderr);assert.match(broken.stdout+broken.stderr,/FAILED/);
});
