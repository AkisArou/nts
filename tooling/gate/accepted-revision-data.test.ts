import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {scratchRepo} from '../landing/scratch-repo.ts';
import {acceptedRevisionData,acceptedRevision} from './accepted-revision-data.ts';
import {gateSteps,owed,TREE_CHECKS} from './owed.mjs';

const plan=acceptedRevisionData(new URL('../../docs/plan.md',import.meta.url));
const records=acceptedRevisionData(new URL('../../docs/records/',import.meta.url));

test('accepted revision show and grep retain main blobs across dirty and committed candidate edits',t=>{
  const s=scratchRepo(t,'accepted-revision-data');
  s.commit({'docs/plan.md':'main plan\n','docs/records/receipt.md':'main receipt\n'},'main inputs');
  const main=s.git(['rev-parse','main']).trim(),reader=acceptedRevision(s.root);
  assert.ok(!('error' in reader));assert.equal(reader.revision,main);
  assert.equal(reader.show(plan),'main plan\n');assert.equal(reader.grep(records,'absent'),'');
  writeFileSync(join(s.root,'docs/plan.md'),'dirty plan\n');
  writeFileSync(join(s.root,'docs/records/receipt.md'),'dirty receipt\n');
  assert.equal(reader.show(plan),'main plan\n');assert.equal(reader.grep(records,'receipt'),'main receipt\n');
  s.git(['switch','-qc','candidate']);
  s.commit({'docs/plan.md':'candidate plan\n','docs/records/receipt.md':'candidate receipt\n'},'candidate inputs');
  assert.equal(reader.show(plan),'main plan\n');assert.equal(reader.grep(records,'receipt'),'main receipt\n');
  const fresh=acceptedRevision(s.root);assert.ok(!('error' in fresh));
  assert.notEqual(s.git(['rev-parse','HEAD']).trim(),fresh.revision);
  assert.equal(fresh.grep(records,'receipt'),'main receipt\n');
  s.git(['update-ref','-d','refs/heads/main']);
  const missing=acceptedRevision(s.root);assert.ok('error' in missing&&missing.error.length>0);
});

test('accepted revision files returns whole matching main blobs by path, never candidate edits',t=>{
  const s=scratchRepo(t,'accepted-revision-files');
  s.commit({'docs/records/a.md':'one\nneedle here\nthree\n','docs/records/sub/b.md':'needle\n','docs/records/c.md':'nothing\n'},'main records');
  const reader=acceptedRevision(s.root);assert.ok(!('error' in reader));
  const whole=[{path:'docs/records/a.md',text:'one\nneedle here\nthree\n'},{path:'docs/records/sub/b.md',text:'needle\n'}];
  assert.deepEqual(reader.files(records,'needle'),whole);
  assert.deepEqual(reader.files(records,'absent'),[],'no match is a measured empty set');
  writeFileSync(join(s.root,'docs/records/c.md'),'needle in a working edit\n');
  assert.deepEqual(reader.files(records,'needle'),whole);
  s.git(['switch','-qc','candidate']);s.commit({'docs/records/c.md':'needle on a candidate\n'},'candidate');
  assert.deepEqual(reader.files(records,'needle'),whole);
  assert.ok('error' in reader.files(records,'('),'an invalid pattern is an error, not an empty set');
});

test('accepted main plan and record edits owe only their declared tree checks',()=>{
  for(const path of ['docs/plan.md','docs/records/notebooks/candidate.md'])
    assert.deepEqual(gateSteps(owed([{path,added:true}])),TREE_CHECKS,path);
});
