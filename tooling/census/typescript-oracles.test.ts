import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync,mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { typeScriptOraclePopulation } from './typescript-oracles.ts';
import { selectTypescript } from './suites/typescript.ts';
import { populationOf } from './project.ts';
import { removeOracleSnapshot } from '../differential/oracle-emit.ts';

test('shared reference selection is exactly the union of backend populations',t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-population-'));t.after(()=>removeOracleSnapshot(root));
  const dir=join(root,'tests/typescript');mkdirSync(dir,{recursive:true});
  for(const name of ['one','two','three','pending'])writeFileSync(join(dir,name+'.ts'),'const '+name+'=1;\n');
  const records=selectTypescript(root,'tests/typescript');
  const named=[{backend:'c',file:'c.tsv',text:'tests/typescript/one.ts\tpass\ntests/typescript/two.ts\tpass\n'},
    {backend:'llvm',file:'llvm.tsv',text:'tests/typescript/two.ts\tpass\n'},
    {backend:'jvm',file:'jvm.tsv',text:'tests/typescript/three.ts\tpass\n'}];
  for(const sample of [0,2]){
    const union=new Set(named.flatMap(row=>{const got=populationOf(records,{sample,backend:row.backend,named:row});assert.ok('population' in got);return got.population.map(item=>item.path);}));
    assert.deepEqual(typeScriptOraclePopulation(records,named,sample),records.filter(row=>union.has(row.path)).map(row=>row.path));
  }
  assert.ok(!typeScriptOraclePopulation(records,named).includes('tests/typescript/pending.ts'));
  assert.throws(()=>typeScriptOraclePopulation(records,[{backend:'c',file:'empty.tsv',text:'# header\n'}]),/empty record/);
});
