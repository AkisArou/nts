import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {buildToolingLoadCompiler} from './tooling-load.ts';
import {DiskBuildAdmissionError} from './step-result.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';

test('the tooling-load build preserves a typed disk refusal before opening its Cargo log',t=>{
  const root=testScratch(t,'tooling-load-disk'),log=join(root,'build.log');
  const env={...fixtureEnvironment(t),...ownMemory(join(root,'owned'),{disk:{freeBytes:45*2**30,freeInodes:100}})};
  assert.throws(()=>buildToolingLoadCompiler(root,env,log),error=>{
    assert.ok(error instanceof DiskBuildAdmissionError);assert.equal(error.kind,'disk-capacity');
    assert.equal(error.disk.shortBytes,2**30);assert.equal(error.disk.target,join(root,'target'));return true;
  });
  assert.equal(existsSync(log),false,'no Cargo command or log allocation follows a denied attempt');
});
