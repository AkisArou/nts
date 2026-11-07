import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { removeOracleSnapshot } from '../differential/oracle-emit.ts';

import {setupOracleTestEnvironment} from '../differential/oracle-test-fixture.ts';

await setupOracleTestEnvironment();

test('a generated fuzzer oracle has an explicit project and private module helpers',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-fuzz-project-'));t.after(()=>removeOracleSnapshot(root));
  const {runOracle,PRINTER}=await import(new URL('./fuzz-runtime.mjs',import.meta.url).href);
  assert.deepEqual(await runOracle(root,PRINTER+'\nprint(0,19);console.log(JSON.stringify(out));\n'),['19']);
  const config=JSON.parse(readFileSync(join(root,'oracle.tsconfig.json'),'utf8'));
  assert.deepEqual(config.files,['oracle.ts']);assert.deepEqual(config.include,[]);
  assert.match(readFileSync(join(root,'oracle.ts'),'utf8'),/export \{\};/);
});
