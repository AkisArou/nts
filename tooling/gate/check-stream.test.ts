import assert from 'node:assert/strict';
import {test} from 'node:test';
import {connect,type Socket} from 'node:net';
import {once} from 'node:events';
import {join} from 'node:path';
import {createReadStream,existsSync,readdirSync,statSync,fstatSync,readFileSync,writeFileSync,unlinkSync,rmSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {createGunzip,gunzipSync,gzipSync} from 'node:zlib';
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
  assert.equal(existsSync(join(root,'costs/check-worker-0.jsonl.gz')),false,'a write failure cannot publish a valid truncated prefix');
});

test('backpressure bounds pending publication and preserves every byte after a stalled writer resumes',async t=>{
  const root=newTestScratch('check-stream-backpressure'),costs=join(root,'costs'),high=8*1024*1024;
  let release!:()=>void,peak=0;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  const sockets:Socket[]=[],closed:Promise<unknown>[]=[],expected=new Map<number,string[]>();
  // Optional only for the committed old-owner control: its implementation
  // aborts instead, so the named error terminates the state barrier below.
  let stream:CheckStream&{readonly pendingBytes?:number;readonly backpressured?:boolean;readonly pausedProducers?:number;readonly producerConnections?:number};
  const sample=()=>{if(stream.pendingBytes!==undefined){peak=Math.max(peak,stream.pendingBytes);assert.ok(stream.pendingBytes<=high,'pending appends must not overshoot the high-water mark');}};
  stream=new CheckStream(costs,join(root,'tmp'),(path,produce,options)=>durableRecordStream(path,append=>produce(async chunk=>{
    sample();await blocked;await append(chunk);sample();
  }),options));
  t.after(async()=>{release();for(const socket of sockets)socket.destroy();try{await stream.close();}finally{rmSync(root,{recursive:true,force:true});}});
  await stream.ready;const pids=Array.from({length:24},(_,index)=>index+1),env=stream.environment('examples',()=>pids);
  for(const pid of pids){const socket=await client(stream.path);sockets.push(socket);await register(socket,header(env[CHECK_CAPABILITY]!,pid));}
  let offered=0;
  for(const [index,socket] of sockets.entries()){
    const pid=pids[index]!,rows=records(pid),lines=[...rows.slice(0,-1),...Array.from({length:40},(_,row)=>({event:'observation',session:0,row,padding:'x'.repeat(64*1024)})),rows.at(-1)].map(row=>JSON.stringify(row));
    lines[2]=lines[2]!.replace('"wall_s":0.5','"wall_s":-0');expected.set(pid,lines);
    const payload=lines.join('\n')+'\n';offered+=Buffer.byteLength(payload);closed.push(once(socket,'close'));socket.end(payload);
  }
  assert.ok(offered>7*high,'offered producer data is far beyond the runner queue');
  const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
  // IO/state barriers decide the assertions; the scoped tooling hang guard
  // alone bounds a broken fixture. No elapsed time decides backpressure.
  while(!stream.backpressured&&!stream.errors.length)await turn();
  assert.deepEqual(stream.errors,[]);assert.equal(stream.backpressured,true);assert.ok(stream.producerConnections!>0);assert.equal(stream.pausedProducers,stream.producerConnections);
  let reaped=false;const draining=stream.reaped('examples').then(()=>{reaped=true;});
  for(let poll=0;poll<100;poll++){await turn();sample();assert.equal(stream.backpressured,true);assert.equal(stream.pausedProducers,stream.producerConnections);assert.equal(reaped,false);}
  release();await Promise.all(closed);await draining;await stream.close();sample();
  assert.deepEqual(stream.errors,[]);assert.equal(stream.pendingBytes,0);
  const actual=new Map<number,string[]>();
  for await(const line of createInterface({input:createReadStream(join(costs,'check-worker-0.jsonl.gz')).pipe(createGunzip()),crlfDelay:Infinity})){
    const match=/^\{"producer":(\d+),"pid":(\d+),"record":(.*)\}$/.exec(line);assert.ok(match);
    const pid=Number(match[2]);assert.equal(Number(match[1]),pid);
    const rows=actual.get(pid)??[];rows.push(match[3]!);actual.set(pid,rows);
  }
  assert.deepEqual(actual,expected,'every producer retains every original row byte, including signed zero');
  t.diagnostic('stalled publication '+JSON.stringify({offeredBytes:offered,highWaterBytes:high,peakPendingBytes:peak,producers:24,rows:[...actual.values()].reduce((sum,rows)=>sum+rows.length,0)}));
});

test('an actual append failure releases paused producers and still poisons publication',async t=>{
  const root=newTestScratch('check-stream-paused-failure'),costs=join(root,'costs');let release!:()=>void,calls=0;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  const stream=new CheckStream(costs,join(root,'tmp'),(path,produce,options)=>durableRecordStream(path,()=>produce(async()=>{
    calls++;await blocked;throw Error('injected write failure while paused');
  }),options));
  let socket:Socket|undefined;
  t.after(async()=>{release();socket?.destroy();try{await stream.close();}finally{rmSync(root,{recursive:true,force:true});}});
  await stream.ready;const env=stream.environment('examples',()=>[42]);socket=await client(stream.path);await register(socket,header(env[CHECK_CAPABILITY]!));
  const closed=once(socket,'close'),rows=records();socket.end([...rows.slice(0,-1),...Array.from({length:160},()=>({event:'observation',session:0,padding:'x'.repeat(64*1024)})),rows.at(-1)].map(row=>JSON.stringify(row)).join('\n')+'\n');
  while(!stream.backpressured)await new Promise<void>(resolve=>setImmediate(resolve));
  release();await closed;await stream.reaped('examples');await stream.close();
  assert.equal(calls,1);assert.match(stream.errors.join('\n'),/injected write failure while paused/);
  assert.equal(existsSync(join(costs,'check-worker-0.jsonl.gz')),false);assert.equal(stream.pendingBytes,0);
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
