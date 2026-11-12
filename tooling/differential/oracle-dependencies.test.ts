import {gitArguments} from "../gate/git-arguments/main.ts";
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {testEnvironment,fixtureEnvironment} from "../gate/test-environment.ts";
import * as dependencyOwner from './oracle-dependencies.ts';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {chmodSync,cpSync,copyFileSync,readdirSync,renameSync,linkSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,rmSync,utimesSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {before,test} from 'node:test';
import {setupOracleTestEnvironment} from './oracle-test-fixture.ts';
import {dependencyCapability,captureDependencies,dependencyPackageInventory,dependencyInventory,protectDependencyImage} from './oracle-dependencies.ts';
import {ownMemory,useOwnMemory} from '../gate/test-memory.ts';

const key=(root:string)=>createHash('sha256').update(JSON.stringify(dependencyPackageInventory(dependencyInventory(root)))).digest('hex');
before(setupOracleTestEnvironment);
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
