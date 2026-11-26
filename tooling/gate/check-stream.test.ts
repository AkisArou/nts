import assert from 'node:assert/strict';
import {test} from 'node:test';
import {connect,type Socket} from 'node:net';
import {once} from 'node:events';
import {join} from 'node:path';
import {readdirSync,statSync,fstatSync,readFileSync,writeFileSync,unlinkSync,rmSync} from 'node:fs';
import {gunzipSync,gzipSync} from 'node:zlib';
import {CheckStream,CHECK_CAPABILITY} from './check-stream.ts';
import {testScratch,newTestScratch} from './test-scratch.ts';
import {caseCostSessions} from '../differential/case-cost-records.ts';
import {durableRecordStream} from './durable-record.ts';

async function fixture(t:{after(fn:()=>void|Promise<void>):void}){
  const root=newTestScratch('check-stream'),costs=join(root,'costs'),tmp=join(root,'long-run-directory-'.repeat(8),'tmp');
  const stream=new CheckStream(costs,tmp);t.after(async()=>{try{await stream.close();}finally{rmSync(root,{recursive:true,force:true});}});await stream.ready;
  return {root,costs,tmp,stream};
}
async function client(path:string):Promise<Socket>{const socket=connect(path);await once(socket,'connect');socket.resume();return socket;}
const header=(capability:string,pid=42,step='examples')=>({kind:'check.producer',step,pid,capability});
async function register(socket:Socket,value:unknown){
  const ready=once(socket,'data');socket.write(JSON.stringify(value)+'\n');assert.equal(String((await ready)[0]),'ready\n');
}
const records=(pid=42)=>[{event:'case',session:0,pid,step:'examples',project:'fixture'},
  {event:'begin',session:0,phase:'check.total',epoch:1},
  {event:'end',session:0,phase:'capture',epoch:2,wall_s:.5},
  {event:'end',session:0,phase:'check.total',epoch:3,wall_s:2}];
async function send(path:string,rows:unknown[]){
  const socket=await client(path),closed=once(socket,'close');socket.end(rows.map(row=>JSON.stringify(row)).join('\n')+'\n');await closed;
}

test('many standalone producers share one durable gzip stream and long tmp paths work',async t=>{
  const f=await fixture(t),env=f.stream.environment('examples',()=>Array.from({length:100},(_,n)=>n+1));
  assert.equal(statSync(join(f.tmp,'checks.sock')).mode&0o777,0o600);
  for(let pid=1;pid<=100;pid++)await send(f.stream.path,[header(env[CHECK_CAPABILITY]!,pid),...records(pid)]);
  await f.stream.reaped('examples');await f.stream.close();assert.deepEqual(f.stream.errors,[]);
  assert.deepEqual(readdirSync(f.costs),['check-worker-0.jsonl.gz']);
  const errors:string[]=[],sessions=[];for await(const session of caseCostSessions(f.costs,errors))sessions.push(session);
  assert.deepEqual(errors,[]);assert.equal(sessions.length,100);assert.deepEqual(sessions[0]!.rows,records(1));
});

test('wrong, crossed, finished and out-of-scope producer claims are refused by name',async t=>{
  const f=await fixture(t),a=f.stream.environment('examples',()=>[42]),b=f.stream.environment('llvm',()=>[42]);
  for(const row of [header('unknown'),header(a[CHECK_CAPABILITY]!,99),header(b[CHECK_CAPABILITY]!),header(a[CHECK_CAPABILITY]!,42,'llvm')]){
    const socket=await client(f.stream.path),closed=once(socket,'close');socket.write(JSON.stringify(row)+'\n');await closed;
  }
  await f.stream.reaped('examples');
  const socket=await client(f.stream.path),closed=once(socket,'close');socket.write(JSON.stringify(header(a[CHECK_CAPABILITY]!))+'\n');await closed;
  assert.equal(f.stream.errors.length,5);assert.match(f.stream.errors.join('\n'),/outside its dispatched step/);
  assert.match(f.stream.errors.join('\n'),/crossed or reaped/);
});

test('duplicate live producers never merge; sent partial phases survive EOF',async t=>{
  const f=await fixture(t),env=f.stream.environment('examples',()=>[42]);
  const first=await client(f.stream.path);t.after(()=>first.destroy());
  await register(first,header(env[CHECK_CAPABILITY]!));
  first.write(records().slice(0,-1).map(row=>JSON.stringify(row)).join('\n')+'\n');
  const duplicate=await client(f.stream.path),closed=once(duplicate,'close');duplicate.write(JSON.stringify(header(env[CHECK_CAPABILITY]!))+'\n');await closed;
  const ended=once(first,'close');first.end();await ended;
  await f.stream.reaped('examples');await f.stream.close();
  assert.match(f.stream.errors.join('\n'),/duplicate live producer/);assert.match(f.stream.errors.join('\n'),/no completed check.total/);
  const rows=gunzipSync(readFileSync(join(f.costs,'check-worker-0.jsonl.gz'))).toString().trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(rows.length,3);assert.equal(rows.at(-1).record.phase,'capture');
});

test('a live connection at step reap is named and closed without a drain timeout',async t=>{
  const f=await fixture(t),env=f.stream.environment('examples',()=>[42]),socket=await client(f.stream.path);t.after(()=>socket.destroy());
  await register(socket,header(env[CHECK_CAPABILITY]!));
  socket.write(records().map(row=>JSON.stringify(row)).join('\n')+'\n');
  const closed=once(socket,'close');await f.stream.reaped('examples');await closed;
  assert.match(f.stream.errors.join('\n'),/still open after examples was reaped/);
});

test('truncated gzip and incomplete publication cannot silently become complete telemetry',async t=>{
  const f=await fixture(t);await f.stream.close();
  const path=join(f.costs,'check-worker-0.jsonl.gz');
  const bytes=gzipSync(records().map(record=>JSON.stringify({producer:1,pid:42,record})).join('\n')+'\n');
  writeFileSync(path,bytes.subarray(0,bytes.length-4));
  writeFileSync(path+'.999.partial','unfinished');
  const errors:string[]=[];for await(const _ of caseCostSessions(f.costs,errors)){/* consume checked EOF */}
  assert.match(errors.join('\n'),/unexpected end|buffer error/i);assert.match(errors.join('\n'),/incomplete check publication/);
});

test('a publication write failure disables subsequent appends even if the writer recovers',async t=>{
  const root=testScratch(t,'check-stream-failure');let calls=0;
  const stream=new CheckStream(join(root,'costs'),join(root,'tmp'),(path,produce,options)=>durableRecordStream(path,append=>produce(async chunk=>{
    if(++calls===2)throw Error('injected stream write failure');await append(chunk);
  }),options));t.after(()=>stream.close());await stream.ready;
  const env=stream.environment('examples',()=>[42]);await send(stream.path,[header(env[CHECK_CAPABILITY]!),...records()]);
  await stream.reaped('examples');await stream.close();
  assert.equal(calls,2,'no later append may recover a poisoned output');assert.match(stream.errors.join('\n'),/injected stream write failure/);
});

for(const kind of ['reject','throw'] as const)test('publication failure before producer entry rejects readiness and closes its directory descriptor: '+kind,async t=>{
  const root=newTestScratch('check-stream-startup-failure');
  const stream=new CheckStream(join(root,'costs'),join(root,'tmp'),()=>{
    const error=Error('injected publication startup failure');
    if(kind==='throw')throw error;return Promise.reject(error);
  });
  t.after(async()=>{try{await stream.close();}finally{rmSync(root,{recursive:true,force:true});}});
  const descriptor=Number(/\/fd\/(\d+)\/checks\.sock$/.exec(stream.path)![1]);
  assert.ok(fstatSync(descriptor).isDirectory());
  await assert.rejects(stream.ready,/injected publication startup failure/);
  await stream.close();
  assert.throws(()=>fstatSync(descriptor),{code:'EBADF'});
  assert.match(stream.errors.join('\n'),/publication failed.*injected publication startup failure/);
});

test('transport readiness waits for publication producer entry',async t=>{
  const root=newTestScratch('check-stream-startup-barrier');let enter!:()=>void;
  const barrier=new Promise<void>(resolve=>{enter=resolve;});
  const stream=new CheckStream(join(root,'costs'),join(root,'tmp'),async(path,produce,options)=>{
    await barrier;return durableRecordStream(path,produce,options);
  });
  t.after(async()=>{enter();try{await stream.close();}finally{rmSync(root,{recursive:true,force:true});}});
  let ready=false;void stream.ready.then(()=>{ready=true;});
  const socket=await client(stream.path),closed=once(socket,'close');
  assert.equal(ready,false,'a listening socket alone cannot admit a measured compiler');
  socket.end();await closed;enter();await stream.ready;await stream.close();
  assert.deepEqual(stream.errors,[]);
});

test('socket preparation failure rejects readiness and closes its directory descriptor',async t=>{
  const root=newTestScratch('check-stream-socket-failure'),temporary=join(root,'tmp');
  const stream=new CheckStream(join(root,'costs'),temporary);
  t.after(async()=>{try{await stream.close();}finally{rmSync(root,{recursive:true,force:true});}});
  const descriptor=Number(/\/fd\/(\d+)\/checks\.sock$/.exec(stream.path)![1]);
  // Unix bind creates the entry synchronously; permission setup follows on
  // listening. Remove only this fixture's socket before that callback runs.
  unlinkSync(join(temporary,'checks.sock'));
  await assert.rejects(stream.ready,{code:'ENOENT'});
  await stream.close();assert.throws(()=>fstatSync(descriptor),{code:'EBADF'});
  assert.match(stream.errors.join('\n'),/listener preparation failed/);
});

test('publication preserves original row bytes and signed-zero double bits',async t=>{
  const f=await fixture(t),env=f.stream.environment('examples',()=>[42]);
  const socket=await client(f.stream.path);await register(socket,header(env[CHECK_CAPABILITY]!));
  const rows=records().map(row=>JSON.stringify(row));
  rows[2]='{"event":"end", "session":0,"phase":"capture","epoch":2,"wall_s":-0}';
  const closed=once(socket,'close');socket.end(rows.join('\n')+'\n');await closed;
  await f.stream.reaped('examples');await f.stream.close();
  const output=gunzipSync(readFileSync(join(f.costs,'check-worker-0.jsonl.gz'))).toString();
  assert.ok(output.includes(rows[2]!));
  const errors:string[]=[];for await(const session of caseCostSessions(f.costs,errors))assert.ok(Object.is(session.rows[2]!.wall_s,-0));
  assert.deepEqual(errors,[]);
});

test('reap consumes a departed producer tail spanning many kernel reads through EOF',async t=>{
  const f=await fixture(t),env=f.stream.environment('examples',()=>[42]),socket=await client(f.stream.path);
  t.after(()=>socket.destroy());await register(socket,header(env[CHECK_CAPABILITY]!));
  const rows=[...records().slice(0,-1),...Array.from({length:80},()=>({event:'observation',session:0,padding:'x'.repeat(60*1024)})),records().at(-1)];
  const finished=once(socket,'finish'),closed=once(socket,'close');socket.end(rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
  await finished;await f.stream.reaped('examples');await closed;await f.stream.close();
  assert.deepEqual(f.stream.errors,[]);
  const errors:string[]=[],sessions=[];for await(const session of caseCostSessions(f.costs,errors))sessions.push(session);
  assert.deepEqual(errors,[]);assert.equal(sessions.length,1);assert.equal(sessions[0]!.rows.length,rows.length);
});
