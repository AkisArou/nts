import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';
import {setupOracleTestEnvironment,oracleTestEnvironment} from '../differential/oracle-test-fixture.ts';
import {spawnSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {assertTestArtifact,assertTestInvocation,assertTestProfileManifest,assertPreparedInnerTests,testInvocation,TEST_PROFILE_MANIFEST,TEST_ROUTES} from './test-profile.ts';
import {inspectCargoTestCalls,inspectShellCargoTests} from './test-profile-audit.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {newTestScratch} from './test-scratch.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {moduleClosure} from './module-closure.ts';
import {inspectRecordPublications} from './test-readiness.ts';

const manifest=readFileSync(TEST_PROFILE_MANIFEST,'utf8');
test('the run seal verifier is a node-only leaf, so test entries cannot inherit launcher selection',()=>{
  assert.deepEqual(moduleClosure(['tooling/differential/oracle-seal/main.ts']),['tooling/differential/oracle-seal/main.ts']);
  const config=new OracleFilesystem().projectFor(fileURLToPath(new URL('../differential/oracle-seal/main.ts',import.meta.url)));
  assert.equal(config,fileURLToPath(new URL('../differential/oracle-seal/tsconfig.json',import.meta.url)));
  const project=JSON.parse(readFileSync(config,'utf8'));
  assert.deepEqual(project.files,['main.ts']);assert.deepEqual(project.include,[]);
});
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
  const selection=route==='inner'?['--no-run']:[];
  const root=newTestScratch('test-profile-route');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bin=join(root,'bin'),capture=join(root,'capture.json');mkdirSync(bin);
  writeFileSync(join(root,'Cargo.toml'),'[workspace]\n'+manifest.split(/(?=^\[)/m).find(part=>part.startsWith('[profile.nts-dev]')));
  writeFileSync(join(bin,'cargo'),`#!${process.execPath}
const {durableRecord}=require(${JSON.stringify(new URL('./durable-record.ts',import.meta.url).pathname)});durableRecord(${JSON.stringify(capture)},{args:process.argv.slice(2),incremental:process.env.CARGO_INCREMENTAL,checkers:process.env.NTS_CHECKERS});
console.log(JSON.stringify({reason:'compiler-artifact',filenames:[${JSON.stringify(join(root,'target/nts-dev/deps/private'))}],profile:{test:true,debuginfo:0}}));
process.exit(7);
`,{mode:0o755});
  const result=spawnSync(process.execPath,[new URL('./test-profile.ts',import.meta.url).pathname,route,...selection],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),PATH:bin,NTS_TEST_PROFILE:undefined,CARGO_INCREMENTAL:undefined,CARGO_TARGET_DIR:join(root,'target')}});
  assert.equal(result.status,7,result.stdout+result.stderr);
  const actual=JSON.parse(readFileSync(capture,'utf8'));
  assert.deepEqual(actual,{args:testInvocation(route,selection,{}).args,incremental:'1',checkers:'1'});
  rmSync(capture);
  const refused=spawnSync(process.execPath,[new URL('./test-profile.ts',import.meta.url).pathname,route],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),PATH:bin,CARGO_INCREMENTAL:'0'}});
  assert.equal(refused.status,2,refused.stdout+refused.stderr);
  assert.match(refused.stderr,/CARGO_INCREMENTAL=1/);
  assert.equal(existsSync(capture),false,'a conflict refuses before Cargo starts');
  writeFileSync(join(bin,'cargo'),`#!${process.execPath}\nprocess.exit(0);\n`,{mode:0o755});
  const empty=spawnSync(process.execPath,[new URL('./test-profile.ts',import.meta.url).pathname,route,...selection],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),PATH:bin,CARGO_INCREMENTAL:undefined}});
  assert.equal(empty.status,2,empty.stdout+empty.stderr);
  assert.match(empty.stderr,/produced no compiler-artifact evidence/);
});

test('the actual frontend shell entry reaches the shared Cargo owner',t=>{
  const root=newTestScratch('frontend-test-profile');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const tree=join(root,'tree'),bin=join(root,'bin'),capture=join(root,'capture.json');
  copyModuleClosure(['tooling/gate/test-profile.ts'],tree);
  copyFileSync(new URL('./all.sh',import.meta.url),join(tree,'tooling/gate/all.sh'));
  mkdirSync(bin);mkdirSync(join(tree,'compiler/frontend-tsrs'),{recursive:true});
  writeFileSync(join(tree,'compiler/frontend-tsrs/vendor.ts'),'// private vendor input control\n');
  writeFileSync(join(tree,'compiler/frontend-tsrs/private.test.ts'),"import {test} from 'node:test';test('private vendor test',()=>{});\n");
  writeFileSync(join(bin,'cargo'),`#!${process.execPath}
const {durableRecord}=require(${JSON.stringify(new URL('./durable-record.ts',import.meta.url).pathname)});durableRecord(${JSON.stringify(capture)},{args:process.argv.slice(2),incremental:process.env.CARGO_INCREMENTAL});
console.log(JSON.stringify({reason:'compiler-artifact',filenames:[${JSON.stringify(join(tree,'target/nts-dev/deps/private'))}],profile:{test:true,debuginfo:0}}));process.exit(7);
`,{mode:0o755});
  const ran=spawnSync('sh',[join(tree,'tooling/gate/all.sh'),'--call','frontend-tsrs'],{cwd:tree,encoding:'utf8',env:{...fixtureEnvironment(t),PATH:[bin,dirname(process.execPath),'/usr/bin'].join(':'),CARGO_INCREMENTAL:undefined,NTS_JOBS:undefined,CARGO_TARGET_DIR:join(tree,'target')}});
  assert.equal(ran.status,7,ran.stdout+ran.stderr);
  assert.deepEqual(JSON.parse(readFileSync(capture,'utf8')),{args:testInvocation('frontend',[],{}).args,incremental:'1'});
});

test('real Cargo artifact reports end before a test can print its own JSON',t=>{
  const root=newTestScratch('test-profile-json-output');t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'src'));
  const profile=manifest.split(/(?=^\[)/m).find(part=>part.startsWith('[profile.nts-dev]'));
  writeFileSync(join(root,'Cargo.toml'),'[package]\nname="profile-output"\nversion="0.0.0"\nedition="2024"\n'+profile);
  const output='{"reason":"compiler-artifact","filenames":["/subject-output"],"profile":{"debuginfo":2}}';
  writeFileSync(join(root,'src/lib.rs'),'#[test] fn prints_json() { println!("\\n{}", r#"'+output+'"#); }\n');
  const ran=spawnSync(process.execPath,[new URL('./test-profile.ts',import.meta.url).pathname,'workspace','--','--nocapture'],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),CARGO_TARGET_DIR:join(root,'target'),CARGO_BUILD_JOBS:'1',CARGO_INCREMENTAL:undefined,NTS_TEST_PROFILE:undefined}});
  assert.equal(ran.status,0,ran.stdout+ran.stderr);
  assert.ok(ran.stdout.includes(output),ran.stdout);
  assert.equal(existsSync(join(root,'target/debug')),false);
});

test('an unprepared inner differential invocation names its setup before Cargo or disk admission',t=>{
  const root=newTestScratch('unprepared-inner');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bin=join(root,'bin'),capture=join(root,'cargo.json');mkdirSync(bin);
  writeFileSync(join(bin,'cargo'),`#!${process.execPath}\nconst {durableRecord}=require(${JSON.stringify(new URL('./durable-record.ts',import.meta.url).pathname)});durableRecord(${JSON.stringify(capture)},{started:true});\n`,{mode:0o755});
  const ran=spawnSync(process.execPath,[new URL('./test-profile.ts',import.meta.url).pathname,'inner','-p','nts-differential'],{
    cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),PATH:bin,NTS_GATE_ENV_CONTEXT:undefined,NTS_ORACLE_DEPENDENCIES:undefined,NTS_BIN:undefined},
  });
  assert.equal(ran.status,2,ran.stdout+ran.stderr);
  assert.match(ran.stderr,/NOT MEASURED.*inner tests need prepared NTS_GATE_ENV_CONTEXT, NTS_ORACLE_DEPENDENCIES, NTS_BIN/);
  assert.match(ran.stderr,/node tooling\/gate\/inner\.ts --no-agree/);
  assert.equal(existsSync(capture),false,'preparation refuses before invoking Cargo');
});

test('an inner run accepts its complete seal and requires the executable in its selected profile',async t=>{
  await setupOracleTestEnvironment();
  const root=newTestScratch('prepared-inner');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const target=join(root,'target'),compiler=join(target,'nts-dev/nts');mkdirSync(dirname(compiler),{recursive:true});
  writeFileSync(compiler,'#!/bin/sh\nexit 0\n',{mode:0o755});
  const env={...oracleTestEnvironment(t),NTS_BIN:compiler,CARGO_TARGET_DIR:target};
  const invocation=testInvocation('inner',[],env,root);
  assert.doesNotThrow(()=>assertPreparedInnerTests(invocation));
  assert.throws(()=>assertPreparedInnerTests({...invocation,env:{...env,NTS_BIN:join(root,'other-nts')}}),/inner NTS_BIN must name the compiler built by node tooling\/gate\/inner\.ts --no-agree/);
  rmSync(compiler);
  assert.throws(()=>assertPreparedInnerTests(invocation),/inner NTS_BIN is unavailable/);
});

test('compile-only inner builds do not need runtime preparation and a test filter cannot pretend to be no-run',()=>{
  assert.doesNotThrow(()=>assertPreparedInnerTests(testInvocation('inner',['--no-run'],{})));
  assert.throws(()=>assertPreparedInnerTests(testInvocation('inner',['--','--no-run'],{})),/inner tests need prepared/);
  assert.throws(()=>assertPreparedInnerTests(testInvocation('inner',[],{NTS_GATE_ENV_CONTEXT:'{}',NTS_ORACLE_DEPENDENCIES:'{}',NTS_BIN:'/missing'})),/sealed oracle capability.*inner\.ts --no-agree/);
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
      'const args=["test"]; { const args=["metadata"]; spawnSync("cargo",args); } spawnSync("cargo",args);',
      'spawnSync("cargo",[...args]);',
    ])assert.ok(inspect(source).length,source);
    assert.deepEqual(inspect('const expected=["test"]; spawnSync("cargo",["metadata"]);'),[]);
    assert.equal(inspectShellCargoTests('tooling/private.sh','echo "cargo test"\n# cargo test\ncargo build\n').length,0);
    for(const source of ['cargo test --workspace','exec cargo test --workspace',"'cargo' 'test' --workspace"])
      assert.equal(inspectShellCargoTests('tooling/private.sh',source).length,1,source);
    const generated:string[]=[];
    inspectRecordPublications('tooling/private.test.ts','import {writeFileSync} from "node:fs"; writeFileSync("launcher.cjs", `const cp=require("node:child_process"); cp.spawnSync("cargo", ["test"]);`);',api,undefined,
      (text,tree)=>{generated.push(...inspectCargoTestCalls("tooling/private.test.ts",text,tree));});
    assert.equal(generated.length,1,'a generated launcher cannot bypass the invocation owner');
  }finally{api.close();}
});
