import {fixtureEnvironment} from "../gate/test-environment.ts";
// Saved observations exercise the actual consumer's selection and comparison
// without recompiling the sample or changing a checked-in case or record.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,symlinkSync,writeFileSync,chmodSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { harnessHashOf,populationOf } from './project.ts';
import { selectTypescript,typescriptOracleIdentity } from './suites/typescript.ts';
import { serializeTypeScriptRecord,TYPESCRIPT_OBSERVATIONS_VERSION,type TypeScriptObservation } from './typescript-record.ts';
import { OUTPUT_PREFIX_VERSION } from '../conformance/output-prefix.ts';
import { provenanceOf } from '../conformance/pin.ts';
import { removeOracleSnapshot } from '../differential/oracle-emit.ts';
import { ownMemoryEnv } from '../gate/test-memory.ts';

import {setupOracleTestEnvironment} from '../differential/oracle-test-fixture.ts';

await setupOracleTestEnvironment();

test('sampled record comparisons distinguish omitted, pending and compared cases',async t=>{
  const repository=fileURLToPath(new URL('../../',import.meta.url)),binary=resolve(repository,process.env.NTS_BIN??'target/release/nts');
  assert.ok(existsSync(binary),'compiler missing: '+binary);
  const scratch=mkdtempSync(join(tmpdir(),'nts-sampled-records-'));t.after(()=>removeOracleSnapshot(scratch));
  const fixture=join(scratch,'fixture'),census=join(fixture,'tooling/census');mkdirSync(census,{recursive:true});
  for(const name of readdirSync(join(repository,'tooling/census'))){
    const from=join(repository,'tooling/census',name),to=join(census,name);
    if(name==='conformance262.ts')copyFileSync(from,to);else symlinkSync(from,to);
  }
  for(const name of readdirSync(join(repository,'tooling')))if(name!=='census')symlinkSync(join(repository,'tooling',name),join(fixture,'tooling',name));
  mkdirSync(join(fixture,'tests/typescript/private'),{recursive:true});
  for(const value of [1,2])writeFileSync(join(fixture,'tests/typescript/private',value+'.ts'),`assert.sameValue(${value},${value});\n`);
  const git=(args:string[])=>{const result=spawnSync('git',args,{env:fixtureEnvironment(t),cwd:fixture,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
  git(['init','--quiet']);git(['add','tests']);git(['-c','user.name=Fixture','-c','user.email=fixture@invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','--quiet','-m','Private sample']);
  const selected=selectTypescript(fixture,'tests/typescript'),sampled=populationOf(selected,{sample:1});
  assert.ok('population' in sampled);const target=sampled.population[0]!.path;
  const other=selected.find(row=>row.path!==target)!.path;
  const pass:TypeScriptObservation={kind:'pass'},fingerprint=createHash('sha256').update(readFileSync(binary)).digest('hex').slice(0,16);
  const metadata={version:3 as const,backend:'c' as const,commit:provenanceOf(binary)?.sha??git(['rev-parse','HEAD']),compiler:fingerprint,harness:harnessHashOf('ts'),under:'tests/typescript'};
  const record=join(scratch,'record.tsv'),rows=join(scratch,'rows.jsonl'),report=join(scratch,'report.json');
  const run=(mode:'--recorded'|'--check',cases:Map<string,TypeScriptObservation>,observed?:object)=>{
    rmSync(report,{force:true});
    writeFileSync(record,serializeTypeScriptRecord({metadata,cases}));
    writeFileSync(rows,JSON.stringify({fingerprint,under:metadata.under,harness:metadata.harness,output_prefix:OUTPUT_PREFIX_VERSION,
      observations:TYPESCRIPT_OBSERVATIONS_VERSION,oracleIdentity:typescriptOracleIdentity()})+'\n'+(observed?JSON.stringify({path:target,...observed})+'\n':''));
    const result=spawnSync(process.execPath,['tooling/census/conformance262.ts','--suite','typescript',mode,record,'--sample','1','--jobs','1','--rows',rows,'--resume','--json',report],
      {cwd:fixture,encoding:'utf8',maxBuffer:16*1024*1024,env:ownMemoryEnv(join(scratch,'memory'),{...fixtureEnvironment(t),NTS_BIN:binary,NTS_CENSUS_DIR:join(scratch,'run'),NTS_GATE_STEP:'sampling-fixture'})});
    return {...result,json:existsSync(report)?JSON.parse(readFileSync(report,'utf8')):undefined};
  };
  await t.test('a recorded case outside the sample is not run or missing',()=>{
    const result=run('--recorded',new Map([[target,pass],[other,pass]]),{bucket:'strict-pass'});
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(result.json.population,1);assert.deepEqual(Object.keys(result.json.observations),[target]);
    assert.equal(result.json.comparison.MISSING?.length??0,0);assert.equal(result.json.attempted,1);
  });
  await t.test('a selected case with no row is pending and is not measured',()=>{
    const result=run('--check',new Map([[other,pass]]));
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(result.json.attempted,0);assert.deepEqual(result.json.observations,{});
    assert.equal(result.json.comparison.pending.length,1);assert.ok(result.json.comparison.pending[0].includes(target));
  });
  await t.test('a selected recorded case is still compared',()=>{
    const result=run('--recorded',new Map([[target,pass],[other,pass]]),{bucket:'threw',thrown:'Test262Error',runtimeFailure:{exit:1,signal:null,output:'uncaught Test262Error: wrong'}});
    assert.equal(result.status,1,result.stdout+result.stderr);
    assert.equal(result.json.comparison.REGRESSED.length,1);assert.ok(result.json.comparison.REGRESSED[0].startsWith(target+':'));
  });
  await t.test('test262 recorded mode does not call its sampled-out row missing',()=>{
    // This private suite has no excluded includes or evidence overrides.
    // Replace the fixture's links, never the repository's ledgers.
    for(const [name,value] of [['test262-exclusions.json',{exclusions:[]}],['test262-evidence-overrides.json',{overrides:[]}]] as const){
      rmSync(join(census,name));writeFileSync(join(census,name),JSON.stringify(value)+'\n');
    }
    const suite=join(fixture,'third_party/test262/test/language');mkdirSync(suite,{recursive:true});
    const paths=['test/language/a.js','test/language/b.js'];
    for(const path of paths)writeFileSync(join(fixture,'third_party/test262',path),'assert.sameValue(1,1);\n');
    const protocol=join(scratch,'select.cjs');writeFileSync(protocol,'#!/usr/bin/env node\n'+paths.map((path,index)=>'console.log('+JSON.stringify(JSON.stringify({path,schedule:'planned',variant_id:path+'#strict',strict_prefix:'',includes:[],features:[],flags:[],source_hash:String(index),body_hash:String(index),function_token:false}))+');').join('\n')+'\n');chmodSync(protocol,0o755);
    const record=join(scratch,'js.tsv');writeFileSync(record,paths.map(path=>path+'\tpass\t').join('\n')+'\n');
    rmSync(report,{force:true});
    writeFileSync(rows,JSON.stringify({fingerprint,under:'test/language',harness:harnessHashOf('js'),output_prefix:OUTPUT_PREFIX_VERSION})+'\n'+JSON.stringify({path:paths[0],bucket:'strict-pass'})+'\n');
    const result=spawnSync(process.execPath,['tooling/census/conformance262.ts','--recorded',record,'--sample','1','--jobs','1','--rows',rows,'--resume','--json',report],
      {cwd:fixture,encoding:'utf8',maxBuffer:16*1024*1024,env:ownMemoryEnv(join(scratch,'memory'),{...fixtureEnvironment(t),NTS_BIN:binary,NTS_TEST262_PROTOCOL:protocol,NTS_CENSUS_DIR:join(scratch,'js-run'),NTS_GATE_STEP:'sampling-fixture'})});
    assert.equal(result.status,0,result.stdout+result.stderr);
    const json=JSON.parse(readFileSync(report,'utf8'));assert.equal(json.population,1);assert.deepEqual(json.comparison.MISSING,[]);
  });
});
