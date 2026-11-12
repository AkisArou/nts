import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {clippyEnvironment,CLIPPY_ARGUMENTS} from './clippy.ts';
import {assertClippyTarget,clippyTarget} from './build-targets.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {newTestScratch} from './test-scratch.ts';

test('target roots and selected Clippy caches cannot be confused',()=>{
  const root='/fixture/target',cache=clippyTarget(root);
  assert.deepEqual(CLIPPY_ARGUMENTS,['clippy','--workspace','--all-targets','--','-D','warnings']);
  assert.equal(clippyEnvironment('root',{CARGO_TARGET_DIR:root},'/fixture').CARGO_TARGET_DIR,cache);
  assert.equal(clippyEnvironment('cache',{CARGO_TARGET_DIR:cache},'/fixture').CARGO_TARGET_DIR,cache);
  assert.equal(clippyEnvironment('cache',{},'/fixture').CARGO_TARGET_DIR,cache);
  assert.throws(()=>clippyEnvironment('cache',{CARGO_TARGET_DIR:root},'/fixture'),/selected cache/);
  assert.throws(()=>assertClippyTarget('/fixture/target/debug'),/selected cache/);
});

for(const route of ['contributor','shell'] as const)test(route+' Clippy entry builds only in the declared cache',t=>{
  const root=newTestScratch('clippy-target-route');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const tree=join(root,'tree'),bin=join(root,'bin'),target=join(root,'target'),capture=join(root,'called.json');
  copyModuleClosure(['tooling/gate/clippy.ts'],tree);
  copyFileSync(new URL('./all.sh',import.meta.url),join(tree,'tooling/gate/all.sh'));
  mkdirSync(bin);
  writeFileSync(join(bin,'cargo'),`#!${process.execPath}
const {durableRecord}=require(${JSON.stringify(new URL('./durable-record.ts',import.meta.url).pathname)});
durableRecord(${JSON.stringify(capture)},{args:process.argv.slice(2),target:process.env.CARGO_TARGET_DIR});process.exit(7);
`,{mode:0o755});
  const run=(selected:string)=>spawnSync(route==='shell'?'sh':process.execPath,
    route==='shell'?[join(tree,'tooling/gate/all.sh'),'--call','clippy']:[join(tree,'tooling/gate/clippy.ts')],
    {cwd:tree,encoding:'utf8',env:{...fixtureEnvironment(t),PATH:[bin,dirname(process.execPath),'/usr/bin'].join(':'),CARGO_TARGET_DIR:selected,NTS_JOBS:undefined}});
  const result=run(route==='shell'?clippyTarget(target):target);
  assert.notEqual(result.status,0,'the Cargo failure survives both routes');
  assert.deepEqual(JSON.parse(readFileSync(capture,'utf8')),{args:[...CLIPPY_ARGUMENTS],target:clippyTarget(target)});
  assert.equal(existsSync(join(target,'debug')),false);
  if(route==='shell'){
    rmSync(capture);
    const wrong=run(target);
    assert.match(wrong.stdout+wrong.stderr,/Clippy selected cache/);
    assert.equal(existsSync(capture),false,'a root passed as a cache never invokes Cargo');
  }
});
