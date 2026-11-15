import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {scratchRepo} from '../landing/scratch-repo.ts';
import {acceptedRevisionData} from './reader-inputs/main.ts';
import {acceptedRevision} from './accepted-revision-data.ts';
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

test('accepted main plan and record edits owe only their declared tree checks',()=>{
  for(const path of ['docs/plan.md','docs/records/notebooks/candidate.md'])
    assert.deepEqual(gateSteps(owed([{path,added:true}])),TREE_CHECKS,path);
});
