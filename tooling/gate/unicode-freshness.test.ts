import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test,type TestContext} from 'node:test';
import {acquirePinnedInput,pinnedInput,readPinnedInput} from '../inputs/pinned-inputs.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {fixtureInput} from './reader-inputs/main.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {testScratch} from './test-scratch.ts';
import {spawnTest} from './test-wait.ts';

async function fixture(t:TestContext){
  const root=testScratch(t,'unicode-freshness'),tree=join(root,'tree'),cache=join(root,'cache'),data=join(tree,'tests/typescript/unicode');
  const input=pinnedInput('unicode-idna-17'),bytes=readPinnedInput(input,{env:fixtureEnvironment(t)});
  await acquirePinnedInput(input,{cache,fetcher:async()=>new Response(bytes)});
  mkdirSync(data,{recursive:true});
  copyModuleClosure([
    fixtureInput(new URL('../unicode-cases/url-hosts.ts',import.meta.url),{dataNamespaces:{'tests/typescript/unicode':'private URL-host generation'}}),
    'tooling/gate/all.sh',
  ],tree);
  const instrument=join(root,'instrument.json');
  const environment=(selected=cache)=>fixtureEnvironment(t,{NTS_PINNED_INPUTS_CACHE:selected,NTS_GATE_STEP_RESULT:instrument,NTS_GATE_STEP:'unicode-freshness',NTS_GATE_STEP_ATTEMPT:'fixture'});
  const generator=join(tree,'tooling/unicode-cases/url-hosts.ts');
  const run=(args:string[],selected=cache)=>{rmSync(instrument,{force:true});return spawnTest(process.execPath,[generator,...args],{cwd:tree,env:environment(selected),encoding:'utf8'});};
  const check=(selected=cache)=>{rmSync(instrument,{force:true});return spawnTest('sh',[join(tree,'tooling/gate/all.sh'),'--call','unicode-freshness'],{cwd:tree,env:environment(selected),encoding:'utf8'});};
  const generated=run([]);assert.equal(generated.status,0,generated.stdout+generated.stderr);
  return {root,data,bytes,run,check,instrument};
}

test('the real freshness step detects changed, missing and extra outputs without rewriting them',async t=>{
  const f=await fixture(t),names=readdirSync(f.data).sort(),saved=new Map(names.map(name=>[name,readFileSync(join(f.data,name))]));
  const clean=f.check();assert.equal(clean.status,0,clean.stdout+clean.stderr);assert.match(clean.stdout,/"action": "checked"/);
  for(const [name,bytes]of saved)assert.deepEqual(readFileSync(join(f.data,name)),bytes);
  const name=names[0]!;writeFileSync(join(f.data,name),'changed fixture');
  const stale=f.check();assert.notEqual(stale.status,0);assert.match(stale.stderr,/Regeneration differs/);assert.equal(readFileSync(join(f.data,name),'utf8'),'changed fixture');
  writeFileSync(join(f.data,name),saved.get(name)!);rmSync(join(f.data,name));
  const missing=f.check();assert.notEqual(missing.status,0);assert.match(missing.stderr,/Missing generated case/);assert.equal(existsSync(join(f.data,name)),false);
  writeFileSync(join(f.data,name),saved.get(name)!);writeFileSync(join(f.data,'url-hosts-extra.ts'),'extra fixture');
  const extra=f.check();assert.notEqual(extra.status,0);assert.match(extra.stderr,/Unexpected existing URL cases/);assert.equal(readFileSync(join(f.data,'url-hosts-extra.ts'),'utf8'),'extra fixture');
});

test('freshness is offline, names missing input as an instrument failure and preserves data-dir validation',async t=>{
  const f=await fixture(t),missing=f.check(join(f.root,'missing-cache'));
  assert.equal(missing.status,1,missing.stdout+missing.stderr);assert.match(missing.stderr,/pinned input: missing unicode-idna-17/);
  assert.equal(JSON.parse(readFileSync(f.instrument,'utf8')).kind,'tooling-setup');
  const input=join(f.root,'source');mkdirSync(input);writeFileSync(join(input,'IdnaTestV2.txt'),f.bytes);
  const valid=f.run(['--check','--data-dir',input]);assert.equal(valid.status,0,valid.stdout+valid.stderr);
  writeFileSync(join(input,'IdnaTestV2.txt'),'invalid source');
  const wrong=f.run(['--check','--data-dir',input]);assert.notEqual(wrong.status,0);assert.match(wrong.stderr,/SHA-256 mismatch/);
});
