import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {test} from 'node:test';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectHostSource,hostReadProblems,auditTestHost,recordHostDebt} from './test-host-audit.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {hostObservations} from './host-observations.ts';
import {activeCommand} from './active-process.ts';
import {commandObservationFixture} from './command-observations-fixture.ts';
import {waitFor} from './test-wait.ts';
import {poisonedTestEnvironment} from './test-host-bootstrap.ts';

test('every tooling test dependency closure obeys module ownership',()=>{
  const result=auditTestHost(fileURLToPath(new URL('../..',import.meta.url)));
  assert.deepEqual(result.problems,[],result.problems.join('\n'));
  assert.ok(result.closures.length>200);
});

test('a dependency calling statfs directly fails, including aliases and generated children',()=>{
  for(const source of [
    'import {statfsSync as capacity} from "node:fs"; capacity(".");',
    'const {statfsSync:capacity}=require("node:fs"); capacity(".");',
    'import * as fs from "node:fs"; const capacity=fs.statfsSync; capacity(".");',
    'spawn(node,["-e",`const fs=require("node:fs");fs.statfsSync(".")`]);',
  ]){
    const {reads}=inspectHostSource('tooling/new-dependency.ts',source);
    assert.ok(reads.some(read=>read.kind==='disk'),source);
    assert.ok(hostReadProblems(reads,{}).some(problem=>problem.includes('disk read outside its owner')),source);
  }
});

test('an inner environment missing disk observations fails before reading the real disk',t=>{
  const root=testScratch(t,'host-audit-disk'),owned=ownMemory(root),env=fixtureEnvironment(t,owned);
  const file=owned.NTS_HOST_OBSERVATIONS,value=JSON.parse(readFileSync(file,'utf8'));
  delete value.disk;writeFileSync(file,JSON.stringify(value));
  assert.throws(()=>hostObservations(env),/disk.freeBytes/);
  delete env.NTS_HOST_OBSERVATIONS;
  assert.throws(()=>hostObservations(env),/fixture host observation capability missing/);
});

test('a restored ambient environment copy is forbidden even inside a generated shim',()=>{
  for(const source of ['const child={...process.env};','const ambient=process.env; Object.assign({},ambient);',
    'spawn(node,[],{env:process.env});','writeFileSync(shim,`spawn(node,[],{env:{...process.env}})`);']){
    const {reads}=inspectHostSource('tooling/new-fixture.ts',source);
    assert.ok(hostReadProblems(reads,{}).some(problem=>problem.includes('forbidden environment')),source);
  }
  assert.deepEqual(inspectHostSource('tooling/fixture.ts','const child=fixtureEnvironment(t,{OWNED:"value"});').reads,[]);
});

test('moving child readiness later breaks a scheduling assertion but passes the explicit barrier',async t=>{
  for(const delay of [1,9_000_000]){
    const root=testScratch(t,'host-audit-readiness'),boot=join(root,'boot'),ready=join(root,'ready'),release=join(root,'release');
    const control=commandObservationFixture();
    const source=`import {watch,existsSync,writeFileSync} from 'node:fs';
const [boot,ready,release]=process.argv.slice(1);
await new Promise(resolve=>{const watcher=watch(process.cwd(),()=>{if(existsSync(release)){watcher.close();resolve();}});writeFileSync(boot,'watch installed');});
writeFileSync(ready,'ready');process.stdout.write('ready');`;
    const running=activeCommand(process.execPath,['--input-type=module','-e',source,boot,ready,release],{cwd:root,env:fixtureEnvironment(t),observations:control.observations,idleMs:100});
    await control.attached;
    await waitFor('the delayed child to install its release barrier',()=>existsSync(boot));
    control.sample(delay,{busy:true});
    assert.throws(()=>assert.ok(existsSync(ready),'child has not declared readiness'),/has not declared readiness/);
    writeFileSync(release,'parent grants readiness');
    await waitFor('the delayed child readiness event',()=>existsSync(ready));
    const result=await running;
    assert.equal(result.status,0,result.out);assert.equal(result.hung,undefined);assert.equal(result.stdout,'ready');
  }
});

test('Rust fixtures cannot construct a second partial host packet',()=>{
  const read=inspectHostSource('tooling/cli/tests/new.rs','command.env("NTS_MEMINFO", "/owned/file");').reads;
  assert.match(hostReadProblems(read,{})[0]!,/forbidden fixture-constructor/);
});

test('poisoned launcher state is removed before strict worker grants are installed',()=>{
  const environment=poisonedTestEnvironment();
  for(const name of ['NODE_OPTIONS','NODE_PATH','NTS_UNDECLARED_TEST_ENVIRONMENT'])assert.equal(environment[name],undefined,name);
  assert.notEqual(environment.HOME,'/unowned/test-home');
  assert.equal(hostObservations(environment).disk('/missing').freeBytes,2**40);
});

test('the tool records falls, permits improvements, and refuses a new or raised count',t=>{
  const root=testScratch(t,'host-audit-record'),file=join(root,'debt.json');
  const reads=inspectHostSource('tooling/dependency.ts','import {statfsSync} from "node:fs"; statfsSync(".");').reads;
  const debt={'tooling/dependency.ts':{disk:2}};
  writeFileSync(file,JSON.stringify(debt));
  assert.deepEqual(hostReadProblems(reads,debt),[]);
  recordHostDebt(file,reads,debt);
  const improved=JSON.parse(readFileSync(file,'utf8'));
  assert.deepEqual(improved,{'tooling/dependency.ts':{disk:1}});
  assert.throws(()=>recordHostDebt(file,[...reads,...reads],improved),/disk read outside its owner/);
  assert.throws(()=>recordHostDebt(file,reads,{}),/disk read outside its owner/);
  assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),improved);
});
