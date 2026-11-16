import assert from 'node:assert/strict';
import {test} from 'node:test';
import {caseCohort} from './case-cohort.ts';
import type {Reservation} from './memory-ledger.ts';

function inherited(){
 let changed=0;
 const reservation={inherited:true,shrink:async()=>{changed++;},grow:async()=>{changed++;}} as unknown as Reservation;
 return {reservation,get changed(){return changed;}};
}
test('a cohort joins all live generations before yielding and an inherited handle never changes its parent',async()=>{
 const f=inherited(),stop=new AbortController(),events:string[]=[],cohort=caseCohort(f.reservation,{},stop.signal,line=>events.push(line));
 const first=cohort.enter(),second=cohort.enter();let paused=false;
 const pause=cohort.pause();assert.equal(cohort.pause(),pause);void pause.then(()=>{paused=true;});
 assert.throws(()=>cohort.enter(),/before its priority resume/);
 first();await Promise.resolve();assert.equal(paused,false);
 second();await pause;assert.equal(f.changed,0);
 const resume=cohort.resume();assert.equal(cohort.resume(),resume);await resume;
 assert.equal(f.changed,0);cohort.enter()();assert.equal(events.length,2);
});
test('cancelling a quiescence wait joins the rejected pause without trimming a live generation',async()=>{
 const f=inherited(),stop=new AbortController(),cohort=caseCohort(f.reservation,{},stop.signal),leave=cohort.enter();
 const pending=cohort.pause();await Promise.resolve();stop.abort();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(f.changed,0);leave();
});
