import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RECORD_FAMILIES,recorder} from './record-pending.ts';
import {createRecorderCommand} from './recorder-command.ts';
import {createRecorder,type RecordTable} from './recorder-core.ts';
const expected=['oracle-counts','typescript','test262','benchmarks','benchmark-runs','outcomes','dex','compile-times','type-checks','rust-selector','memory-census'];
function complete(table:RecordTable):void{assert.deepEqual(Object.keys(table),expected);for(const row of Object.values(table))for(const name of ['pending','files','runs','audit','records','rows','changes','validate','merge','sourceDigests'] as const)assert.equal(typeof row.family[name],'function');}
test('the production composition retains every family in recording order',()=>{complete(RECORD_FAMILIES);assert.deepEqual(recorder.KINDS,expected);assert.deepEqual(RECORD_FAMILIES['type-checks'].steps,['tooling-types']);assert.equal(recorder.partOf('type-checks'),'core');});
test('dropping a production family is detected, and its delta cannot enter a smaller recorder',()=>{
 const {outcomes:omitted,...rest}=RECORD_FAMILIES;assert.ok(omitted);assert.throws(()=>complete(rest),assert.AssertionError);
 const small=createRecorder(rest);
 return assert.rejects(()=>small.applyDelta('.', {version:1,commit:null,headers:{},rows:[{kind:'outcomes',record:'tests/outcomes/one/outcome.json',case:'tests/outcomes/one',key:'tests/outcomes/one',before:null,after:'{}',sources:'a'.repeat(64)}]}),/no recorder is of kind outcomes/);
});

test('command construction requires its supplied sealed context',()=>{assert.throws(()=>createRecorderCommand(RECORD_FAMILIES,{}),/oracle|sealed/i);});
