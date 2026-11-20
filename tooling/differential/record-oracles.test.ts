// A recording prepares every program into one evidence directory. A program's
// snapshot records the inputs it read, including its project directory's
// listing, so a generated benchmark project must sit where no sibling
// preparation or evidence file can appear (#892). The guard on a program's own
// inputs stays: its source or its project directory changing still refuses.
import assert from 'node:assert/strict';
import {appendFileSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {test,type TestContext} from 'node:test';
import {toolchain,prepareOracle} from './oracle-emit-fixture.ts';
import {finishOracleSnapshot} from './oracle-emit.ts';
import {REPOSITORY} from './oracle-services.ts';
import {removeOracleSnapshot} from './oracle-snapshot.ts';
import {fixtureConfig} from './record-oracles.ts';

const CASES=['alpha','beta'] as const;
function recording(t:TestContext){
  const root=mkdtempSync(join(tmpdir(),'nts-record-oracles-'));t.after(()=>removeOracleSnapshot(root));
  writeFileSync(join(root,'tsconfig.fixtures.json'),readFileSync(join(REPOSITORY,'tsconfig.fixtures.json')));
  for(const name of CASES){const entry=join(root,'benchmarks/cases',name,'case.ts');mkdirSync(dirname(entry),{recursive:true});writeFileSync(entry,`console.log(${JSON.stringify(name)});\n`);}
  const evidence=join(root,'evidence');mkdirSync(evidence);
  const configs=Object.fromEntries(CASES.map(name=>[name,fixtureConfig(root,evidence,'benchmarks/cases/'+name)]));
  // As recordAll does: each program prepares into its own identity directory
  // under the shared evidence root, one after another.
  const prepare=(name:typeof CASES[number])=>prepareOracle({toolchain,entry:join(root,'benchmarks/cases',name,'case.ts'),project:configs[name]!,directory:join(evidence,name+'-identity','0.emit')});
  return {root,evidence,configs,prepare};
}

test('a sibling preparation in the shared evidence directory leaves an earlier program finalizable',async t=>{
  const {evidence,prepare}=recording(t),alpha=await prepare('alpha'),beta=await prepare('beta');
  writeFileSync(join(evidence,'measurement-summary.json'),'{}\n');
  assert.deepEqual(finishOracleSnapshot(alpha),{ready:true});
  assert.deepEqual(finishOracleSnapshot(beta),{ready:true});
});

test('a program whose own source changes during capture is still refused',async t=>{
  const {root,prepare}=recording(t),alpha=await prepare('alpha');await prepare('beta');
  appendFileSync(join(root,'benchmarks/cases/alpha/case.ts'),'console.log(1);\n');
  const final=finishOracleSnapshot(alpha);assert.equal(final.ready,false);if(!final.ready)assert.match(final.why,/filesystem file changed: .*alpha\/case\.ts/);
});

test("a program whose own project directory's listing changes is still refused",async t=>{
  const {configs,prepare}=recording(t),alpha=await prepare('alpha');
  writeFileSync(join(dirname(configs.alpha!),'added.json'),'{}\n');
  const final=finishOracleSnapshot(alpha);assert.equal(final.ready,false);if(!final.ready)assert.match(final.why,/filesystem entries changed: .*projects\/alpha/);
});
