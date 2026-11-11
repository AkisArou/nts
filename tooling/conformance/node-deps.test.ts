import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {fixtureEnvironment} from '../gate/test-environment.ts';
import {testScratch} from '../gate/test-scratch.ts';

test('native dependency memoization respects the declared cache capability and avoids repeated compiler launches',t=>{
  const root=testScratch(t,'native-cache-capability'),compiler=join(root,'compiler'),calls=join(root,'calls');
  writeFileSync(compiler,`#!${process.execPath}
const fs=require('node:fs'),request=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));fs.appendFileSync(${JSON.stringify(calls)},request.cache+'\\n');console.log(JSON.stringify({include_flags:['-I'+request.cache],link_flags:['-L'+request.cache]}));
`,{mode:0o755});
  const first=join(root,'first'),second=join(root,'second'),source=`import {bundledDependencies} from ${JSON.stringify(new URL('./node-deps.mjs',import.meta.url).href)};
const compiler=${JSON.stringify(compiler)},first=bundledDependencies(compiler),again=bundledDependencies(compiler);
process.env.NTS_NODE_DEPS_CACHE=${JSON.stringify(second)};
console.log(JSON.stringify([first,again,bundledDependencies(compiler)]));`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',source],{env:fixtureEnvironment(t,{NTS_NODE_DEPS_CACHE:first}),encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  const [one,again,two]=JSON.parse(child.stdout);
  assert.deepEqual(one,again);assert.deepEqual(one.link_flags,['-L'+first]);assert.deepEqual(two.link_flags,['-L'+second]);
  assert.deepEqual(readFileSync(calls,'utf8').trim().split('\n'),[first,second]);
});
