import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {cargoMetadata,cargoRuntimeTargets,cargoInputPaths} from './cargo-inputs.ts';
import {testScratch} from './test-scratch.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {spawnTest} from './test-wait.ts';
import {gitArguments} from './git-arguments/main.ts';
import {buildRustSelectorMaterial} from './rust-selector-build.ts';
import {ToolingInstrumentError} from './step-result.ts';
import {infrastructureProbes,INFRASTRUCTURE_PROBE_BOUND_MS} from './infrastructure-probe.ts';
import {readStepInstrument} from './step-result.ts';
import type {SpawnSyncOptionsWithStringEncoding} from 'node:child_process';

test('Cargo inventory detaches callers and refuses new file keys bound to old target rows',t=>{
  const root=testScratch(t,'cargo-input-generation'),env=fixtureEnvironment(t);mkdirSync(join(root,'src'));
  const manifest='[package]\nname="cargo-generation"\nversion="0.0.0"\nedition="2021"\n';
  writeFileSync(join(root,'Cargo.toml'),manifest);writeFileSync(join(root,'src/lib.rs'),'');
  for(const args of [['init','-q'],['add','.']]){const result=spawnTest('git',gitArguments(args),{cwd:root,env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
  const first=cargoMetadata(root),targets=cargoRuntimeTargets(root);assert.equal(targets.length,1);first.packages.length=0;
  assert.equal(cargoMetadata(root).packages.length,1,'caller mutation does not alter the captured inventory');
  const declarations={version:1 as const,targets:targets.map(target=>({target,declarations:{imports:[],assets:[]}}))};
  writeFileSync(join(root,'declarations.json'),JSON.stringify(declarations));
  writeFileSync(join(root,'Cargo.toml'),manifest+'\n[lib]\ntest=false\ndoctest=true\n');
  assert.throws(()=>cargoRuntimeTargets(root),/Cargo inventory inputs changed since acquisition/);
  assert.throws(()=>buildRustSelectorMaterial({sourceRoot:root,manifest:declarations,inventory:()=>cargoRuntimeTargets(root),declarations:'declarations.json',engine:['src/lib.rs'],cargoInputs:cargoInputPaths(root),tracked:()=>[{path:'src/lib.rs',mode:'100644'}]}),/Cargo inventory inputs changed since acquisition/);
});

test('the Cargo inventory keeps the shared configuration guard on fresh and reused answers',t=>{
  const root=testScratch(t,'cargo-input-configuration'),env=fixtureEnvironment(t);mkdirSync(join(root,'src'));
  writeFileSync(join(root,'Cargo.toml'),'[package]\nname="cargo-guarded-inventory"\nversion="0.0.0"\nedition="2021"\n');
  writeFileSync(join(root,'src/lib.rs'),'');
  for(const args of [['init','-q'],['add','.']])assert.equal(spawnTest('git',gitArguments(args),{cwd:root,env,encoding:'utf8'}).status,0);
  assert.equal(cargoMetadata(root,undefined,env).packages.length,1);
  const config=join(root,'.cargo','config.toml');mkdirSync(join(root,'.cargo'));writeFileSync(config,'[env]\nPOISON="1"\n');
  assert.throws(()=>cargoMetadata(root,undefined,env),error=>error instanceof ToolingInstrumentError&&error.message.includes(config));
  unlinkSync(config);assert.equal(cargoMetadata(root,undefined,env).packages.length,1);
  const failure=new ToolingInstrumentError('tooling-setup','supplied inventory instrument');
  assert.throws(()=>cargoMetadata(root,()=>{throw failure;},env),error=>error===failure,'typed setup cause is never reclassified as ordinary metadata failure');
});

test('Cargo metadata passes the infrastructure owner bound through its guarded default adapter',t=>{
  const root=testScratch(t,'cargo-input-probe-bound'),env=fixtureEnvironment(t,{NTS_GATE_STEP:'cargo-inventory-control',
    NTS_GATE_STEP_ATTEMPT:'private',NTS_GATE_STEP_RESULT:join(root,'instrument.json')});
  mkdirSync(join(root,'src'));writeFileSync(join(root,'Cargo.toml'),'[package]\nname="cargo-inventory-bound"\nversion="0.0.0"\nedition="2021"\n');
  writeFileSync(join(root,'src/lib.rs'),'');
  for(const args of [['init','-q'],['add','.']])assert.equal(spawnTest('git',gitArguments(args),{cwd:root,env,encoding:'utf8'}).status,0);
  const seen:{command:string;args:readonly string[];options:SpawnSyncOptionsWithStringEncoding}[]=[];
  const probe=infrastructureProbes((command,args,options)=>{
    seen.push({command,args,options});
    return {pid:0,output:[],stdout:'',stderr:'',status:null,signal:null,error:Object.assign(new Error('supplied metadata timeout'),{code:'ETIMEDOUT'})};
  });
  assert.throws(()=>cargoMetadata(root,undefined,env,probe),error=>error instanceof ToolingInstrumentError&&error.kind==='tooling-setup'
    &&error.message.includes('selector Cargo inventory')&&error.message.includes('wedged-probe bound'));
  assert.equal(seen.length,1);assert.equal(seen[0]!.command,'cargo');assert.deepEqual(seen[0]!.args,['metadata','--format-version','1','--offline']);
  assert.equal(seen[0]!.options.timeout,INFRASTRUCTURE_PROBE_BOUND_MS);assert.equal(seen[0]!.options.killSignal,'SIGKILL');
  assert.equal(seen[0]!.options.cwd,root);assert.equal(seen[0]!.options.env?.CARGO_HOME,env.CARGO_HOME);assert.equal(seen[0]!.options.env?.RUSTUP_HOME,env.RUSTUP_HOME);
  const receipt=readStepInstrument(env.NTS_GATE_STEP_RESULT!,'cargo-inventory-control','private');assert.ok(receipt);assert.equal(receipt.verdict,'INSTRUMENT');
  assert.equal(receipt.kind,'tooling-setup');assert.match(receipt.reason,/wedged-probe bound/);
});
