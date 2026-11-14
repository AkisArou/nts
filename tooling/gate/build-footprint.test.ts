import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {chmodSync,rmSync,symlinkSync} from 'node:fs';
import {assertColdBuildOutputsUnused,buildFootprintSample} from './build-footprint.ts';
import {treeProcessFixture} from '../landing/tree-users-fixture.ts';
import {innerBuildOutputs} from './build-targets.ts';
import {hostObservations} from './host-observations.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';

test('cold-build ownership accepts absent exiting links and refuses unreadable or live owners',t=>{
  const f=treeProcessFixture(t),outputs=[{path:f.tree}];
  rmSync(join(f.task,'cwd'));rmSync(join(f.task,'exe'));
  assert.doesNotThrow(()=>assertColdBuildOutputsUnused(outputs,f.options));
  chmodSync(join(f.task,'fd'),0);
  try{assert.throws(()=>assertColdBuildOutputsUnused(outputs,f.options),/live unreadable tool process 42/);}
  finally{chmodSync(join(f.task,'fd'),0o700);}
  symlinkSync(join(f.tree,'artifact'),join(f.task,'fd/3'));
  assert.throws(()=>assertColdBuildOutputsUnused(outputs,f.options),/cold build output is in use:.*42/);
});

test('the cold footprint counts declared outputs and never target evidence',t=>{
  const root=testScratch(t,'cold-footprint-observations'),target=join(root,'target');
  const outputs=innerBuildOutputs(target),paths=Object.fromEntries(outputs.map((output,index)=>[output.path,index+10]));
  paths[join(target,'evidence')]=77*2**30;
  paths[join(target,'debug')]=4*2**30;
  const env=ownMemory(join(root,'observations'),{clock:{kind:'fixed',now:250},allocated:{kind:'fixed',defaultBytes:99,paths}});
  assert.deepEqual(buildFootprintSample(outputs,hostObservations(env),100),{elapsedMs:150,allocatedBytes:21,outputs:{'nts-dev':10,clippy:11}});
});
