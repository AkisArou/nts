import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {randomUUID} from 'node:crypto';
import {chmodSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './run-fixture.ts';
import {fixtureEnvironment} from '../gate/test-environment.ts';
import {ownMemory} from '../gate/test-memory.ts';
import {spawnTest} from '../gate/test-wait.ts';
import {generatedJavaScript} from '../gate/generated-javascript.ts';
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {gitArguments} from '../gate/git-arguments/main.ts';
import type {Ran} from './run.ts';
import {readSummary,verdictOf} from '../full-check/measure.ts';
import {diskRetry} from './service.ts';

function inUnit(t:TestContext,f:ReturnType<typeof fixture>,steps:string[],commit?:string,extra:{build?:string[]}={}):Ran{
  const unit='nts-test-disk-run-'+randomUUID(),output=join(f.own,'drained.json');
  t.after(()=>{spawnTest('systemctl',['--user','stop',unit],{env:fixtureEnvironment(t),stdio:'ignore',encoding:'utf8'});});
  const code=generatedJavaScript(`
    import {runLanding} from ${JSON.stringify(new URL('./run.ts',import.meta.url).href)};
    import {registerCommandCloser} from ${JSON.stringify(new URL('../differential/command-entry/main.ts',import.meta.url).href)};
    import {readLedger} from ${JSON.stringify(new URL('../gate/memory-ledger.ts',import.meta.url).href)};
    import {durableRecord} from ${JSON.stringify(new URL('../gate/durable-record.ts',import.meta.url).href)};
    import {declareOwnMembers} from ${JSON.stringify(new URL('../gate/test-cgroup-members.ts',import.meta.url).href)};
    declareOwnMembers(${JSON.stringify(f.memory)},[process.pid]);
    let result;
    registerCommandCloser('disk run fixture',{close:context=>durableRecord(${JSON.stringify(output)},{result,context,ledger:readLedger(${JSON.stringify(f.memory.NTS_MEMORY_LEDGER)})})});
    result=await runLanding(${JSON.stringify(f.options(steps,{...(commit?{commit}:{}),...extra}))});
  `);
  const env=fixtureEnvironment(t),setenv=Object.entries(env).filter((row):row is [string,string]=>row[1]!==undefined).map(([key,value])=>'--setenv='+key+'='+value);
  const ran=spawnTest('systemd-run',['--user','--unit='+unit,'--collect','--wait','--pipe','--quiet','-p','LimitCORE=0','-p','Nice=19','-p','RuntimeMaxSec=300s','-p','CPUAffinity=0-3 6-31',...setenv,process.execPath,'--input-type=module','-e',code],{env,encoding:'utf8'});
  assert.equal(ran.status,0,ran.stdout+ran.stderr);
  const terminal=JSON.parse(readFileSync(output,'utf8'));assert.deepEqual(terminal.ledger,{waiting:[],admitted:[]});assert.deepEqual(terminal.context.failures,[]);
  return terminal.result;
}

test('compiler and doctest-only preparation disk refusals drain without an immediate retry',t=>{
  for(const steps of [['build','tests'],['doctests']]){
  const f=fixture(t);ownMemory(join(f.own,'memory'),{disk:{freeBytes:45*2**30,freeInodes:100}});
  const result=inUnit(t,f,steps);
  assert.equal(result.state,'held',result.message);assert.equal(result.steps[0]?.verdict,'INSTRUMENT',result.message);
  assert.equal(result.steps[0]?.instrument?.kind,'disk-capacity');assert.equal(result.steps[0]?.instrument?.disk?.shortBytes,2**30);
  assert.deepEqual(result.steps.map(row=>row.name+' '+row.verdict),steps.includes('build')?['build INSTRUMENT','tests NOT RUN']:['doctests INSTRUMENT']);
  assert.equal(result.steps[0]?.attempt,undefined);
  if(steps.includes('build'))assert.equal(result.steps[1]?.needs,'build');
  assert.match(result.message,/needs 1073741824 more bytes/);
  // The service's own decision on this run: wait for disk room, then retry.
  assert.deepEqual(diskRetry({tree:f.tree,target:f.target},result)?.map(row=>row.shortBytes),[2**30]);
  }
});

/**
 * The landing's build through the real build owner (tooling/gate/build.ts),
 * which admits its own build unless handed one. The command first moves the
 * fixture's disk observation, as other trees' builds did between the
 * landing's admission and its build's command on 2026-11-21 (#951).
 */
function buildOwner(t:TestContext,f:ReturnType<typeof fixture>,freeBytes:number,target='"$CARGO_TARGET_DIR"'):{commit:string;build:string[]}{
  copyModuleClosure(['tooling/gate/build.ts'],f.tree);
  for(const args of [['add','.'],['commit','-qm','private build owner']]){
    const wrote=spawnTest('git',gitArguments(args),{cwd:f.tree,env:fixtureEnvironment(t),encoding:'utf8'});assert.equal(wrote.status,0,wrote.stderr);
  }
  const head=spawnTest('git',gitArguments(['rev-parse','HEAD']),{cwd:f.tree,env:fixtureEnvironment(t),encoding:'utf8'});assert.equal(head.status,0,head.stderr);
  const script=join(f.own,'build-owner.sh'),memory=JSON.stringify(join(f.own,'memory'));
  writeFileSync(script,`#!/bin/sh
${JSON.stringify(process.execPath)} --input-type=module -e 'import {ownMemory} from ${JSON.stringify(new URL('../gate/test-memory.ts',import.meta.url).href)};ownMemory(${memory},{disk:{freeBytes:${freeBytes},freeInodes:100}});' || exit 1
CARGO_TARGET_DIR=${target} exec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(f.tree,'tooling/gate/build.ts'))} --profile nts-dev --no-compiler
`);
  chmodSync(script,0o755);
  return {commit:head.stdout.trim(),build:[script]};
}

test('the build owner runs inside the landing\'s admission when the disk moves below the floor after it',t=>{
  const f=fixture(t);ownMemory(join(f.own,'memory'),{disk:{freeBytes:60*2**30,freeInodes:100}});
  const {commit,build}=buildOwner(t,f,39*2**30);
  const result=inUnit(t,f,['build'],commit,{build});
  assert.equal(result.state,'green',result.message+'\n'+readFileSync(join(f.run,'build.log'),'utf8'));
  assert.deepEqual(result.steps.map(row=>row.name+' '+row.verdict),['build PASS']);
});

test('the build owner\'s typed disk refusal holds the landing for disk, whatever its exit status',t=>{
  // A build of another target is another admission: the owner refuses it and exits 2.
  const f=fixture(t);ownMemory(join(f.own,'memory'),{disk:{freeBytes:60*2**30,freeInodes:100}});
  const {commit,build}=buildOwner(t,f,45*2**30,'"$CARGO_TARGET_DIR/other"');
  const result=inUnit(t,f,['build','tests'],commit,{build});
  assert.equal(result.state,'held',result.message);
  assert.deepEqual(result.steps.map(row=>row.name+' '+row.verdict),['build INSTRUMENT','tests NOT RUN']);
  const [built,tests]=result.steps;
  assert.equal(built?.instrument?.kind,'disk-capacity');assert.equal(built?.instrument?.disk?.target,join(f.target,'other'));
  const short=built?.instrument?.disk?.shortBytes;assert.ok(short!==undefined&&short>0);
  assert.match(result.message,new RegExp(`^build: disk build admission: .* needs ${short} more bytes`));
  assert.equal(tests?.needs,'build');
  assert.deepEqual(diskRetry({tree:f.tree,target:f.target},result)?.map(row=>row.shortBytes),[short]);
});

test('the actual test-profile core step preserves the disk cause through the gate and full-check reader',t=>{
  const f=fixture(t);
  copyModuleClosure(['tooling/gate/test-profile.ts'],f.tree);
  const shell=join(f.tree,'tooling/gate/all.sh'),before=readFileSync(shell,'utf8');
  writeFileSync(shell,before.replace('  case $control in',`  [ "$step" = tests ] && exec node "$(dirname "$0")/test-profile.ts" workspace\n  case $control in`));
  for(const args of [['add','.'],['commit','-qm','private actual disk routes']]){
    const wrote=spawnTest('git',gitArguments(args),{cwd:f.tree,env:fixtureEnvironment(t),encoding:'utf8'});assert.equal(wrote.status,0,wrote.stderr);
  }
  const head=spawnTest('git',gitArguments(['rev-parse','HEAD']),{cwd:f.tree,env:fixtureEnvironment(t),encoding:'utf8'});assert.equal(head.status,0,head.stderr);
  ownMemory(join(f.own,'memory'),{disk:{freeBytes:45*2**30,freeInodes:100}});
  const result=inUnit(t,f,['tests'],head.stdout.trim());
  assert.equal(result.state,'held',result.message);
  for(const row of result.steps){assert.equal(row.verdict,'INSTRUMENT',JSON.stringify(row));assert.equal(row.instrument?.kind,'disk-capacity');}
  const read=readSummary(f.run,head.stdout.trim(),['tests']);assert.deepEqual(read.steps,{tests:'HELD'});assert.equal(verdictOf(read.steps),'held');
});
