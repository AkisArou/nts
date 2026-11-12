import {gitArguments} from "./git-arguments/main.ts";
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {hostEnvironment,FIXED_AMBIENT} from './canonical-environment.ts';
import {bypassesScratchOwner,newTestScratch,TestScratch} from './test-scratch.ts';

function fixture(body:(parent:string)=>void){
  const parent=newTestScratch('rust-scratch-check');
  try{body(parent);}finally{rmSync(parent,{recursive:true,force:true});}
}

test('after-binary check accepts cleanup, reports leaks and removes both namespaces',()=>fixture(parent=>{
  const clean=new TestScratch(parent,'passing-binary');
  assert.equal(clean.environment({}).NTS_TEST_SCRATCH_ROOT,clean.path);
  assert.deepEqual(clean.finish(),[]);
  assert.equal(existsSync(clean.path),false);
  const leaked=new TestScratch(parent,'leaking-binary');
  const path=join(leaked.path,'test-name');
  writeFileSync(path,'left over');
  assert.deepEqual(leaked.finish(),[path]);
  assert.equal(existsSync(leaked.path),false);
  assert.deepEqual(readdirSync(parent),[]);
}));

test('checked Cargo runner fails and cleans after a child is killed',()=>fixture(parent=>{
  const child=join(parent,'killed-child.cjs');
  writeFileSync(child,`const fs=require('node:fs');fs.writeFileSync(process.env.NTS_TEST_SCRATCH_ROOT+'/killed-test','partial');process.kill(process.pid,'SIGKILL');`);
  const run=spawnSync(process.execPath,[fileURLToPath(new URL('./rust-test-runner.ts',import.meta.url)),process.execPath,child],{
    env:{...hostEnvironment(process.env),...FIXED_AMBIENT,TMPDIR:parent},encoding:'utf8',
  });
  assert.equal(run.status,1,run.stderr);
  assert.match(run.stderr,/test scratch leaked by .*node.*\(removed\)/);
  assert.match(run.stderr,/killed-test/);
  assert.deepEqual(readdirSync(join(parent,'rust-tests')),[]);
}));

test('checked Cargo runner fails and cleans when its binary does not exist',()=>fixture(parent=>{
  const run=spawnSync(process.execPath,[fileURLToPath(new URL('./rust-test-runner.ts',import.meta.url)),join(parent,'absent')],{
    env:{...hostEnvironment(process.env),...FIXED_AMBIENT,TMPDIR:parent},encoding:'utf8',
  });
  assert.notEqual(run.status,0,run.stderr);
  assert.match(run.stderr,/ENOENT/);
  assert.deepEqual(readdirSync(join(parent,'rust-tests')),[]);
}));

test('compile-time target scratch is reachable only through its shared owner',()=>{
  assert.equal(bypassesScratchOwner('let p=Path::new(env!("CARGO_TARGET_TMPDIR"));'),true);
  assert.equal(bypassesScratchOwner('let p=scratch::ScratchDir::in_target("test");'),false);
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const listed=spawnSync('git',gitArguments(['ls-files','-z','--','*.rs']),{cwd:root,env:hostEnvironment(process.env),encoding:'utf8'});
  assert.equal(listed.status,0,listed.stderr);
  const bad=listed.stdout.split('\0').filter(path=>path&&!path.startsWith('third_party/')&&path!=='compiler/test-support/scratch.rs')
    .filter(path=>bypassesScratchOwner(readFileSync(join(root,path),'utf8')));
  assert.deepEqual(bad,[],`use the shared scratch owner: ${bad.join(', ')}`);
});
