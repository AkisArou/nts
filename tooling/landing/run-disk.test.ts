import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
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

function inUnit(t:TestContext,f:ReturnType<typeof fixture>,steps:string[],commit?:string):Ran{
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
    result=await runLanding(${JSON.stringify(f.options(steps,commit?{commit}:{}))});
  `);
  const env=fixtureEnvironment(t),setenv=Object.entries(env).filter((row):row is [string,string]=>row[1]!==undefined).map(([key,value])=>'--setenv='+key+'='+value);
  const ran=spawnTest('systemd-run',['--user','--unit='+unit,'--collect','--wait','--pipe','--quiet','-p','LimitCORE=0','-p','Nice=19','-p','RuntimeMaxSec=300s','-p','CPUAffinity=0-3 6-31',...setenv,process.execPath,'--input-type=module','-e',code],{env,encoding:'utf8'});
  assert.equal(ran.status,0,ran.stdout+ran.stderr);
  const terminal=JSON.parse(readFileSync(output,'utf8'));assert.deepEqual(terminal.ledger,{waiting:[],admitted:[]});assert.deepEqual(terminal.context.failures,[]);
  return terminal.result;
}

test('the actual landing build disk refusal drains its reservation without an immediate retry',t=>{
  const f=fixture(t);ownMemory(join(f.own,'memory'),{disk:{freeBytes:45*2**30,freeInodes:100}});
  const result=inUnit(t,f,['build','tests']);
  assert.equal(result.state,'held',result.message);assert.equal(result.steps[0]?.verdict,'INSTRUMENT',result.message);
  assert.equal(result.steps[0]?.instrument?.kind,'disk-capacity');assert.equal(result.steps[0]?.instrument?.disk?.shortBytes,2**30);
  assert.deepEqual(result.steps.map(row=>row.verdict),['INSTRUMENT','NOT RUN']);assert.equal(result.steps[0]?.attempt,undefined);
});

test('actual test-profile and doctest core steps preserve the disk cause through the gate and full-check reader',t=>{
  const f=fixture(t);
  copyModuleClosure(['tooling/gate/test-profile.ts','tooling/gate/doctests.ts'],f.tree);
  const shell=join(f.tree,'tooling/gate/all.sh'),before=readFileSync(shell,'utf8');
  writeFileSync(shell,before.replace('  case $control in',`  [ "$step" = tests ] && exec node "$(dirname "$0")/test-profile.ts" workspace\n  [ "$step" = doctests ] && exec node "$(dirname "$0")/doctests.ts"\n  case $control in`));
  for(const args of [['add','.'],['commit','-qm','private actual disk routes']]){
    const wrote=spawnTest('git',gitArguments(args),{cwd:f.tree,env:fixtureEnvironment(t),encoding:'utf8'});assert.equal(wrote.status,0,wrote.stderr);
  }
  const head=spawnTest('git',gitArguments(['rev-parse','HEAD']),{cwd:f.tree,env:fixtureEnvironment(t),encoding:'utf8'});assert.equal(head.status,0,head.stderr);
  ownMemory(join(f.own,'memory'),{disk:{freeBytes:45*2**30,freeInodes:100}});
  const result=inUnit(t,f,['tests','doctests'],head.stdout.trim());
  assert.equal(result.state,'held',result.message);
  for(const row of result.steps){assert.equal(row.verdict,'INSTRUMENT',JSON.stringify(row));assert.equal(row.instrument?.kind,'disk-capacity');}
  const read=readSummary(f.run,head.stdout.trim(),['tests','doctests']);assert.deepEqual(read.steps,{tests:'HELD',doctests:'HELD'});assert.equal(verdictOf(read.steps),'held');
});
