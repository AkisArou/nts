import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {userInfo} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {ENVIRONMENT_CONTEXT,gateEnvironment} from './canonical-environment.ts';
import {ownMemory,ownMemoryEnv} from './test-memory.ts';
import {fixtureEnvironment,testEnvironment,testEnvironmentHandoff} from './test-environment.ts';
import {contentCacheEnvironment} from './cache-environment.ts';
import {testScratch} from './test-scratch.ts';

test('a child owns HOME, XDG, temporary and Git, and drops ambient policy',()=>{
  const poison={PATH:process.env.PATH,HOME:'/unowned/home',XDG_CONFIG_HOME:'/unowned/config',TMPDIR:'/unowned/tmp',
    NODE_OPTIONS:'--this-option-must-never-reach-node',NODE_PATH:'/unowned/modules',RUSTFLAGS:'poison',
    GIT_DIR:'/unowned/repository',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.bare',GIT_CONFIG_VALUE_0:'true',
    NTS_GATE_SLOTS:'1',NTS_TEST_UNKNOWN:'poison',PRIVATE_TOKEN:'hidden'};
  const env=testEnvironment({},poison),other=testEnvironment({},poison);
  for(const name of ['NODE_OPTIONS','NODE_PATH','RUSTFLAGS','GIT_DIR','GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0','NTS_GATE_SLOTS','NTS_TEST_UNKNOWN','PRIVATE_TOKEN'])assert.equal(env[name],undefined,name);
  for(const name of ['HOME','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','XDG_STATE_HOME','TMPDIR']){
    assert.ok(existsSync(env[name]!),name);assert.notEqual(env[name],other[name],name);
    assert.ok(env[name]!.startsWith(join(userInfo().homedir,'.cache/')));
  }
  writeFileSync(join(env.HOME!,'.gitconfig'),'[core]\n bare = true\n');
  const git=spawnSync('git',['config','--global','--get','core.bare'],{env,encoding:'utf8'});
  assert.equal(git.status,1,git.stderr);
  const node=spawnSync(process.execPath,['-e','console.log(process.env.NTS_TEST_UNKNOWN??"clean")'],{env,encoding:'utf8'});
  assert.equal(node.status,0,node.stderr);assert.equal(node.stdout.trim(),'clean');
});

test('explicit fixture values override the allowlist',()=>{
  const env=testEnvironment({NTS_GATE_SLOTS:'2',NODE_OPTIONS:'--no-warnings',FIXTURE_PROTOCOL:'owned'});
  assert.equal(env.NTS_GATE_SLOTS,'2');assert.equal(env.NODE_OPTIONS,'--no-warnings');assert.equal(env.FIXTURE_PROTOCOL,'owned');
});

test('mutable state has one fixture lifetime and shared caches are named capabilities',()=>{
  const cleanups:(()=>void)[]=[],fixture={after:(fn:()=>void)=>{cleanups.push(fn);}};
  const first=fixtureEnvironment(fixture),second=fixtureEnvironment(fixture),other=testEnvironment();
  assert.equal(first.HOME,second.HOME);assert.equal(first.TMPDIR,second.TMPDIR);assert.notEqual(first.HOME,other.HOME);
  for(const [name,path] of Object.entries(contentCacheEnvironment())){
    assert.equal(first[name],path);assert.equal(other[name],path);assert.ok(!path.startsWith(first.HOME!));
  }
  first.FIXTURE_LOCAL='changed';assert.equal(second.FIXTURE_LOCAL,undefined,'each child receives its own map');
  for(const cleanup of cleanups)cleanup();assert.equal(existsSync(first.HOME!),false);
});

test('declared Node, JDK and rustup directories precede HOME-dependent shims',t=>{
  const root=testScratch(t,'environment-tools'),shim=join(root,'shims'),jdk=join(root,'jdk'),cargo=join(root,'cargo');
  for(const directory of [shim,join(jdk,'bin'),join(cargo,'bin')])mkdirSync(directory,{recursive:true});
  for(const name of ['java','node','cargo'])writeFileSync(join(shim,name),'#!/bin/sh\nexit 126\n',{mode:0o755});
  writeFileSync(join(jdk,'bin/java'),'#!/bin/sh\necho declared-jdk\n',{mode:0o755});
  writeFileSync(join(cargo,'bin/cargo'),'#!/bin/sh\necho declared-rustup\n',{mode:0o755});
  const env=testEnvironment({JAVA_HOME:jdk,JDK_HOME:undefined,CARGO_HOME:cargo},{PATH:shim});
  for(const [command,args,expected] of [['node',['-p','"declared-node"'],'declared-node'],['java',[],'declared-jdk'],['cargo',[],'declared-rustup']] as const){
    const result=spawnSync(command,args,{env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),expected);
  }
});

test('a fixture retains canonical compiler and resource capabilities with a nested temporary',t=>{
  const root=testScratch(t,'environment-context'),memory=ownMemory(join(root,'memory'));
  const parent=gateEnvironment({PATH:process.env.PATH},{run:join(root,'run'),owned:{NTS_BIN:'/fixture/compiler',...memory,NTS_MEMORY_RESERVATION:'parent',NTS_MEMORY_PRIORITY:'landing',NTS_GATE_SLOTS:'1'}}).env;
  const child=testEnvironment({},parent),context=JSON.parse(child[ENVIRONMENT_CONTEXT]!);
  assert.equal(child.NTS_BIN,'/fixture/compiler');assert.equal(child.NTS_HOST_OBSERVATIONS,memory.NTS_HOST_OBSERVATIONS);
  assert.equal(child.NTS_MEMORY_RESERVATION,'parent');assert.equal(child.NTS_MEMORY_PRIORITY,'landing');assert.equal(child.NTS_GATE_SLOTS,undefined);
  assert.equal(context.owned.NTS_GATE_SLOTS,undefined);assert.equal(context.temporary.path,child.TMPDIR);
  assert.ok(child.TMPDIR!.startsWith(parent.TMPDIR!+'/'));assert.equal(context.report.host.HOME,child.HOME);
  const independent=ownMemoryEnv(join(root,'independent'),child),handoff=JSON.parse(independent[ENVIRONMENT_CONTEXT]!);
  assert.equal(independent.NTS_MEMORY_RESERVATION,undefined);assert.equal(handoff.owned.NTS_MEMORY_RESERVATION,undefined);
  assert.equal(handoff.owned.NTS_MEMORY_PRIORITY,undefined);assert.equal(handoff.owned.NTS_HOST_OBSERVATIONS,independent.NTS_HOST_OBSERVATIONS);
  parent.NTS_TOOLING_SLICE='current-runtime-slice';
  assert.equal(testEnvironment({},parent).NTS_TOOLING_SLICE,'current-runtime-slice');
});

test('generated CommonJS and ESM shims forward only named fixture handoffs',()=>{
  const env=testEnvironment({FIXTURE_READY:'owned',UNRELATED_POISON:'hidden',NTS_MEMORY_RESERVATION:'explicit-reservation'});
  const expression=testEnvironmentHandoff(['FIXTURE_READY','NTS_MEMORY_RESERVATION']);
  for(const mode of ['commonjs','module']){
    const child=spawnSync(process.execPath,['--input-type='+mode,'-e',`console.log(JSON.stringify(${expression}))`],{env,encoding:'utf8'});
    assert.equal(child.status,0,child.stderr);const actual=JSON.parse(child.stdout);
    assert.equal(actual.FIXTURE_READY,'owned');assert.equal(actual.NTS_MEMORY_RESERVATION,'explicit-reservation');
    assert.equal(actual.UNRELATED_POISON,undefined);assert.equal(actual.HOME,env.HOME);
  }
});
