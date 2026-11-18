import test from 'node:test';
import assert from 'node:assert/strict';
import {connect,createServer,Socket} from 'node:net';
import {once} from 'node:events';
import {createTokenPool} from './token-pool.ts';
import {tokenClient} from './tokens.mjs';
import {waitFor} from './test-wait.ts';
import {StepBoundClock,stepBoundWait} from './step-bound.ts';

test('a fitting later request uses admitted memory while the non-fitting head waits',async()=>{
  const head=new Socket(),light=new Socket(),grants:string[]=[];
  head.write=()=>{grants.push('head');return true;};light.write=()=>{grants.push('light');return true;};
  const pool=createTokenPool({now:()=>0,free:()=>1-pool.total,claim:()=>0,eligible:(_step,bytes)=>bytes===1});
  try{
    for(const [index,sock,bytes] of [[1,head,2],[2,light,1]] as const)
      pool.waiting.push({sock,id:index,step:'tooling',pid:1,context:'supplied queue',since:0,granted:false,gone:false,bytes});
    pool.grant();
    assert.deepEqual(grants,['light'],'strict FIFO left admitted memory idle');
    assert.equal(pool.waiting[0]?.sock,head);assert.equal(pool.total,1);
  }finally{head.destroy();light.destroy();pool.close();await pool.closed;}
});

for(const outcome of ['grant','withdraw'] as const)test(`fitting backfill has one fixed cohort against an endless light stream, then the head can ${outcome}`,async t=>{
  let width=3,headFits=false,requests=0;
  const grants:string[]=[],stop=new AbortController(),headStop=new AbortController();
  const leases:(()=>void)[]=[],pending:Promise<unknown>[]=[];
  const pool=createTokenPool({now:()=>0,free:()=>width-pool.total,claim:()=>0,
    eligible:(_step,bytes)=>headFits||bytes===1,
    observe:event=>{if(event.event==='token.request')requests++;if(event.event==='token.grant')grants.push(event.context!);}});
  const address=await pool.start();assert.ok(address);
  t.after(async()=>{stop.abort();headStop.abort();await Promise.allSettled(pending);for(const release of leases)release();pool.close();await pool.closed;});
  const client=tokenClient(address,'census');
  const acquire=(project:string,bytes:number,signal=stop.signal)=>{
    const promise=client.acquire({project},signal,bytes).then(release=>{if(release)leases.push(release);return release;});
    pending.push(promise);return promise;
  };
  const head=acquire('member-name',4,headStop.signal);
  await waitFor('the head begins waiting in a three-token pool',()=>requests===1);
  for(let index=0;index<3;index++){
    const fitting=await acquire('light-'+index,1);assert.ok(fitting);
    fitting();await fitting.closed;
    assert.equal(pool.total,0,'finished files return their leases while the head waits');
  }
  // A larger pool and arbitrarily many later arrivals cannot replenish the
  // head's allowance. Only its original three grants may pass it.
  width=100;
  const stream=Array.from({length:100},(_,index)=>acquire('stream-'+index,1));
  await waitFor('the light stream has reached the broker',()=>requests===104);
  assert.equal(grants.length,3,'the waiting head was starved by a replenished backfill allowance');
  assert.equal(pool.waiting.length,101);assert.equal(pool.total,0);
  if(outcome==='withdraw'){
    headStop.abort();assert.equal(await head,null);
    // Withdrawal exposes the next request without requiring an unrelated
    // release or scheduling timer to wake the pool.
  }else{
    headFits=true;pool.grant();
    const release=await head;assert.ok(release);
    assert.match(Buffer.from(grants[3]!.slice(7),'base64url').toString(),/member-name/);
    release();await release.closed;
  }
  const completed=await Promise.all(stream);assert.ok(completed.every(Boolean));
});

test('a backfill barrier drains running files and admits the waiting head without deadlock',async t=>{
  let headFits=false;
  const stop=new AbortController(),leases:(()=>void)[]=[],pending:Promise<unknown>[]=[];
  const pool=createTokenPool({now:()=>0,free:()=>1-pool.total,claim:()=>0,eligible:(_step,bytes)=>headFits||bytes===1});
  const address=await pool.start();assert.ok(address);
  t.after(async()=>{stop.abort();await Promise.allSettled(pending);for(const release of leases)release();pool.close();await pool.closed;});
  const client=tokenClient(address,'tooling');
  const acquire=(project:string,bytes:number)=>{
    const promise=client.acquire({project},stop.signal,bytes).then(release=>{if(release)leases.push(release);return release;});pending.push(promise);return promise;
  };
  const head=acquire('heavy',2);
  await waitFor('the heavy case waits',()=>pool.waiting.length===1);
  const light=await acquire('light',1);assert.ok(light);
  const tail=acquire('tail',1);
  await waitFor('the tail queues behind the head',()=>pool.waiting.length===2);
  headFits=true;
  light();await light.closed;
  const heavy=await head;assert.ok(heavy,'draining a running case wakes the barrier');
  assert.equal(pool.total,1);assert.equal(pool.waiting.length,1);
  heavy();await heavy.closed;
  const last=await tail;assert.ok(last);last();await last.closed;
  assert.equal(pool.total,0);
});

for(const mode of ['unsized','sized-sync','sized-async'] as const)test(`${mode} admission is observed before its client can spend the execution bound`,async()=>{
  let now=0,entered=false;
  const clock=new StepBoundClock(3,0),socket=new Socket(),events:{event:string;now:number;held?:number}[]=[];
  clock.observe(0,'memory');
  const pool=createTokenPool({free:()=>1-pool.total,claim:()=>0,now:()=>now,
    answering:()=>mode==='sized-async'?Promise.resolve():null,
    observe:event=>{if(event.event==='pool.change'){
      const held=pool.held.get('census')??0;
      const waiting=stepBoundWait({elastic:true,held,outranked:false,requests:pool.waiting.map(row=>row.bytes??1),freeSlots:1-pool.total,freeFrontends:Infinity,freeBytes:1});
      events.push({event:'runner-observes-held',now,held});clock.observe(now,waiting);
    }}});
  // A separately scheduled client may enter and spend its entire allowance
  // as soon as the acknowledgement is delivered, before the runner resumes.
  socket.write=(message:string|Uint8Array)=>{
    assert.equal(String(message),'go\n');entered=true;events.push({event:'client-enters',now});now=4000;return true;
  };
  try{
    pool.waiting.push({sock:socket,id:1,step:'census',pid:1,context:'supplied-interleaving',since:0,granted:false,gone:false,...(mode==='unsized'?{}:{bytes:1})});
    pool.grant();await Promise.resolve();
    assert.equal(entered,true);assert.equal(pool.held.get('census'),1);
    assert.deepEqual(clock.observe(now),{used_s:4,waited_s:{memory:0},expired:true});
    assert.deepEqual(events,[{event:'runner-observes-held',now:0,held:1},{event:'client-enters',now:0}]);
  }finally{socket.destroy();pool.close();await pool.closed;}
});

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

// A wait aborted after its request is sent is withdrawn, and the pool, which
// orders the withdrawal against its grant, decides: a request still waiting
// is cancelled ('withdrawn', `null`); one already granted keeps its grant,
// which the client resolves like any other. The abort below runs inside the
// pool's own token.grant observation: after the grant, before its 'go' is read.
function countedPool(open:{n:number},extra:Partial<Parameters<typeof createTokenPool>[0]>={}){
  const seen={request:0,grant:0,release:0,cancel:0},aborts:{on?:AbortController}={};
  const pool=createTokenPool({free:()=>open.n-pool.total,claim:()=>0,...extra,
    observe:event=>{
      const key=event.event.replace(/^token\./,'') as keyof typeof seen;
      if(key in seen)seen[key]++;
      if(event.event==='token.grant')aborts.on?.abort();
    }});
  return {pool,seen,aborts};
}

test('a wait aborted while its grant is in flight resolves that grant, and its withdrawal is inert',async t=>{
  let answeredAtRelease:boolean|undefined;
  const {pool,seen,aborts}=countedPool({n:1},{completed:request=>{answeredAtRelease=request.answered;}});
  const address=await pool.start();assert.ok(address);t.after(async()=>{pool.close();await pool.closed;});
  const stop=new AbortController();aborts.on=stop;
  const release=await tokenClient(address,'integrity').acquire({project:'tests/fixture/in-flight'},stop.signal);
  assert.equal(stop.signal.aborted,true,'the wait was aborted during its grant');
  assert.ok(release,'the grant that won the withdrawal reaches its caller');
  assert.deepEqual(seen,{request:1,grant:1,release:0,cancel:0});
  assert.equal(pool.total,1,'the withdrawal neither released nor cancelled the granted token');
  release();
  // The pool reads 'withdraw' before 'done' on the same connection; a socket
  // the withdrawal had ended would reject this as an ended active lease.
  await release.closed;
  await waitFor('the released token to return',()=>pool.total===0);
  assert.equal(answeredAtRelease,true,'released by its completion, after the inert withdrawal');
  assert.deepEqual(seen,{request:1,grant:1,release:1,cancel:0},'one grant, released exactly once');
});

test('a wait aborted before its grant is withdrawn: null, counted once as cancelled',async t=>{
  const open={n:0},{pool,seen}=countedPool(open);
  const address=await pool.start();assert.ok(address);t.after(async()=>{pool.close();await pool.closed;});
  const stop=new AbortController();
  const waiting=tokenClient(address,'integrity').acquire({project:'tests/fixture/waiting'},stop.signal);
  await waitFor('the request to wait',()=>pool.waiting.length===1);
  stop.abort();
  assert.equal(await waiting,null);
  await waitFor('the withdrawn connection to finish',()=>seen.cancel===1);
  open.n=1;pool.grant();
  assert.deepEqual(seen,{request:1,grant:0,release:0,cancel:1});assert.equal(pool.waiting.length,0);assert.equal(pool.total,0);
});

test('a request and its withdrawal in one write, or split across chunks, are both read',async t=>{
  const {pool,seen}=countedPool({n:0});
  const address=await pool.start();assert.ok(address);
  const port=Number(address.split(':')[1]),sockets:ReturnType<typeof connect>[]=[];
  t.after(async()=>{for(const socket of sockets)socket.destroy();pool.close();await pool.closed;});
  const answer=async(parts:string[])=>{
    const socket=connect({host:'127.0.0.1',port});sockets.push(socket);socket.setEncoding('utf8');
    let text='';const ended=new Promise<string>((resolve,reject)=>{socket.on('data',part=>{text+=part;});socket.once('end',()=>resolve(text));socket.once('error',reject);});
    await once(socket,'connect');
    for(const part of parts)await new Promise<void>((resolve,reject)=>socket.write(part,error=>error?reject(error):resolve()));
    return ended;
  };
  assert.equal(await answer([`want integrity ${process.pid} lease:one-write json64:e30\nwithdraw\n`]),'withdrawn\n');
  assert.equal(await answer(['want integ',`rity ${process.pid} lease:split json64:e30\nwith`,'draw','\n']),'withdrawn\n');
  assert.deepEqual(seen,{request:2,grant:0,release:0,cancel:2});assert.equal(pool.waiting.length,0);
});

test('a runner gone between a withdrawal and its answer leaves the wait settled at null',async t=>{
  for(const end of ['close','reset'] as const){
    const server=createServer(socket=>{socket.setEncoding('utf8');let text='';socket.on('data',part=>{
      text+=part;if(text.includes('withdraw\n'))end==='close'?socket.end():socket.resetAndDestroy();
    });});
    t.after(()=>server.close());
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const {port}=server.address() as {port:number},stop=new AbortController();
    let sent!:()=>void;const requested=new Promise<void>(resolve=>{sent=resolve;});
    server.once('connection',socket=>socket.once('data',()=>sent()));
    const waiting=tokenClient(`127.0.0.1:${port}`,'integrity').acquire({project:'tests/fixture/gone'},stop.signal);
    await requested;stop.abort();
    assert.equal(await waiting,null,`a runner that ${end}s its connection grants nothing more`);
    server.close();
  }
});

test('a sized grant pending behind its answer keeps its size until released, whichever way the answer ends',async t=>{
  for(const outcome of ['answered','failed'] as const){
    let answer!:{resolve:()=>void;reject:(error:Error)=>void};
    const {pool,seen,aborts}=countedPool({n:1},{answering:()=>new Promise<void>((resolve,reject)=>{answer={resolve,reject};})});
    const address=await pool.start();assert.ok(address);t.after(async()=>{pool.close();await pool.closed;});
    const stop=new AbortController();aborts.on=stop;
    const acquired=tokenClient(address,'integrity').acquire({project:'tests/fixture/sized'},stop.signal,1024).then(release=>({release}),error=>({error}));
    await waitFor('the sized grant',()=>seen.grant===1);
    assert.equal(stop.signal.aborted,true);
    assert.deepEqual(pool.sized.get('integrity'),{count:1,bytes:1024},'the grant holds its size while its answer is pending');
    if(outcome==='answered'){
      answer.resolve();
      const got=await acquired;assert.ok('release' in got&&got.release,'the pending grant answers the withdrawal');
      assert.equal(pool.total,1);got.release();await got.release.closed;
    }else{
      answer.reject(new Error('limit not raised'));
      const got=await acquired;assert.ok('error' in got,'the pool\'s answer stands over the withdrawal');
    }
    await waitFor(`the ${outcome} sized grant to return`,()=>pool.total===0);
    assert.deepEqual(pool.sized.get('integrity'),{count:0,bytes:0},`no size outlives the ${outcome} grant`);
    assert.deepEqual(seen,{request:1,grant:1,release:1,cancel:0});
  }
});
