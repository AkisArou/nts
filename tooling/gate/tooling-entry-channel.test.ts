import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ToolingEntryEvidence,type ToolingEntryFrame} from './tooling-entry-channel.ts';

const frame=(sequence:number,event:ToolingEntryFrame['event'],fields:Partial<ToolingEntryFrame>={}):ToolingEntryFrame=>
  ({version:1,nonce:'owned',file:'/owned.test.ts',pid:42,sequence,event,...fields});
test('private entry evidence authenticates identity and ordering before retaining assertions',()=>{
  for(const foreign of [{nonce:'forged'},{pid:43},{file:'/foreign.test.ts'},{sequence:2}]){
    const evidence=new ToolingEntryEvidence('/owned.test.ts','owned',42);
    assert.throws(()=>evidence.accept(frame(1,'ready',foreign)),/foreign identity or sequence/);
    assert.equal(evidence.ready,false);assert.equal(evidence.completedFailures,0);
  }
  const evidence=new ToolingEntryEvidence('/owned.test.ts','owned',42);
  evidence.accept(frame(1,'ready'));evidence.accept(frame(2,'start',{id:1,name:'assertion'}));
  evidence.accept(frame(3,'complete',{id:1,name:'assertion',failed:true}));
  assert.equal(evidence.completedFailures,1);assert.equal(evidence.open.size,0);
  evidence.seal();
  assert.throws(()=>evidence.accept(frame(4,'complete',{id:2,name:'late assertion',failed:true})),/after termination/);
  assert.equal(evidence.completedFailures,1);
});
test('entry readiness cannot be replaced by a partial or malformed test report',()=>{
  const evidence=new ToolingEntryEvidence('/owned.test.ts','owned',42);
  assert.throws(()=>evidence.accept(frame(1,'complete',{id:1,name:'unstarted',failed:false})),/missing entry/);
  evidence.accept(frame(1,'ready'));
  assert.throws(()=>evidence.accept(frame(2,'ready')),/duplicate/);
  assert.throws(()=>evidence.accept(frame(2,'complete',{id:1,name:'missing verdict'})),/missing completed assertion/);
  assert.equal(evidence.completedFailures,0);
});
