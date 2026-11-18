import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixtureEnvironment} from './test-environment.ts';
import {testScratch} from './test-scratch.ts';
import {spawnTest} from './test-wait.ts';

test('cold pools rank source entries and projects by size; measured costs replace that fallback',t=>{
  const root=testScratch(t,'case-file-costs'),small=join(root,'small.ts'),large=join(root,'large.mjs'),project=join(root,'project');
  mkdirSync(project);writeFileSync(small,'x');writeFileSync(large,'x'.repeat(10_000));writeFileSync(join(project,'main.ts'),'x'.repeat(100));
  const probe=`import{longestFirst,recordCosts}from ${JSON.stringify(new URL('./costs.mjs',import.meta.url).href)};
const paths=${JSON.stringify([small,large,project])},cold=longestFirst('entries',paths);
recordCosts('entries',{[paths[0]]:100,[paths[1]]:1,[paths[2]]:2});
process.stdout.write(JSON.stringify({cold,warm:longestFirst('entries',paths)}));`;
  const result=spawnTest(process.execPath,['--input-type=module','-e',probe],{env:fixtureEnvironment(t,{NTS_GATE_COSTS_DIR:join(root,'costs')}),encoding:'utf8'},'source entry scheduling costs');
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{cold:[large,project,small],warm:[small,project,large]});
});
