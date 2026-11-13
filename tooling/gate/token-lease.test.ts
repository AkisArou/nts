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
  const address=await pool.start();assert.ok(address);t.after(async()=>{finishDrain();first.destroy();pool.close();await pool.closed;});
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
  const address=await pool.start();assert.ok(address);t.after(async()=>{finish();release?.();pool.close();await pool.closed;});
  const release=await tokenClient(address,'integrity').acquire({project:'tests/fixture/final-reply'});assert.ok(release);
  let closed=false;void release.closed?.then(()=>{closed=true;});
  release();await started;
  assert.equal(closed,false);assert.equal(pool.total,1);
  finish();await release.closed;
  assert.equal(closed,true);assert.equal(pool.total,0);
});

test('cancellation refuses acquisition while keeping retirement replies and final cleanup alive',async t=>{
  let saved!:()=>void,entered!:()=>void,retired=false;
  const final=new Promise<void>(resolve=>{saved=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  const pool=createTokenPool({free:()=>1-pool.total,claim:()=>0,now:()=>0,
    retire:(request,group)=>{assert.equal(request.lease,'owned-case');assert.equal(group,'/owned/worker');retired=true;},
    completed:async()=>{entered();await final;}});
  const address=await pool.start();assert.ok(address);
  const port=Number(address.split(':')[1]);
  const sockets:ReturnType<typeof connect>[]=[];
  t.after(async()=>{saved();for(const socket of sockets)socket.destroy();pool.close();await pool.closed;});
  const request=(line:string)=>new Promise<string>((resolve,reject)=>{
    const socket=connect({host:'127.0.0.1',port});sockets.push(socket);socket.once('error',reject);
    socket.once('connect',()=>socket.write(line+'\n'));socket.once('data',bytes=>{resolve(String(bytes));});
  });
  assert.equal(await request(`want integrity ${process.pid} lease:owned-case`),'go\n');
  pool.cancel();
  assert.equal(await request(`want integrity ${process.pid} lease:too-late`),'error: token pool is shutting down\n');
  assert.equal(await request('retire owned-case /owned/worker'),'ready\n');assert.equal(retired,true);
  for(const socket of sockets.slice(1))socket.end();
  let closed=false;void pool.closed.then(()=>{closed=true;});pool.close();
  sockets[0]!.end('done\n');await started;
  assert.equal(closed,false,'server shutdown cannot bypass the final case observation');
  saved();await pool.closed;assert.equal(pool.total,0);assert.equal(closed,true);
});
