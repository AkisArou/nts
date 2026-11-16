import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compileCells} from './build-records.ts';
import type {BenchmarkOutcome} from './outcomes.ts';
import {caseCohort} from '../gate/case-cohort.ts';
import type {Reservation} from '../gate/memory-ledger.ts';
import {waitFor} from '../gate/test-wait.ts';

test('compile lanes quiesce before yielding and pending cells wait for normal resume',async()=>{
 const cells=['a','b','c'].map(name=>({path:'benchmarks/cases/'+name,backend:'c' as const}));
 const answers=[Promise.withResolvers<BenchmarkOutcome>(),Promise.withResolvers<BenchmarkOutcome>()];
 const started:string[]=[],events:string[]=[],paused=Promise.withResolvers<void>();let outranked=false,changed=0,grants=0,releases=0;
 const owner={inherited:true,shrink:async()=>{changed++;},grow:async()=>{changed++;}} as unknown as Reservation;
 const shared=caseCohort(owner,{},new AbortController().signal,line=>events.push(line));
 const cohort={...shared,pause:()=>{paused.resolve();return shared.pause();}};
 const running=compileCells(cells,2,async (cell):Promise<BenchmarkOutcome>=>{
  started.push(cell.path);const index=cells.findIndex(one=>one.path===cell.path);
  return index<2?answers[index]!.promise:{kind:'pass'};
 },{cohort,outranked:()=>outranked,token:async()=>{grants++;return()=>{releases++;};}});
 await waitFor('both initial compile lanes running',()=>started.length===2);
 outranked=true;answers[0]!.resolve({kind:'pass'});await paused.promise;
 assert.equal(started.length,2);assert.equal(events.length,0,'the remaining compile must drain before the shared owner yields');
 answers[1]!.resolve({kind:'pass'});
 await waitFor('compile owner yielded after its last live child',()=>events.some(line=>line.startsWith('case cohort yielded:')));
 assert.equal(started.length,2,'a pending compile cannot start while priority yields');
 outranked=false;const outcomes=await running;
 assert.deepEqual(started,cells.map(cell=>cell.path));assert.deepEqual(outcomes,[{kind:'pass'},{kind:'pass'},{kind:'pass'}]);
 assert.equal(events.filter(line=>line.startsWith('case cohort yielded:')).length,1);
 assert.equal(events.filter(line=>line.startsWith('case cohort resumed')).length,1);
 assert.equal(changed,0,'compile lanes cannot mutate an inherited parent reservation');assert.equal(grants,3);assert.equal(releases,3);
});
