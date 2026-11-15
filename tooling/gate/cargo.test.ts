import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {chmodSync,existsSync,lstatSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {delimiter,dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {cargoConfiguration,cargoHome,cargoOutput,withCargoConfiguration,withCargoConfigurationSync,CARGO_OWNER} from './cargo.ts';
import {inspectCargoCalls,inspectShellCargoCalls} from './cargo-audit.ts';
import {inspectRustCargoCalls} from './rust-cargo.ts';
import {inspectCargoTestCalls} from './test-profile-audit.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {testScratch} from './test-scratch.ts';
import {ToolingInstrumentError,readStepInstrument} from './step-result.ts';

function privateTree(t:Parameters<typeof testScratch>[0]):{root:string;cwd:string;home:string;env:NodeJS.ProcessEnv}{
  const root=testScratch(t,'cargo-configuration'),cwd=join(root,'parent/tree'),home=join(root,'cargo-home');
  mkdirSync(cwd,{recursive:true});mkdirSync(home);
  return {root,cwd,home,env:fixtureEnvironment(t,{CARGO_HOME:home,NTS_GATE_STEP:'cargo-control',NTS_GATE_STEP_ATTEMPT:'private',NTS_GATE_STEP_RESULT:join(root,'instrument.json')})};
}
function refusal(error:unknown,path:string):boolean{
  assert.ok(error instanceof ToolingInstrumentError);assert.equal(error.kind,'tooling-setup');assert.ok(error.message.includes(path),error.message);return true;
}
for(const name of ['config','config.toml'])for(const place of ['home','parent','tree'])test(`${place} ${name} refuses before starting Cargo`,t=>{
  const {root,cwd,home,env}=privateTree(t),bin=join(root,'bin'),marker=join(root,'started');mkdirSync(bin);
  writeFileSync(join(bin,'cargo'),`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},'started');\n`,{mode:0o755});
  const directory=place==='home'?home:join(place==='tree'?cwd:dirname(cwd),'.cargo');mkdirSync(directory,{recursive:true});
  const path=join(directory,name);writeFileSync(path,'[env]\nNTS_AMBIENT_CARGO_PROBE="poison"\n');
  const ran=spawnSync(process.execPath,[CARGO_OWNER,'metadata','--offline'],{cwd,env:{...env,PATH:bin+delimiter+env.PATH},encoding:'utf8'});
  assert.notEqual(ran.status,0,ran.stdout+ran.stderr);assert.ok(ran.stderr.includes(path),ran.stderr);
  const receipt=readStepInstrument(env.NTS_GATE_STEP_RESULT!,'cargo-control','private');assert.ok(receipt);assert.equal(receipt.verdict,'INSTRUMENT');assert.equal(receipt.kind,'tooling-setup');assert.ok(receipt.reason.includes(path));
  assert.equal(existsSync(marker),false,'configuration refuses before the executable starts');
});
test('a configuration published by the child refuses only after its completed drain',t=>{
  const {root,cwd,home,env}=privateTree(t),bin=join(root,'bin'),marker=join(root,'completed'),config=join(home,'config.toml');mkdirSync(bin);
  writeFileSync(join(bin,'cargo'),`#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(config)},'[env]\\nNTS_AMBIENT_CARGO_PROBE="poison"\\n');fs.writeFileSync(${JSON.stringify(marker)},'completed');\n`,{mode:0o755});
  const ran=spawnSync(process.execPath,[CARGO_OWNER,'metadata'],{cwd,env:{...env,PATH:bin+delimiter+env.PATH},encoding:'utf8'});
  assert.equal(readFileSync(marker,'utf8'),'completed');assert.notEqual(ran.status,0,ran.stdout+ran.stderr);assert.ok(ran.stderr.includes(config),ran.stderr);
  const receipt=readStepInstrument(env.NTS_GATE_STEP_RESULT!,'cargo-control','private');assert.ok(receipt);assert.equal(receipt.verdict,'INSTRUMENT');assert.equal(receipt.kind,'tooling-setup');assert.ok(receipt.reason.includes(config));
});
test('body and final-observation failures preserve both causes and the configuration path',t=>{
  const {cwd,home,env}=privateTree(t),config=join(home,'config'),primary=Error('primary Cargo control');
  assert.throws(()=>withCargoConfigurationSync([cwd],env,()=>{writeFileSync(config,'');throw primary;}),error=>{
    refusal(error,config);assert.ok(error instanceof Error);assert.ok(error.cause instanceof AggregateError);
    assert.equal(error.cause.errors[0],primary);assert.ok(error.message.includes(primary.message));return true;
  });
});
test('an awaited historical lifetime verifies after its finalizer and preserves both failures',async t=>{
  const {cwd,home,env}=privateTree(t),config=join(home,'config.toml'),primary=Error('historical operation failed');let drained=false;
  await assert.rejects(withCargoConfiguration([cwd],env,async()=>{
    try{await Promise.resolve();throw primary;}
    finally{await Promise.resolve();writeFileSync(config,'');drained=true;}
  }),error=>{
    assert.equal(drained,true);refusal(error,config);assert.ok(error instanceof Error);assert.ok(error.cause instanceof AggregateError);
    assert.equal(error.cause.errors[0],primary);return true;
  });
});
test('physical aliases and unreadable discovery directories never certify absence',t=>{
  const {root,cwd,home,env}=privateTree(t),alias=join(root,'alias'),config=join(dirname(cwd),'.cargo/config.toml');
  symlinkSync(cwd,alias,'dir');mkdirSync(dirname(config));writeFileSync(config,'');
  assert.throws(()=>cargoConfiguration([alias],env),error=>refusal(error,config));rmSync(config);
  const directory=join(cwd,'.cargo');mkdirSync(directory);chmodSync(directory,0);
  try{assert.throws(()=>cargoConfiguration([cwd],env),error=>refusal(error,join(directory,'config')));}
  finally{chmodSync(directory,0o700);}
  assert.equal(cargoHome(env),home);
});
test('a supplied scratch working directory stays guarded until its consumer drains',t=>{
  const {root,cwd,env}=privateTree(t),scratch=join(root,'native-scratch'),config=join(scratch,'.cargo/config.toml');mkdirSync(scratch);
  const guard=cargoConfiguration([cwd,scratch],env);mkdirSync(dirname(config));writeFileSync(config,'');
  assert.throws(()=>guard.verify(),error=>refusal(error,config));
});
test('Cargo receives the same complete cache root and cannot override configuration or cwd',t=>{
  const {cwd,home,env}=privateTree(t);let calls=0;
  const execute=((command:string,args:readonly string[],options:{env:NodeJS.ProcessEnv})=>{
    calls++;assert.equal(command,'cargo');assert.deepEqual(args,['metadata']);assert.equal(options.env.CARGO_HOME,home);return 'same-cache';
  }) as typeof import('node:child_process').execFileSync;
  assert.equal(cargoOutput(['metadata'],{cwd,env,encoding:'utf8'},execute),'same-cache');
  for(const args of [['--config','env.PROBE="poison"'],['--config=build.rustflags=["poison"]'],['-C',cwd],['-C'+cwd],['+nightly','metadata']]){
    assert.throws(()=>cargoOutput(args,{cwd,env,encoding:'utf8'},execute),ToolingInstrumentError);
  }
  assert.equal(calls,1);
  assert.throws(()=>cargoHome({NTS_TEST_ENVIRONMENT:'1'}),ToolingInstrumentError);
});
test('the incoming rustup environment cannot override the source toolchain',t=>{
  const {cwd,env}=privateTree(t);
  assert.throws(()=>cargoConfiguration([cwd],{...env,RUSTUP_TOOLCHAIN:'nightly'}),error=>refusal(error,'RUSTUP_TOOLCHAIN'));
});
test('rustup itself parses directory overrides before and after the guarded call',t=>{
  const {root,cwd,env}=privateTree(t),home=join(root,'rustup'),settings=join(home,'settings.toml');mkdirSync(home);
  const owned={...env,RUSTUP_HOME:home};
  const put=(path:string)=>writeFileSync(settings,'version = "12"\n\n[overrides]\n'+JSON.stringify(path)+' = "nightly"\n');
  const guard=cargoConfiguration([cwd],owned);
  put(dirname(cwd));assert.throws(()=>guard.verify(),error=>refusal(error,settings));
  assert.throws(()=>cargoConfiguration([cwd],owned),error=>refusal(error,settings));
  put(join(root,'unrelated'));assert.doesNotThrow(()=>cargoConfiguration([cwd],owned));
});
test('an unavailable rustup or unrecognized override output refuses by name',t=>{
  const {root,cwd,env}=privateTree(t),bin=join(root,'bin');mkdirSync(bin);
  assert.throws(()=>cargoConfiguration([cwd],{...env,PATH:bin}),error=>refusal(error,'settings.toml'));
  writeFileSync(join(bin,'rustup'),`#!${process.execPath}\nprocess.stdout.write('unrecognized override output\\n');\n`,{mode:0o755});
  assert.throws(()=>cargoConfiguration([cwd],{...env,PATH:bin}),error=>refusal(error,'unrecognized rustup override list row'));
});
test('the real test-profile clean arm uses the shared registry offline without relocating it',t=>{
  const root=testScratch(t,'cargo-real-profile'),tree=join(root,'tree');copyModuleClosure(['tooling/gate/test-profile.ts'],tree);mkdirSync(join(tree,'src'));
  const profile=readFileSync(new URL('../../Cargo.toml',import.meta.url),'utf8').split(/(?=^\[)/m).find(part=>part.startsWith('[profile.nts-dev]'))!;
  const lock=readFileSync(new URL('../../Cargo.lock',import.meta.url),'utf8'),version=/\[\[package\]\]\nname = "memchr"\nversion = "([^"]+)"/.exec(lock)?.[1];assert.ok(version);
  writeFileSync(join(tree,'Cargo.toml'),'[package]\nname="cargo-isolation-control"\nversion="0.0.0"\nedition="2024"\n[dependencies]\nmemchr="='+version+'"\n'+profile);
  writeFileSync(join(tree,'src/lib.rs'),'#[test] fn no_ambient_configuration() { assert!(option_env!("NTS_AMBIENT_CARGO_PROBE").is_none()); assert_eq!(memchr::memchr(b\'x\', b"xyz"), Some(0)); }\n');
  const env=fixtureEnvironment(t,{CARGO_TARGET_DIR:join(tree,'target'),CARGO_INCREMENTAL:undefined}),home=cargoHome(env),registry=join(home,'registry');
  const identity=(path:string)=>{const stat=lstatSync(path);return [stat.dev,stat.ino];},before=[identity(home),identity(registry)];
  const ran=spawnSync(process.execPath,[join(tree,'tooling/gate/test-profile.ts'),'workspace','--offline'],{cwd:tree,env,encoding:'utf8'});
  assert.equal(ran.status,0,ran.stdout+ran.stderr);assert.match(ran.stdout,/1 passed; 0 failed/);
  assert.deepEqual([identity(home),identity(registry)],before);assert.equal(existsSync(join(tree,'.cargo')),false);
});
test('the source audits reject raw Cargo, guarded test-profile bypasses and unknown Rust cwd roots',()=>{
  const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync'),api=new API();
  const inspect=(source:string,tests=false)=>{const lease=api.createSourceFile('private.ts',source);try{return tests?inspectCargoTestCalls('tooling/private.ts',source,lease.sourceFile):inspectCargoCalls('tooling/private.ts',source,lease.sourceFile);}finally{lease.dispose();}};
  try{
    for(const source of ['import {spawnSync as launch} from "node:child_process";launch("cargo",["metadata"]);','import {execFileSync} from "node:child_process";const command="cargo";execFileSync(command,["build"]);','spawnSync(protocol??"cargo",[]);'])assert.equal(inspect(source).length,1,source);
    assert.equal(inspect('import {cargoSync} from "./gate/cargo.ts";cargoSync(["metadata"]);').length,0);
    assert.equal(inspect('import {cargoSync} from "./gate/cargo.ts";cargoSync(["test"]);',true).length,1);
    assert.equal(inspectShellCargoCalls('tooling/private.sh','cargo build --release').length,1);
    assert.equal(inspectShellCargoCalls('tooling/private.sh','node tooling/gate/cargo.ts build --release').length,0);
    const source=readFileSync(new URL('../../compiler/frontend-ts/tests/frontend_stamp.rs',import.meta.url),'utf8');
    assert.deepEqual(inspectRustCargoCalls('frontend_stamp.rs',source,'/repo/compiler/frontend-ts','/repo'),[]);
    assert.equal(inspectRustCargoCalls('frontend_stamp.rs',source.replace('.current_dir(&root)','.current_dir("/unknown")'),'/repo/compiler/frontend-ts','/repo').length,1);
    assert.equal(inspectRustCargoCalls('private.rs','fn test() { let cargo = env!("CARGO"); }','/repo/compiler/core','/repo').length,1);
  }finally{api.close();}
});
