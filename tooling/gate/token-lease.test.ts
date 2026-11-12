import test from 'node:test';
import assert from 'node:assert/strict';
import {connect} from 'node:net';
import {createTokenPool} from './token-pool.ts';
import {tokenClient} from './tokens.mjs';
import {waitFor} from './test-wait.ts';

test('a lost case controller retains its token until its worker drain completes',async t=>{
  let finishDrain!:()=>void,draining!:()=>void;
  const started=new Promise<void>(resolve=>{draining=resolve;});
  const drained=new Promise<void>(resolve=>{finishDrain=resolve;});
  let completions=0;
  const pool=createTokenPool({free:()=>1-pool.total,claim:()=>0,
    completed:async request=>{if(++completions===1){assert.equal(request.answered,undefined);draining();await drained;}}});
  const address=await pool.start();assert.ok(address);t.after(()=>{finishDrain();pool.close();});
  const first=connect({host:'127.0.0.1',port:Number(address.split(':')[1])});t.after(()=>first.destroy());
  await new Promise<void>((resolve,reject)=>{first.once('error',reject);first.once('data',data=>{assert.equal(String(data),'go\n');resolve();});first.once('connect',()=>first.write(`want integrity ${process.pid} lease:lost-case json64:eyJzY29wZSI6InN0ZXAifQ\n`));});
  let granted=false;const next=tokenClient(address,'integrity').acquire({project:'tests/fixture/next'}).then(release=>{granted=true;return release;});
  await waitFor('the next case to queue',()=>pool.waiting.length===1);
  first.destroy();await started;
  assert.equal(pool.total,1);assert.equal(granted,false,'a live worker still owns this CPU token');
  finishDrain();const release=await next;assert.ok(release);release();
  await waitFor('the second case to finish',()=>pool.total===0);
});

test('normal case completion replies only after the final observation is saved',async t=>{
  let finish!:()=>void,entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const saved=new Promise<void>(resolve=>{finish=resolve;});
  const pool=createTokenPool({free:()=>1-pool.total,claim:()=>0,
    completed:async request=>{assert.equal(request.answered,true);entered();await saved;}});
  const address=await pool.start();assert.ok(address);t.after(()=>{finish();pool.close();});
  const release=await tokenClient(address,'integrity').acquire({project:'tests/fixture/final-reply'});assert.ok(release);
  let closed=false;void release.closed?.then(()=>{closed=true;});
  release();await started;
  assert.equal(closed,false);assert.equal(pool.total,1);
  finish();await release.closed;
  assert.equal(closed,true);assert.equal(pool.total,0);
});
