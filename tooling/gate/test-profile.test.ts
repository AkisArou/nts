import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {assertTestArtifact,assertTestInvocation,assertTestProfileManifest,testInvocation,TEST_PROFILE_MANIFEST,TEST_ROUTES} from './test-profile.ts';
import {inspectCargoTestCalls,inspectShellCargoTests} from './test-profile-audit.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {newTestScratch} from './test-scratch.ts';

const manifest=readFileSync(TEST_PROFILE_MANIFEST,'utf8');
for(const route of TEST_ROUTES)test(route+' checks the actual invocation against profile and incremental mutations',()=>{
  const invocation=testInvocation(route,[],{});
  assert.equal(invocation.env.CARGO_INCREMENTAL,'1');
  assert.equal(invocation.env.NTS_CHECKERS,'1');
  assert.doesNotThrow(()=>assertTestInvocation(invocation));
  const removed=invocation.args.filter((arg,index,all)=>arg!=='--profile'&&all[index-1]!=='--profile');
  assert.throws(()=>assertTestInvocation({...invocation,args:removed}),/--profile nts-dev/);
  assert.throws(()=>assertTestInvocation({...invocation,args:invocation.args.map(arg=>arg==='nts-dev'?'release':arg)}),/--profile nts-dev/);
  assert.throws(()=>assertTestInvocation({...invocation,env:{...invocation.env,CARGO_INCREMENTAL:'0'}}),/CARGO_INCREMENTAL=1/);
  const artifact={reason:'compiler-artifact',filenames:[join(invocation.profileDirectory,'deps/private')],profile:{test:true,debuginfo:0}};
  assert.equal(assertTestArtifact(invocation,artifact),true);
  for(const wrong of ['debug','release'])assert.throws(()=>assertTestArtifact(invocation,{...artifact,filenames:[join(invocation.profileDirectory,'..',wrong,'deps/private')]}),/artifact outside/);
  assert.throws(()=>assertTestArtifact(invocation,{...artifact,profile:{test:true,debuginfo:2}}),/debug info/);
});

test('manifest and caller conflicts cannot silently select another build',()=>{
  assertTestProfileManifest(manifest);
  for(const [before,after] of [['debug = 0','debug = 2'],['incremental = true','incremental = false'],['lto = false','lto = true']]){
    assert.throws(()=>assertTestProfileManifest(manifest.replace(before!,after!)),/manifest nts-dev/);
  }
  for(const env of [{CARGO_INCREMENTAL:'0'},{NTS_TEST_PROFILE:'release'},{CARGO_PROFILE_NTS_DEV_DEBUG:'2'},{RUSTFLAGS:'-Cdebuginfo=2'}]){
    assert.throws(()=>testInvocation('workspace',[],env),/Rust test profile/);
  }
  for(const args of [['--release'],['--profile','release'],['--profile=release'],['--config','profile.nts-dev.incremental=false']]){
    assert.throws(()=>testInvocation('inner',args,{}),/Rust test profile/);
  }
});

for(const route of TEST_ROUTES)test(route+' executes Cargo through the owner with artifact evidence',t=>{
  const root=newTestScratch('test-profile-route');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bin=join(root,'bin'),capture=join(root,'capture.json');mkdirSync(bin);
  writeFileSync(join(root,'Cargo.toml'),'[workspace]\n'+manifest.split(/(?=^\[)/m).find(part=>part.startsWith('[profile.nts-dev]')));
  writeFileSync(join(bin,'cargo'),`#!${process.execPath}
const {durableRecord}=require(${JSON.stringify(new URL('./durable-record.ts',import.meta.url).pathname)});durableRecord(${JSON.stringify(capture)},{args:process.argv.slice(2),incremental:process.env.CARGO_INCREMENTAL,checkers:process.env.NTS_CHECKERS});
console.log(JSON.stringify({reason:'compiler-artifact',filenames:[${JSON.stringify(join(root,'target/nts-dev/deps/private'))}],profile:{test:true,debuginfo:0}}));
process.exit(7);
`,{mode:0o755});
  const result=spawnSync(process.execPath,[new URL('./test-profile.ts',import.meta.url).pathname,route],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),PATH:bin,NTS_TEST_PROFILE:undefined,CARGO_INCREMENTAL:undefined,CARGO_TARGET_DIR:join(root,'target')}});
  assert.equal(result.status,7,result.stdout+result.stderr);
  const actual=JSON.parse(readFileSync(capture,'utf8'));
  assert.deepEqual(actual,{args:testInvocation(route,[],{}).args,incremental:'1',checkers:'1'});
  rmSync(capture);
  const refused=spawnSync(process.execPath,[new URL('./test-profile.ts',import.meta.url).pathname,route],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),PATH:bin,CARGO_INCREMENTAL:'0'}});
  assert.equal(refused.status,2,refused.stdout+refused.stderr);
  assert.match(refused.stderr,/CARGO_INCREMENTAL=1/);
  assert.equal(existsSync(capture),false,'a conflict refuses before Cargo starts');
});

test('the source rule follows invocation values and wrappers, and parses shell commands',()=>{
  const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync'),api=new API();
  const inspect=(source:string)=>{const lease=api.createSourceFile('route.ts',source);try{return inspectCargoTestCalls('tooling/private.ts',source,lease.sourceFile);}finally{lease.dispose();}};
  try{
    for(const source of [
      'spawnSync("cargo", ["test", "--profile", "release"]);',
      'const args=["test"]; execFileSync("cargo",args);',
      'const tool="cargo"; spawn(tool,["test"]);',
      'function cargo(args){return spawnSync("cargo",args);} cargo(["test"]);',
    ])assert.ok(inspect(source).length,source);
    assert.deepEqual(inspect('const expected=["test"]; spawnSync("cargo",["metadata"]);'),[]);
    assert.equal(inspectShellCargoTests('tooling/private.sh','echo "cargo test"\n# cargo test\ncargo build\n').length,0);
    for(const source of ['cargo test --workspace','exec cargo test --workspace',"'cargo' 'test' --workspace"])
      assert.equal(inspectShellCargoTests('tooling/private.sh',source).length,1,source);
  }finally{api.close();}
});
