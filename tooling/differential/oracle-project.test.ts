import {fixtureEnvironment} from "../gate/test-environment.ts";
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {activeCommand} from '../gate/active-command.ts';
import {oracleToolchainLocation} from '../gate/canonical-environment.ts';
import {verifyToolchain} from './oracle-emit.ts';

import {setupOracleTestEnvironment} from './oracle-test-fixture.ts';

await setupOracleTestEnvironment();

test('the differential oracle project has zero pinned TypeScript diagnostics',async t=>{
  const output=mkdtempSync(join(tmpdir(),'nts-oracle-project-'));
  t.after(()=>rmSync(output,{recursive:true,force:true}));
  const project=fileURLToPath(new URL('./tsconfig.json',import.meta.url));
  const {compiler}=verifyToolchain(oracleToolchainLocation());
  const result=await activeCommand(compiler,['--project',project,'--noEmit',
    '--tsBuildInfoFile',join(output,'check.tsbuildinfo'),'--pretty','false'],
  {cwd:dirname(project),env:fixtureEnvironment(t),idleMs:120_000,cpuBudgetSeconds:120,maxBuffer:32*2**20});
  assert.equal(result.signal,null,result.stderr);
  assert.ok(!result.error&&!result.hung&&!result.runaway,result.out);
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(result.stdout+result.stderr,'');
});
