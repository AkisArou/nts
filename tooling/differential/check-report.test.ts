import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkArguments} from './check-report.ts';
test('the owner passes one explicit prepared oracle through the command authority',()=>{
  assert.deepEqual(checkArguments('json-v1','project','owned/manifest.json'),['check','project','--json','--oracle-prepared','owned/manifest.json']);
  assert.deepEqual(checkArguments('json-v1','project'),['check','project','--json']);
  assert.deepEqual(checkArguments('legacy','project','owned/manifest.json'),['check','project','--oracle-prepared','owned/manifest.json']);
});
