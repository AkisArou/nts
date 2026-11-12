import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {deriveBands,writeBands} from './count-bands.ts';
import {testScratch} from '../gate/test-scratch.ts';

function fixture(){
  const commit='a'.repeat(40),rows=[0,1].map(run=>({run,commit,wall_s:1,load:[0,0,0],counts:run?[1000001,1070000]:[1000000,1000000]}));
  const provenance={version:1,source_commit:commit,binary_sha256:'b'.repeat(64),counter_cpu:0,measurement_lock:false,runs:2,case:'fixture',profile:'fixture',unit:'fixture',host:'fixture',command:['nts-bench','--count','fixture'],columns:[{name:'native'},{name:'JIT'}]};
  return {rows,provenance};
}
test('the owner derives each column from its own samples with a stated integer rounding rule',()=>{
  const {rows,provenance}=fixture(),record=deriveBands(rows,provenance);
  assert.deepEqual(record.columns.map(x=>x.band_basis_points),[1,700]);
  assert.deepEqual(record.columns[1]!.samples,[1000000,1070000]);
  assert.equal(record.provenance.source_commit,provenance.source_commit);
  assert.deepEqual(record.observations,rows.map(({counts:_,commit:__,...row})=>row));
});
test('partial, mixed, unsafe or measurement-pair cohorts cannot produce a band',()=>{
  const {rows,provenance}=fixture();
  assert.throws(()=>deriveBands(rows.slice(0,1),provenance),/two complete runs/);
  assert.throws(()=>deriveBands([{...rows[0],counts:[1]},rows[1]],provenance),/incomplete columns/);
  assert.throws(()=>deriveBands([{...rows[0],commit:'c'.repeat(40)},rows[1]],provenance),/different identity/);
  assert.throws(()=>deriveBands([{...rows[0],counts:[Number.MAX_SAFE_INTEGER+1,1]},rows[1]],provenance),/safe integer/);
  assert.throws(()=>deriveBands([{...rows[0],counts:[1,1]},{...rows[1],counts:[Number.MAX_SAFE_INTEGER,1]}],provenance),/derived band is not a safe integer/);
  assert.throws(()=>deriveBands(rows,{...provenance,counter_cpu:4}),/outside CPUs 4-5/);
  assert.throws(()=>deriveBands(rows,{...provenance,measurement_lock:true}),/without the lock/);
});
test('publication authenticates its raw cohort and leaves a newer record unchanged',t=>{
  const dir=testScratch(t,'count-bands'),cohort=join(dir,'cohort.json'),origin=join(dir,'origin.json'),out=join(dir,'bands.json');
  const {rows,provenance}=fixture();writeFileSync(cohort,JSON.stringify(rows));
  const metadata={...provenance,raw_cohort_sha256:createHash('sha256').update(readFileSync(cohort)).digest('hex')};
  writeFileSync(origin,JSON.stringify(metadata));writeBands(cohort,origin,out);
  assert.equal(JSON.parse(readFileSync(out,'utf8')).columns[0].band_basis_points,1);
  writeFileSync(cohort,JSON.stringify([...rows,rows[1]]));assert.throws(()=>writeBands(cohort,origin,out),/SHA-256 disagrees/);
  writeFileSync(cohort,JSON.stringify(rows));writeFileSync(out,'{"version":2,"future":true}\n');
  assert.throws(()=>writeBands(cohort,origin,out),/unsupported existing record version 2/);
  assert.equal(readFileSync(out,'utf8'),'{"version":2,"future":true}\n');
});
