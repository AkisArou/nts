import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {MemoryRun} from '../census/worker-memory.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {testScratch} from './test-scratch.ts';

test('bounded entry runs only its source-owned shell instructions and preserves the command environment',t=>{
  const root=testScratch(t,'case-shell-entry'),startup=join(root,'startup.sh'),entered=join(root,'startup-entered');
  writeFileSync(startup,`export NTS_STARTUP_INPUT=unowned\nprintf entered > ${JSON.stringify(entered)}\n`);
  const env={...fixtureEnvironment(t),BASH_ENV:startup};
  const program='process.stdout.write(JSON.stringify({startup:process.env.NTS_STARTUP_INPUT??null,bashEnv:process.env.BASH_ENV}))';
  const ordinary=spawnSync('bash',['--noprofile','--norc','-c','exec "$@"','control',process.execPath,'-e',program],{env,encoding:'utf8'});
  assert.equal(ordinary.status,0,ordinary.stderr);assert.equal(JSON.parse(ordinary.stdout).startup,'unowned');assert.ok(existsSync(entered));
  const memory=new MemoryRun({budgetBytes:256*2**20});t.after(()=>memory.close());
  const worker=memory.worker('entry',memory.budgetBytes),scope=worker.scope(process.execPath,['-e',program],env);
  const bounded=spawnSync('systemd-run',scope.argv,{env:scope.env,encoding:'utf8'});
  assert.equal(bounded.status,0,bounded.stderr);assert.ok(worker.ready(scope));
  assert.deepEqual(JSON.parse(bounded.stdout),{startup:null,bashEnv:startup});
});
