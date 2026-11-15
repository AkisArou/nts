import {gitArguments} from "../gate/git-arguments/main.ts";
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {testEnvironment,fixtureEnvironment} from "../gate/test-environment.ts";
import * as dependencyOwner from './oracle-dependencies.ts';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {chmodSync,cpSync,copyFileSync,existsSync,readdirSync,renameSync,linkSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,rmSync,utimesSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {before,test} from 'node:test';
import {setupOracleTestEnvironment} from './oracle-test-fixture.ts';
import {dependencyCapability,captureDependencies,dependencyPackageInventory,dependencyInventory,protectDependencyImage,dependencyCleanupFailure,CaseBudgetError,ToolingInstrumentError} from './oracle-dependencies.ts';
import {ownMemory,useOwnMemory} from '../gate/test-memory.ts';
import {DiskCapacity} from '../gate/disk-capacity.ts';
import {waitFor} from '../gate/test-wait.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {prepareChildObserver,observedSpawnSync,type ChildUsage} from '../gate/child-rusage.ts';
import {fileInput} from '../gate/reader-inputs/main.ts';

const key=(root:string)=>createHash('sha256').update(JSON.stringify(dependencyPackageInventory(dependencyInventory(root)))).digest('hex');
before(setupOracleTestEnvironment);
test('producer fixture direct entry refuses a real source before any gate write',t=>{
  const own=testScratch(t,'producer-direct-entry-refusal'),gate=fileInput(new URL('../gate/all.sh',import.meta.url)),before=readFileSync(gate);
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./oracle-reservation-fixture.ts',import.meta.url)),'--owned-producer',own],
    {env:testEnvironment(),encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/producer fixture source must be its acquired staged tree/);
  assert.deepEqual(readFileSync(gate),before);assert.equal(existsSync(join(own,'home')),false);
});
test('owned producer fixture retains cold/hit accounting and prepares before a zero-memory consumer',t=>{
  const own=testScratch(t,'producer-fixture-accounting'),env=testEnvironment(),prepared=prepareChildObserver(own,env);assert.ok(prepared.observer,prepared.error);
  let usage:ChildUsage|undefined;
  const result=observedSpawnSync(process.execPath,[fileURLToPath(new URL('./oracle-reservation-fixture.ts',import.meta.url))],
    {env,encoding:'utf8',maxBuffer:16*2**20},prepared.observer,value=>{usage=value;});
  t.diagnostic(JSON.stringify({kind:'producer-fixture-cost',basis:'wait4 of the complete fixture and waited descendants',usage}));
  assert.ok(usage,'the real fixture retains waited wall and CPU');
  assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.signal,null);
  const rows=result.stdout.trim().split('\n').map(line=>JSON.parse(line) as {counts?:number[];modes?:string[];step?:string;zeroMemoryConsumed?:boolean;producerSource:string});
  assert.ok(rows.some(row=>JSON.stringify(row.counts)==='[1,2,2]'&&JSON.stringify(row.modes)==='["cold","hit"]'));
  assert.ok(rows.some(row=>row.step==='PASS'&&row.zeroMemoryConsumed===true));
  assert.ok(rows.every(row=>row.producerSource!==resolve(fileURLToPath(new URL('../..',import.meta.url)))),'the installer executes from its fixture source');
});
test('dependency cleanup preserves the original budget or instrument classification and both causes',()=>{
  const cleanup=Error('release refused'),budget=new CaseBudgetError('actual preparation budget'),instrument=new ToolingInstrumentError('tooling-setup','actual missing observation');
  for(const primary of [budget,instrument]){
    const combined=dependencyCleanupFailure({error:primary},cleanup);
    assert.equal(combined.constructor,primary.constructor);
    if(combined instanceof ToolingInstrumentError)assert.equal(combined.kind,instrument.kind);
    assert.ok(combined.cause instanceof AggregateError);assert.deepEqual(combined.cause.errors,[primary,cleanup]);
    assert.match(combined.message,/actual/);assert.match(combined.message,/release refused/);
  }
  const afterReady=dependencyCleanupFailure(undefined,cleanup);assert.ok(afterReady instanceof ToolingInstrumentError);assert.equal(afterReady.kind,'tooling-cleanup');
});
test('dependency protection rejects external inodes before any chmod and private copies leave the origin unchanged',t=>{
  const root=mkdtempSync(join(tmpdir(),'oracle-dependency-inodes-')),image=join(root,'image');mkdirSync(image);
  t.after(()=>{chmodSync(image,0o755);rmSync(root,{recursive:true,force:true});});
  const origin=join(root,'origin'),privateFile=join(image,'a-private'),linked=join(image,'z-shared');
  writeFileSync(origin,'origin bytes',{mode:0o644});chmodSync(origin,0o644);
  writeFileSync(privateFile,'private bytes',{mode:0o644});chmodSync(privateFile,0o644);linkSync(origin,linked);
  const before=lstatSync(origin),bytes=readFileSync(origin);
  assert.throws(()=>protectDependencyImage(image),/shares a regular-file inode: z-shared/);
  assert.equal(lstatSync(privateFile).mode&0o777,0o644,'the complete inode preflight precedes all permission changes');
  assert.equal(lstatSync(origin).mode,before.mode);assert.equal(lstatSync(origin).ino,before.ino);assert.deepEqual(readFileSync(origin),bytes);
  rmSync(linked);copyFileSync(origin,linked);
  assert.notEqual(lstatSync(linked).ino,before.ino);assert.equal(lstatSync(linked).nlink,1);
  const inventory=protectDependencyImage(image);
  assert.deepEqual(inventory,dependencyInventory(image));assert.equal(lstatSync(linked).mode&0o777,0o444);
  assert.equal(lstatSync(origin).mode,before.mode);assert.equal(lstatSync(origin).ino,before.ino);assert.deepEqual(readFileSync(origin),bytes);
});

test('complete package inventories are stable across scratch roots and cover a Node-probed missing index',t=>{
  const roots=[0,1].map(()=>mkdtempSync(join(tmpdir(),'oracle-dependency-key-'))) as [string,string];
  t.after(()=>roots.forEach(root=>rmSync(root,{recursive:true,force:true})));
  for(const [index,root] of roots.entries()){
    for(const [path,body] of Object.entries({
      'node_modules/pkg/package.json':'{"name":"pkg","version":"1.0.0"}',
      'node_modules/.bin/shim':'#!/bin/sh\nNODE_PATH='+root,
      'node_modules/.modules.yaml':'prunedAt: '+index,
      'node_modules/.pnpm-workspace-state-v1.json':JSON.stringify({lastValidatedTimestamp:index}),
    })){
      const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,body);
    }
  }
  const before=key(roots[0]);assert.equal(before,key(roots[1]));
  const probe=(root:string)=>spawnSync(process.execPath,['--input-type=commonjs','-e',"try{console.log(require('pkg'))}catch(error){console.log(error.code)}"],{env:fixtureEnvironment(t),cwd:root,encoding:'utf8'});
  const missing=probe(roots[0]);assert.equal(missing.status,0,missing.stderr);assert.equal(missing.stdout,'MODULE_NOT_FOUND\n');
  writeFileSync(join(roots[0],'node_modules/pkg/index.js'),'module.exports=19;\n');
  const appeared=probe(roots[0]);assert.equal(appeared.status,0,appeared.stderr);assert.equal(appeared.stdout,'19\n');
  assert.notEqual(key(roots[0]),before,'the actual Node-probed package member changes the semantic key');
  assert.notEqual(key(roots[0]),key(roots[1]));
});

function installFixture(t:import('node:test').TestContext){
  const parent=mkdtempSync(join(tmpdir(),'oracle-install-inputs-')),root=join(parent,'source');mkdirSync(root);
  const memory=ownMemory(join(parent,'memory'));
  const before=new Map([...Object.keys(memory),'NTS_MEMORY_RESERVATION','NTS_MEMORY_PRIORITY'].map(name=>[name,process.env[name]]));
  useOwnMemory(join(parent,'memory'));
  const writable=(path:string)=>{const info=lstatSync(path);if(info.isDirectory()){chmodSync(path,0o755);for(const name of readdirSync(path))writable(join(path,name));}};
  t.after(()=>{
    for(const [name,value] of before){if(value===undefined)delete process.env[name];else process.env[name]=value;}
    writable(parent);rmSync(parent,{recursive:true,force:true});
  });
  cpSync(join(fileURLToPath(new URL('../../',import.meta.url)),'tooling'),join(root,'tooling'),{recursive:true});
  copyModuleClosure(['tooling/differential/oracle-dependencies.ts'],root);
  const write=(path:string,text:string)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);};
  const git=(...args:string[])=>execFileSync('git',gitArguments(['-c','user.name=nts fixture','-c','user.email=fixture@invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null',...args]),{env:fixtureEnvironment(t),cwd:root,encoding:'utf8'}).trim();
  write('package.json',JSON.stringify({private:true,type:'module',packageManager:JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json',import.meta.url)),'utf8')).packageManager}));
  write('pnpm-workspace.yaml','packages:\n  - packages/*\n');
  write('pnpm-lock.yaml',"lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .: {}\n\n  packages/one: {}\n");
  write('.gitignore','node_modules/\n');write('packages/one/package.json','{"name":"owned-one","version":"1.0.0"}\n');write('packages/one/index.js','module.exports=19;\n');
  write('docs/outside.md','outside input control\n');git('init','--quiet');git('add','--','.');git('commit','--quiet','-m','Bind install input fixture');
  const parentCapability=JSON.parse(process.env.NTS_ORACLE_DEPENDENCIES!),admission=parentCapability.admission;
  const cap=(name:string)=>dependencyCapability(root,join(parent,'capture-'+name,'tmp','dependencies'),admission,parentCapability.ownerStep??null);
  return {root,parent,write,git,cap};
}

test('committing an unrelated file preserves an existing dependency image',async t=>{
  const f=installFixture(t),cap=f.cap('one'),ready=await captureDependencies(cap),before=readFileSync(join(dirname(ready),'semantic.json'));
  f.write('docs/outside.md','committed outside-only change\n');f.git('add','--','docs/outside.md');f.git('commit','--quiet','-m','Change only outside install inputs');
  assert.equal(await captureDependencies(cap),ready);
  assert.deepEqual(readFileSync(join(dirname(ready),'semantic.json')),before);
});
test('the shared inventory leaf is sealed by the dependency producer identity and invalidates an old image',async t=>{
  const f=installFixture(t),original=f.cap('inventory-before'),ready=await captureDependencies(original);
  const before=JSON.parse(readFileSync(join(dirname(ready),'semantic.json'),'utf8'));
  const leaf='tooling/inputs/dependency-inventory.ts';
  f.write(leaf,readFileSync(join(f.root,leaf),'utf8')+'\n// private inventory identity control\n');
  f.git('add','--',leaf);f.git('commit','--quiet','-m','Change the shared inventory implementation');
  const changed=f.cap('inventory-after');assert.notEqual(changed.producerSha256,original.producerSha256);
  await assert.rejects(captureDependencies(original),/dependency producer source changed/);
  const after=JSON.parse(readFileSync(join(dirname(await captureDependencies(changed)),'semantic.json'),'utf8'));
  assert.equal(before.producerSha256,original.producerSha256);assert.equal(after.producerSha256,changed.producerSha256);
  assert.notEqual(after.producerSha256,before.producerSha256);
});
test('committing a workspace manifest invalidates its install input identity',async t=>{
  const f=installFixture(t),cap=f.cap('one'),ready=await captureDependencies(cap),before=readFileSync(join(dirname(ready),'semantic.json'));
  f.write('packages/one/package.json','{"name":"owned-one","version":"1.0.1"}\n');f.git('add','--','packages/one/package.json');f.git('commit','--quiet','-m','Change a real workspace manifest');
  await assert.rejects(captureDependencies(cap),/input|captured clean tree/);
  const next=await captureDependencies(f.cap('two'));assert.notDeepEqual(readFileSync(join(dirname(next),'semantic.json')),before);
});
test('an unrelated dirty file does not block dependency capture reuse',async t=>{
  const f=installFixture(t),cap=f.cap('one'),ready=await captureDependencies(cap),before=readFileSync(join(dirname(ready),'semantic.json'));
  f.write('docs/outside.md','dirty outside-only change\n');
  assert.equal(await captureDependencies(cap),ready);assert.deepEqual(readFileSync(join(dirname(ready),'semantic.json')),before);
});
test('a completed cold capture publishes its claim receipt and releases disk after drain',async t=>{
  const f=installFixture(t),cap=f.cap('disk-lifetime'),env=canonicalFixture(cap),capacity=new DiskCapacity({env});
  const ready=await captureDependencies(cap,undefined,env);
  const receipt=JSON.parse(readFileSync(join(dirname(ready),'admission.json'),'utf8'));
  assert.equal(receipt.admitted,true);assert.equal(receipt.claim.bytes,2**30);assert.equal(receipt.claim.pid,process.pid);
  assert.equal(capacity.snapshot(f.parent).temporaryReservedBytes,0);
  assert.equal(await captureDependencies(cap,undefined,env),ready,'a ready hit needs no second claim');
  assert.equal(capacity.snapshot(f.parent).temporaryReservedBytes,0);
});
test('a real failed producer drains before its temporary claim is released',async t=>{
  const f=installFixture(t);
  f.write('packages/one/package.json','{"name":"owned-one","version":"1.0.0","dependencies":{"nts-missing-disk-control":"0.0.0"}}\n');
  f.git('add','packages/one/package.json');f.git('commit','-qm','Make the real frozen install fail');
  const cap=f.cap('failed-disk-lifetime'),env=canonicalFixture(cap),capacity=new DiskCapacity({env}),directory=join(cap.directory,'node-'+process.versions.node);
  await assert.rejects(captureDependencies(cap,undefined,env),/capture not measured|install|lockfile/);
  const receipt=JSON.parse(readFileSync(join(directory,'admission.json'),'utf8'));assert.equal(receipt.admitted,true);assert.ok(receipt.claim.id);
  const command=JSON.parse(readFileSync(join(directory,'command.json'),'utf8'));assert.ok(Number.isInteger(command.status)&&command.status!==0);
  assert.ok(readFileSync(join(directory,'failed.json'),'utf8').includes('tooling-setup'));
  assert.equal(capacity.snapshot(f.parent).temporaryReservedBytes,0);
});
for(const failedProducer of [false,true])test((failedProducer?'failed producer':'published ready')+' plus refused disk release retains both lifetime facts',async t=>{
  const f=installFixture(t);
  if(failedProducer){
    f.write('packages/one/package.json','{"name":"owned-one","version":"1.0.0","dependencies":{"nts-missing-disk-control":"0.0.0"}}\n');
    f.git('add','packages/one/package.json');f.git('commit','-qm','Make the real frozen install fail');
  }
  const cap=f.cap('refused-release'),env=canonicalFixture(cap),capacity=new DiskCapacity({env}),directory=join(cap.directory,'node-'+process.versions.node);
  const original=DiskCapacity.prototype.tryTemporary;
  t.mock.method(DiskCapacity.prototype,'tryTemporary',function(this:DiskCapacity,path:string,bytes:number){
    const attempt=original.call(this,path,bytes),lease=attempt.lease;if(!lease)return attempt;
    return {...attempt,lease:{...lease,release:()=>{
      // Only this fixture's actual acquired claim state is made incompatible.
      writeFileSync(this.temporaryStateFile,'{"version":2,"future":"keep"}\n');lease.release();
    }}};
  });
  let observed:unknown;
  try{await captureDependencies(cap,undefined,env);assert.fail('release refusal must not return a successful lifetime');}catch(error){observed=error;}
  assert.match(String(observed),/oracle dependency cleanup failed/);assert.match(String(observed),/version/);
  assert.equal(existsSync(join(directory,'ready.json')),!failedProducer);
  assert.throws(()=>capacity.snapshot(f.parent),/version/,'release did not overwrite incompatible state');
  if(failedProducer){
    assert.ok(observed instanceof AggregateError);assert.equal(observed.errors.length,2);assert.match(String(observed.errors[0]),/capture not measured|install|lockfile/);
    const failed=JSON.parse(readFileSync(join(directory,'failed.json'),'utf8'));assert.equal(failed.kind,'tooling-setup');assert.doesNotMatch(failed.reason,/cleanup failed/);
    await assert.rejects(captureDependencies(cap,undefined,env),error=>error instanceof ToolingInstrumentError&&error.kind==='tooling-setup'&&/capture failed/.test(error.message));
  }else{
    assert.ok(observed instanceof ToolingInstrumentError);assert.equal(observed.kind,'tooling-cleanup');
    assert.equal(existsSync(join(directory,'failed.json')),false,'capacity cleanup does not poison a valid image');
    assert.equal(await captureDependencies(cap,undefined,env),join(directory,'ready.json'),'the next call reuses the ready image without acquiring capacity again');
  }
});
test('canceling an admission wait never owns or leaks temporary bytes',async t=>{
  const f=installFixture(t),cap=f.cap('canceled-disk-wait');
  ownMemory(join(f.parent,'memory'),{disk:{freeBytes:40*2**30,freeInodes:100}});
  const env=canonicalFixture(cap),capacity=new DiskCapacity({env}),controller=new AbortController(),pending=captureDependencies(cap,controller.signal,env);
  let stopped:string|undefined;
  const ended=pending.then(()=>{stopped='capture completed before admission wait';return undefined;},error=>{stopped=String(error);return error;});
  try{
    await waitFor('the capture waiting after its started record',()=>{
      try{readFileSync(join(cap.directory,'node-'+process.versions.node,'started.json'));return true;}
      catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
    },{stopped:()=>stopped});
    assert.equal(capacity.snapshot(f.parent).temporaryReservedBytes,0);controller.abort();
    assert.match(String(await ended),/abort|cancel/i);
    assert.equal(capacity.snapshot(f.parent).temporaryReservedBytes,0);
  }finally{controller.abort();await ended;}
});
test('a dirty workspace input blocks dependency capture',async t=>{
  const f=installFixture(t),cap=f.cap('one');await captureDependencies(cap);
  f.write('packages/one/package.json','{"name":"owned-one","version":"1.0.1"}\n');
  await assert.rejects(captureDependencies(cap),/input|captured clean tree/);
});

test('the consuming Node version owns a distinct dependency image directory',async t=>{
  const f=installFixture(t),cap=f.cap('version'),ready=await captureDependencies(cap);
  assert.equal(dirname(ready),join(cap.directory,'node-'+process.versions.node));
  assert.equal(await captureDependencies(cap),ready);
  const ledger=join(cap.admission.kind==='gate'?cap.admission.temporary.parent:cap.directory,'oracle-dependency-calls.jsonl');
  const calls=readFileSync(ledger,'utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.directory===dirname(ready));
  assert.deepEqual(calls.map(row=>row.mode),['cold','hit']);
  assert.ok(calls[0].pnpmSelectionCommands>0,'the cold path must exercise the real pnpm selector');
  assert.equal(calls[1].pnpmSelectionCommands,0,'a ready hit validates the recorded commit without rerunning pnpm');
});
test('deleting a committed workspace member after capability creation holds before building',async t=>{
  const f=installFixture(t),cap=f.cap('not-built');
  await captureDependencies(f.cap('complete-control'));
  f.git('rm','--','packages/one/package.json');f.git('commit','--quiet','-m','Remove a workspace member after the capability');
  await assert.rejects(captureDependencies(cap),/committed install inputs changed/);
});
test('adding committed workspace metadata outside the old member paths holds before building',async t=>{
  const f=installFixture(t),cap=f.cap('not-built');
  await captureDependencies(f.cap('complete-control'));
  f.write('packages/two/package.json','{"name":"owned-two","version":"1.0.0"}\n');
  f.git('add','--','packages/two/package.json');f.git('commit','--quiet','-m','Add a workspace member after the capability');
  await assert.rejects(captureDependencies(cap),/committed install inputs changed/);
});

function canonicalFixture(cap:unknown):NodeJS.ProcessEnv{
  const raw=JSON.stringify(cap),context=JSON.parse(process.env.NTS_GATE_ENV_CONTEXT!);
  context.owned.NTS_ORACLE_DEPENDENCIES=raw;context.report.host.NTS_ORACLE_DEPENDENCIES=raw;
  return {...testEnvironment(),NTS_ORACLE_DEPENDENCIES:raw,NTS_GATE_ENV_CONTEXT:JSON.stringify(context)};
}
test('a run dependency seal rejects a same-byte rewrite after the unchanged positive control',async t=>{
  const f=installFixture(t),initial=f.cap('sealed'),environment=canonicalFixture(initial);
  const seal=Reflect.get(dependencyOwner,'sealDependencyCapability');
  // The old producer has no run seal; the same acquisition and mutation still
  // reach its real ready-image reuse path, retaining a biting before control.
  const cap=typeof seal==='function'?await seal(initial,environment):initial;
  const env=canonicalFixture(cap),acquire=()=>Reflect.apply(captureDependencies,undefined,[cap,undefined,env]) as Promise<string>;
  const ready=await acquire(),bytes=readFileSync(ready),before=lstatSync(ready);
  assert.equal(await acquire(),ready);assert.deepEqual(readFileSync(ready),bytes);
  chmodSync(ready,0o644);writeFileSync(ready,bytes);chmodSync(ready,before.mode&0o777);utimesSync(ready,before.atime,before.mtime);
  assert.deepEqual(readFileSync(ready),bytes,'the subject changes the seal identity only');
  await assert.rejects(acquire(),error=>error instanceof Error&&'kind' in error&&error.kind==='tooling-setup'&&/oracle dependency seal changed/.test(error.message));
});
test('outside a canonical run dependency acquisition retains full live input validation',async t=>{
  // Outside a canonical run, with only a memory reading and a ledger of its own.
  const f=installFixture(t),cap=f.cap('outside-run'),memory=ownMemory(join(f.parent,'memory'));
  const acquire=()=>Reflect.apply(captureDependencies,undefined,[cap,undefined,{...memory}]) as Promise<string>;
  const ready=await acquire();assert.equal(await acquire(),ready);
  f.write('packages/one/package.json','{"name":"owned-one","version":"1.0.1"}\n');
  await assert.rejects(acquire(),/input|captured clean tree/);
});


test('every run seal identity and declared handoff is checked before reuse',async t=>{
  const f=installFixture(t);
  for(const mutation of ['replacement','mode','missing'] as const)await t.test(mutation,async()=>{
    const initial=f.cap(mutation),cap=await dependencyOwner.sealDependencyCapability(initial,canonicalFixture(initial)),env=canonicalFixture(cap);
    const acquire=()=>captureDependencies(cap,undefined,env),ready=await acquire(),bytes=readFileSync(ready);
    assert.equal(await acquire(),ready);
    if(mutation==='replacement'){renameSync(ready,ready+'.original');writeFileSync(ready,bytes,{mode:0o444});}
    else if(mutation==='mode')chmodSync(ready,0o644);
    else renameSync(ready,ready+'.original');
    await assert.rejects(acquire(),/oracle dependency seal changed/);
  });
  const initial=f.cap('schema'),cap=await dependencyOwner.sealDependencyCapability(initial,canonicalFixture(initial));
  assert.equal(await captureDependencies(cap,undefined,canonicalFixture(cap)),cap.seal!.record);
  for(const field of ['dev','ino','uid','mode','nlink','size','mtimeNs','ctimeNs'])for(const value of [null,1,'invalid','0']){
    const changed=structuredClone(cap);Reflect.set(changed.seal!.identity,field,value);
    if(JSON.stringify(changed)===JSON.stringify(cap))continue;
    await assert.rejects(captureDependencies(changed,undefined,canonicalFixture(changed)),/oracle dependency seal changed/,field+': '+value);
  }
  const invalid=canonicalFixture(cap),context=JSON.parse(invalid.NTS_GATE_ENV_CONTEXT!);
  context.report.host.NTS_ORACLE_DEPENDENCIES='different parent record';invalid.NTS_GATE_ENV_CONTEXT=JSON.stringify(context);
  await assert.rejects(captureDependencies(cap,undefined,invalid),/oracle dependency seal changed/);
  const wrongVersion=structuredClone(cap);wrongVersion.seal!.nodeVersion='25.0.0';
  await assert.rejects(captureDependencies(wrongVersion,undefined,canonicalFixture(wrongVersion)),/oracle dependency seal changed/);
});
