import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertProcessGroupIdentity} from './process-group.ts';

test('a spawn-owned group keeps its birth identity and tolerates its exited leader',()=>{
  const birth={group:71,session:71,started:190};
  assert.doesNotThrow(()=>assertProcessGroupIdentity(71,birth,{...birth}));
  assert.doesNotThrow(()=>assertProcessGroupIdentity(71,birth,undefined));
});

test('a reused PID, a changed group and a changed session independently refuse signalling',()=>{
  const birth={group:71,session:71,started:190};
  for(const current of [{...birth,started:191},{...birth,group:72},{...birth,session:72}])
    assert.throws(()=>assertProcessGroupIdentity(71,birth,current),/refusing to stop a changed command group/);
});
