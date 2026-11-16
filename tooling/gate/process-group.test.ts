import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertProcessGroupIdentity} from './process-group.ts';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {testScratch} from './test-scratch.ts';
import {fixtureEnvironment} from './test-environment.ts';

test('a spawn-owned group keeps its birth identity and tolerates its exited leader',()=>{
  const birth={group:71,session:71,started:190};
  assert.doesNotThrow(()=>assertProcessGroupIdentity(71,birth,{...birth}));
  assert.doesNotThrow(()=>assertProcessGroupIdentity(71,birth,undefined));
});

test('a reused PID, a changed group and a changed session independently refuse signalling',()=>{
  const birth={group:71,session:71,started:190};
  for(const current of [{...birth,started:191},{...birth,group:72},{...birth,session:72}])
    assert.throws(()=>assertProcessGroupIdentity(71,birth,current),/refusing to stop a changed command group/);
});

test('a failed boot observation remains inside acquisition cleanup and joins its own spawned child',async t=>{
  const stage=testScratch(t,'group-boot-failure');copyModuleClosure(['tooling/gate/process-group.ts'],stage);
  const file=join(stage,'tooling/gate/process-group.ts'),source=readFileSync(file,'utf8');
  const anchor=source.split('\n').find(line=>line.startsWith('const bootIdentity='));assert.ok(anchor);
  assert.equal(source.split(anchor).length,2);
  writeFileSync(file,source.replace(anchor,"const bootIdentity=()=>{throw Error('controlled boot observation failure');};"));
  const {ownedProcessGroup}:typeof import('./process-group.ts')=await import(pathToFileURL(file).href);
  const child=spawn(process.execPath,['--input-type=module','-e',`import {watch} from 'node:fs';watch(${JSON.stringify(stage)},()=>{});`],{detached:true,env:fixtureEnvironment(t),stdio:'ignore'});
  const closed=once(child,'close'),kill=child.kill.bind(child),signals:(NodeJS.Signals|number|undefined)[]=[];
  child.kill=signal=>{signals.push(signal);return kill(signal);};
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)kill('SIGKILL');await closed;});
  assert.throws(()=>ownedProcessGroup(child),/controlled boot observation failure/);
  assert.deepEqual(signals,['SIGKILL'],'the acquisition owner must clean its own child before throwing');
  assert.deepEqual(await closed,[null,'SIGKILL']);
});
