import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cpuControls} from './cpu-limits.ts';

const counters='usage_usec 30\nuser_usec 20\nsystem_usec 10\nnr_periods 3\nnr_throttled 2\nthrottled_usec 40\n';
test('CPU control observations retain quota and every actual throttle counter',()=>{
  let maximum='800000 100000';
  const control=cpuControls('/owned',{identity:()=>({dev:'1',ino:'2'}),read:name=>name==='cpu.max'?maximum:counters});
  const first=control.read();assert.equal(first.quotaUsec,800000);assert.equal(first.periodUsec,100000);
  assert.equal(first.counters.nr_throttled,2);assert.equal(first.counters.throttled_usec,40);
  maximum='max 100000';assert.equal(control.read().quotaUsec,null);
});
test('a changed CPU cgroup refuses both before and during an observation',()=>{
  let ino='2';const effects={identity:()=>({dev:'1',ino}),read:()=>counters};
  const control=cpuControls('/owned',effects);ino='3';assert.throws(()=>control.read(),/identity changed/);
  ino='2';const during=cpuControls('/owned',{...effects,read:name=>{if(name==='cpu.stat')ino='4';return name==='cpu.max'?'800000 100000':counters;}});
  assert.throws(()=>during.read(),/identity changed during/);
});
test('unreadable or incomplete CPU controls refuse without a fallback',()=>{
  assert.throws(()=>cpuControls('/owned',{identity:()=>({dev:'1',ino:'2'}),read:()=>{throw Error('unreadable');}}).read(),/unreadable/);
  assert.throws(()=>cpuControls('/owned',{identity:()=>({dev:'1',ino:'2'}),read:name=>name==='cpu.max'?'800000 100000':'usage_usec 0'}).read(),/missing user_usec/);
});
