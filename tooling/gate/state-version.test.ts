import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {assertStateVersion,assertWritableState,futureStateVersion,FutureStateVersionError} from './state-version.ts';
import {versionedRecord,withStateLock} from './state-file.ts';
import {readCostHistory,writeCostHistory,unitReservation,caseHistoryFile,caseMemoryKey,readCaseHistory,writeCaseHistory,caseReservation} from './step-scheduling.ts';
import {STEP_CPU_MEASURE} from './step-time.ts';
import {emptyState,readState,writeState} from '../full-check/state.ts';
import {newJob,readOutcome,writeOutcome,start,type Units} from '../full-check/background.ts';
import {readLandingCosts} from '../landing/selection.ts';
import {recordCosts} from '../landing/service.ts';
import {claimRunOwner,reapRunOwner} from './scopes/run-owner.ts';
import {testScratch} from './test-scratch.ts';

const json=(value:unknown)=>JSON.stringify(value)+'\n';

test('a future header is distinct from absent, malformed and supported data',t=>{
 const root=testScratch(t,'state-version'),file=join(root,'state.json');
 assertWritableState(file,1);
 for(const value of [null,[],{}, {version:'2'}, {version:1}, {version:-1}, {version:1.5}])assert.equal(futureStateVersion(value,1,file),undefined);
 writeFileSync(file,'{ half');assertWritableState(file,1);
 const text='{ "version": 2, "unknown": {"must":"survive"} }\n';writeFileSync(file,text);
 assert.throws(()=>assertWritableState(file,1),FutureStateVersionError);
 assert.throws(()=>assertStateVersion({version:2},1,file),/unsupported future state version 2.*supports through 1/);
 assert.equal(readFileSync(file,'utf8'),text);
});

test('guarded durable publication cannot downgrade future bytes, including nested owner operations',t=>{
 const root=testScratch(t,'state-publication'),file=join(root,'state.json'),lock=join(root,'owner');
 versionedRecord(file,1,{version:1,kept:true},lock);
 withStateLock(lock,()=>versionedRecord(file,1,{version:1,updated:true},lock));
 const newer=json({version:2,extra:'untouched'});writeFileSync(file,newer);
 assert.throws(()=>versionedRecord(file,1,{version:1},lock),FutureStateVersionError);
 assert.equal(readFileSync(file,'utf8'),newer);
});

test('v5 history readers name a v6 read-only view and both publications leave its bytes intact',t=>{
 const root=testScratch(t,'history-future'),file=join(root,'steps.json'),warnings:string[]=[];
 const future='{ "version": 6, "steps": {"new-format":"opaque"}, "jobs": {}, "future": true }\n';writeFileSync(file,future);
 const history=readCostHistory(file,line=>warnings.push(line));
 assert.equal(history.steps.size,0);assert.equal(history.jobs.size,0);assert.ok(history.unsupportedVersion);
 assert.match(warnings.join('\n'),/unsupported future state version 6/);
 for(const observed of [{steps:[{name:'tests',verdict:'PASS',cpu:9,cpu_measure:STEP_CPU_MEASURE,memory:{unit:'step' as const,peak:1024}}]},
   {jobs:[{key:'landing-build',basis:'worker' as const,width:1,peak:2048}]}]){
  assert.match(writeCostHistory(file,observed)??'',/future state version 6/);assert.equal(readFileSync(file,'utf8'),future);
 }
});

test('supported v3 memory migrates, and a stale controller cannot erase a newer runner history',t=>{
 const root=testScratch(t,'history-mixed'),file=join(root,'steps.json'),peak=200*2**20;
 writeFileSync(file,json({version:3,steps:{tests:{cpu:1,memory:{unit:'step',peaks:[peak]}}},jobs:{}}));
 const before=readCostHistory(file);assert.equal(unitReservation(before,{step:'tests'},'step',0).bytes,250*2**20);
 assert.equal(writeCostHistory(file,{jobs:[{key:'landing-build',basis:'worker' as const,width:1,peak:20*2**20}]}),undefined);
 const migrated=JSON.parse(readFileSync(file,'utf8'));assert.equal(migrated.version,5);assert.deepEqual(migrated.steps.tests.memory.peaks,[peak]);
 const current=readCostHistory(file);assert.equal(unitReservation(current,{step:'tests'},'step',0).bytes,250*2**20);
 // Runner publishes a new version after the old controller read its view.
 const future=json({...migrated,version:6,runner:'new'});writeFileSync(file,future);
 assert.match(writeCostHistory(file,{jobs:[{key:'landing-build',basis:'worker' as const,width:1,peak:30*2**20}]})??'',/future state version 6/);
 assert.equal(readFileSync(file,'utf8'),future);
});


test('future full-check state and outcomes refuse read, overwrite and restart deletion',t=>{
 const root=testScratch(t,'controller-future'),state=join(root,'state.json'),outcome=join(root,'outcome.json');
 const future='{ "version": 2, "unrecognized": "preserved" }\n';
 for(const [file,read,write] of [[state,()=>readState(state),()=>writeState(state,emptyState())],
   [outcome,()=>readOutcome(outcome),()=>writeOutcome(outcome,{status:0})]] as const){
  writeFileSync(file,future);assert.throws(read,/future state version 2/);assert.throws(write,/future state version 2/);
  assert.equal(readFileSync(file,'utf8'),future);
 }
 let called=false;const units:Units={start(){called=true;return null;},running:()=>false};
 const job=newJob('future-job',outcome,new Date(0));
 assert.throws(()=>start(units,{name:job.unit,cwd:root,command:['unused'],log:join(root,'log')},job,()=>{called=true;}),/future state version 2/);
 assert.equal(called,false);assert.equal(readFileSync(outcome,'utf8'),future);
});

test('future landing costs give a named empty view and refuse a later stale write',t=>{
 const root=testScratch(t,'landing-costs-future'),file=join(root,'costs.json'),warnings:string[]=[];
 const future='{ "version": 3, "steps": "new-format" }\n';writeFileSync(file,future);
 assert.equal(readLandingCosts(file,line=>warnings.push(line)).size,0);assert.match(warnings.join('\n'),/future state version 3/);
 assert.throws(()=>recordCosts(root,{state:'green',message:'control',run:root,steps:[],pending:[],wall_s:0},'other'),/future state version 3/);
 assert.equal(readFileSync(file,'utf8'),future);
});

test('future run ownership refuses claiming, reaping, completion and close',t=>{
 const root=testScratch(t,'run-owner-future'),file=join(root,'owner.json');
 const owner=claimRunOwner(file,'nts-tooling-'+ 'a'.repeat(32)+'.slice',()=>assert.fail('unexpected reap'));
 const future='{ "version": 2, "new-owner": true }\n';writeFileSync(file,future);
 for(const action of [()=>reapRunOwner(file,()=>assert.fail('unexpected reap')),
   ()=>claimRunOwner(file,'unused',()=>assert.fail('unexpected reap')),
   ()=>owner.complete({group:'/unused',device:'1',inode:'1'}),()=>owner.close()]){
  assert.throws(action,/future state version 2/);assert.equal(readFileSync(file,'utf8'),future);
 }
});


test('v2 case history keeps its measured migration and a v3 file survives reads and publication',t=>{
 const root=testScratch(t,'case-history-future'),env={NTS_GATE_COSTS_DIR:root};
 const file=caseHistoryFile('program-oracles',env),legacy=join(root,'cases/program-oracles.json');
 mkdirSync(join(root,'cases'));const path='tests/programs/control',key=caseMemoryKey({step:'program-oracles',backend:'node',path});
 const old=json({version:1,cases:{[path]:[200*2**20]}});writeFileSync(legacy,old);
 assert.equal(caseReservation(readCaseHistory(file),key),250*2**20);
 assert.equal(writeCaseHistory(file,[{key,peak:300*2**20}]),undefined);
 assert.equal(JSON.parse(readFileSync(file,'utf8')).version,2);
 assert.equal(readFileSync(legacy,'utf8'),old,'migration never rewrites the old namespace');
 assert.equal(caseReservation(readCaseHistory(file),key),375*2**20);
 const future='{ "version": 3, "cases": "new-format", "opaque": true }\n',warnings:string[]=[];
 writeFileSync(file,future);assert.equal(readCaseHistory(file,line=>warnings.push(line)).size,0);
 assert.match(warnings.join('\n'),/future state version 3/);
 assert.match(writeCaseHistory(file,[{key,peak:400*2**20}])??'',/future state version 3/);
 assert.equal(readFileSync(file,'utf8'),future);assert.equal(readFileSync(legacy,'utf8'),old);
});
