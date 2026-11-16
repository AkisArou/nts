import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRecorder} from '../records/recorder-core.ts';
import {outcomesFamily} from './outcomes-record-family.ts';
const {auditRecord}=createRecorder({outcomes:{family:outcomesFamily,steps:[],part:'core'}});
const file='tests/outcomes/private/outcome.json';
const before={run:'build',category:'refused',nts:'NTS1001 unsupported',node:'exit 0; Observed: x=1;',ran:'exit 0',measured_with:'a'.repeat(16),source:'measured'};
for(const [name,change]of [
 ['not measured',{category:'not-measured',nts:'no measurement'}],
 ['different run',{run:'check'}],
 ['changed oracle',{category:'agrees',node:'exit 0; Observed: x=2;'}],
] as const)test('the '+name+' pre-ratchet decision retains its exact refusal',()=>{
 assert.throws(()=>auditRecord('outcomes',file,JSON.stringify(before),JSON.stringify({...before,...change}),new Set()),
  error=>error instanceof assert.AssertionError&&error.message===file+' was rewritten, and the ratchet does not accept it');
});
test('an actual typed improvement still passes the same ratchet',()=>{
 assert.deepEqual(auditRecord('outcomes',file,JSON.stringify(before),JSON.stringify({...before,category:'agrees',nts:before.node}),new Set()),['tests/outcomes/private refused -> agrees (improved)']);
});
