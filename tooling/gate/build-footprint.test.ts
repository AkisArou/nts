import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {buildFootprintSample} from './build-footprint.ts';
import {innerBuildOutputs} from './build-targets.ts';
import {hostObservations} from './host-observations.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';

test('the cold footprint counts declared outputs and never target evidence',t=>{
  const root=testScratch(t,'cold-footprint-observations'),target=join(root,'target');
  const outputs=innerBuildOutputs(target),paths=Object.fromEntries(outputs.map((output,index)=>[output.path,index+10]));
  paths[join(target,'evidence')]=77*2**30;
  paths[join(target,'debug')]=4*2**30;
  const env=ownMemory(join(root,'observations'),{clock:{kind:'fixed',now:250},allocated:{kind:'fixed',defaultBytes:99,paths}});
  assert.deepEqual(buildFootprintSample(outputs,hostObservations(env),100),{elapsedMs:150,allocatedBytes:21,outputs:{'nts-dev':10,clippy:11}});
});
