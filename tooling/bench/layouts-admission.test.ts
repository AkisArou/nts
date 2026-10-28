import test from 'node:test';
import assert from 'node:assert/strict';
import {taskStat,interrupts} from './layouts-admission.ts';

test('offender observations retain names and raw ticks without PID reuse confusion',()=>{
 const fields=Array(40).fill('0');fields[0]='S';fields[11]='7';fields[12]='9';fields[19]='12345';fields[36]='5';
 assert.deepEqual(taskStat(12,13,'13 (worker (name)) '+fields.join(' ')),{pid:12,tid:13,comm:'worker (name)',ticks:16,birth:12345,cpu:5});
 assert.throws(()=>taskStat(1,1,'bad'));
});

test('interrupt observations use the labelled reserved columns',()=>{
 assert.deepEqual(interrupts(' CPU0 CPU4 CPU5\n238: 7 11 13 iwlwifi\nIPI: 1 3 5 timer'),{
  '238':{cpu4:11,cpu5:13,description:'iwlwifi'},IPI:{cpu4:3,cpu5:5,description:'timer'}});
 assert.throws(()=>interrupts(' CPU0 CPU1\n1: 0 1'));
});
