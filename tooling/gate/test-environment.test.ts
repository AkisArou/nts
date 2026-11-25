import {gitArguments} from "./git-arguments/main.ts";
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {userInfo} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {gateEnvironment} from './canonical-environment.ts';
import {ownedCacheEnvironment} from './host-environment.ts';
import {ENVIRONMENT_CONTEXT} from '../differential/oracle-seal/main.ts';
import {ownMemory,ownMemoryEnv} from './test-memory.ts';
import {fixtureEnvironment,testEnvironment,testEnvironmentHandoff} from './test-environment.ts';
import {CONTENT_CACHE_ENVIRONMENT,FIXTURE_ENVIRONMENT,cacheLocation,contentCacheEnvironment} from './cache-environment.ts';
import {testScratch} from './test-scratch.ts';
import {fixtureToolingSlice} from './tooling-slice-fixture.ts';
import {assertNoProcessUsers} from '../landing/tree-users.ts';
import {hostObservations,HostObservationError} from './host-observations.ts';
import {MemoryRun} from '../census/worker-memory.ts';

test('a new fixture packet declares only its creator; forwarding and later acquisition invent no rows',async t=>{
  const created=testEnvironment({},{PATH:process.env.PATH}),env=fixtureEnvironment(t,created);
  const host=hostObservations(env),group=host.ownCgroup();
  assert.deepEqual(host.cgroupMembers(group),[process.pid]);
  const before=readFileSync(created.NTS_HOST_OBSERVATIONS!,'utf8');
  const forwarded=testEnvironment({},env);
  assert.equal(forwarded.NTS_HOST_OBSERVATIONS,created.NTS_HOST_OBSERVATIONS);
  assert.equal(readFileSync(created.NTS_HOST_OBSERVATIONS!,'utf8'),before);
  const run=new MemoryRun({budgetBytes:128*2**20,id:'fixture-later-acquisition'});
  try{
    const ref=host.acquireCgroup(run.group);
    assert.throws(()=>host.cgroupMembers(ref.path,ref.inode),error=>error instanceof HostObservationError&&error.message.includes('resident.members has no cgroup '+run.group));
    assert.equal(readFileSync(created.NTS_HOST_OBSERVATIONS!,'utf8'),before);
  }finally{run.close();await run.closed;}
});

test('a child owns HOME, XDG, temporary and Git, and drops ambient policy',()=>{
  const poison={PATH:process.env.PATH,HOME:'/unowned/home',XDG_CONFIG_HOME:'/unowned/config',TMPDIR:'/unowned/tmp',
    NODE_OPTIONS:'--this-option-must-never-reach-node',NODE_PATH:'/unowned/modules',RUSTFLAGS:'poison',
    GIT_DIR:'/unowned/repository',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.bare',GIT_CONFIG_VALUE_0:'true',
    NTS_GATE_SLOTS:'1',NTS_TEST_UNKNOWN:'poison',PRIVATE_TOKEN:'hidden'};
  const env=testEnvironment({},poison),other=testEnvironment({},poison);
  for(const name of ['NODE_OPTIONS','NODE_PATH','RUSTFLAGS','GIT_DIR','NTS_GATE_SLOTS','NTS_TEST_UNKNOWN','PRIVATE_TOKEN'])assert.equal(env[name],undefined,name);
  assert.equal(env.GIT_CONFIG_COUNT,'2');assert.equal(env.GIT_CONFIG_KEY_0,'maintenance.auto');assert.equal(env.GIT_CONFIG_VALUE_0,'false');
  assert.equal(env.GIT_CONFIG_KEY_1,'gc.auto');assert.equal(env.GIT_CONFIG_VALUE_1,'0');
  for(const name of ['HOME','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','XDG_STATE_HOME','TMPDIR']){
    assert.ok(existsSync(env[name]!),name);assert.notEqual(env[name],other[name],name);
    assert.ok(env[name]!.startsWith(join(userInfo().homedir,'.cache/')));
  }
  writeFileSync(join(env.HOME!,'.gitconfig'),'[core]\n bare = true\n');
  const git=spawnSync('git',gitArguments(['config','--global','--get','core.bare']),{env,encoding:'utf8'});
  assert.equal(git.status,1,git.stderr);
  const node=spawnSync(process.execPath,['-e','console.log(process.env.NTS_TEST_UNKNOWN??"clean")'],{env,encoding:'utf8'});
  assert.equal(node.status,0,node.stderr);assert.equal(node.stdout.trim(),'clean');
});

test('explicit fixture values override the allowlist',()=>{
  const env=testEnvironment({NTS_GATE_SLOTS:'2',NODE_OPTIONS:'--no-warnings',FIXTURE_PROTOCOL:'owned'});
  assert.equal(env.NTS_GATE_SLOTS,'2');assert.equal(env.NODE_OPTIONS,'--no-warnings');assert.equal(env.FIXTURE_PROTOCOL,'owned');
});

test('fixture environments leave Rust toolchain discovery to each child working tree',t=>{
  const standalone=testEnvironment({},{RUSTUP_TOOLCHAIN:'nightly'});
  assert.equal(standalone.RUSTUP_TOOLCHAIN,undefined);
  const root=testScratch(t,'environment-rust');
  const parent=gateEnvironment(standalone,{run:join(root,'run'),owned:ownMemory(join(root,'memory'))}).env;
  const child=testEnvironment({},parent),nested=testEnvironment({},child);
  for(const env of [parent,child,nested]){
    assert.equal(env.RUSTUP_TOOLCHAIN,undefined);
    assert.equal(JSON.parse(env[ENVIRONMENT_CONTEXT]!).owned.RUSTUP_TOOLCHAIN,undefined);
  }
});

test('fixture commit storms launch no detached automatic Git maintenance',t=>{
  const root=testScratch(t,'environment-git'),repo=join(root,'repo'),trace=join(root,'git-events.jsonl');mkdirSync(repo);
  const env=fixtureEnvironment(t,{GIT_TRACE2_EVENT:trace});
  const git=(...args:string[])=>{const result=spawnSync('git',gitArguments(args),{cwd:repo,env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
  git('init','-q','-b','main');git('config','maintenance.auto','true');git('config','gc.auto','1');
  assert.equal(git('config','--get','maintenance.auto'),'false');assert.equal(git('config','--get','gc.auto'),'0');
  writeFileSync(join(repo,'value'),'0');git('add','value');
  for(let i=0;i<24;i++){writeFileSync(join(repo,'value'),String(i+1));git('commit','-qam','fixture generation '+i);}
  const events=readFileSync(trace,'utf8').trim().split('\n').map(line=>JSON.parse(line) as {event:string;argv?:string[]});
  assert.ok(events.some(row=>row.event==='start'&&row.argv?.includes('commit')),'the trace observed the real commits');
  assert.deepEqual(events.filter(row=>row.event==='child_start'&&row.argv?.some(arg=>arg==='maintenance'||arg==='gc')),[]);
  assert.equal(existsSync(join(repo,'.git/objects/maintenance.lock')),false);assert.equal(existsSync(join(repo,'.git/gc.pid')),false);
  assertNoProcessUsers([repo],{self:process.pid});
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
  const root=testScratch(t,'environment-context'),memory=ownMemory(join(root,'memory')),{slice}=fixtureToolingSlice(t);
  const parent=gateEnvironment({PATH:process.env.PATH},{run:join(root,'run'),owned:{NTS_BIN:'/fixture/compiler',...memory,NTS_TOOLING_SLICE:slice,NTS_MEMORY_RESERVATION:'parent',NTS_MEMORY_PRIORITY:'landing',NTS_GATE_SLOTS:'1'}}).env;
  const child=testEnvironment({},parent),context=JSON.parse(child[ENVIRONMENT_CONTEXT]!);
  assert.equal(child.NTS_BIN,'/fixture/compiler');assert.equal(child.NTS_HOST_OBSERVATIONS,memory.NTS_HOST_OBSERVATIONS);
  assert.equal(child.NTS_MEMORY_RESERVATION,'parent');assert.equal(child.NTS_MEMORY_PRIORITY,'landing');assert.equal(child.NTS_GATE_SLOTS,undefined);
  assert.equal(context.owned.NTS_GATE_SLOTS,undefined);assert.equal(context.temporary.path,child.TMPDIR);
  const cargo=join(root,'private-cargo');
  const withCargo=testEnvironment({CARGO_HOME:cargo},parent),cargoContext=JSON.parse(withCargo[ENVIRONMENT_CONTEXT]!);
  assert.equal(cargoContext.owned.CARGO_HOME,cargo);
  assert.equal(context.owned.GIT_CONFIG_COUNT,'2');assert.equal(context.owned.GIT_CONFIG_KEY_0,'maintenance.auto');
  assert.equal(gateEnvironment(child,{run:join(child.TMPDIR!,'git-child')}).env.GIT_CONFIG_VALUE_1,'0');
  assert.equal(gateEnvironment(withCargo,{run:join(withCargo.TMPDIR!,'nested-run')}).env.CARGO_HOME,cargo);
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
    for(const name of ['GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0','GIT_CONFIG_KEY_1','GIT_CONFIG_VALUE_1'])assert.equal(actual[name],env[name],name);
  }
});

test('every absent fixture cache fails by name before its production resolver',()=>{
  const complete=testEnvironment();
  for(const name of CONTENT_CACHE_ENVIRONMENT){
    const partial={...complete};delete partial[name];let calls=0;
    const production=()=>{calls++;throw Error('production resolver must not run');};
    assert.throws(()=>cacheLocation(name,partial,production),{code:'NTS_FIXTURE_CACHE_MISSING',message:'fixture cache capability missing: '+name});
    assert.equal(calls,0,name);
    assert.equal(contentCacheEnvironment(partial)[name],undefined,'nesting must not restore '+name);
    if(name==='NODE_COMPILE_CACHE'){
      assert.throws(()=>ownedCacheEnvironment(partial,{temporary:'/does-not-exist'}),/fixture cache capability missing: NODE_COMPILE_CACHE/);
    }else{
      const nested=testEnvironment({},partial);assert.equal(nested[name],undefined,name);
      assert.equal(nested[FIXTURE_ENVIRONMENT],'1');
    }
    assert.equal(cacheLocation(name,complete,production),complete[name]);assert.equal(calls,0);
  }
  let calls=0;assert.equal(cacheLocation('example',{},()=>{calls++;return '/production/cache';}),'/production/cache');assert.equal(calls,1);
});
