import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {testScratch} from '../gate/test-scratch.ts';
import {withBuildLock} from './pin-lock.ts';

test('a fixed wall clock cannot prevent a held pin lock reaching its monotonic timeout',t=>{
  const lock=join(testScratch(t,'pin-lock-clock'),'lock');mkdirSync(lock);writeFileSync(join(lock,'pid'),String(process.pid));
  let now=0;
  assert.throws(()=>withBuildLock(()=>assert.fail('held'),{lock,wait:1000,host:{wallNow:()=>0,now:()=>now++*1000}}),/pin tree is held.*waited 2 s/);
  assert.ok(existsSync(lock));
});

test('an unchanged pidless lock expires by monotonic age under a fixed wall clock',t=>{
  const lock=join(testScratch(t,'pin-lock-orphan'),'lock');mkdirSync(lock);
  let now=0;
  assert.equal(withBuildLock(()=>42,{lock,host:{wallNow:()=>0,now:()=>now++*60001}}),42);
  assert.equal(existsSync(lock),false);
});
