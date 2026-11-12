import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Socket} from 'node:net';
import {once} from 'node:events';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {CASE_RETIRE_HANG_MS,retireCaseScope} from './case-context.ts';
import {ToolingInstrumentError,publishToolingFailure,readStepInstrument} from './step-result.ts';
import {MemoryRun} from '../census/worker-memory.ts';
import {CaseMemoryLease} from './case-memory.ts';
import {hostObservations,CgroupDeparted} from './host-observations.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';

async function broker(t:{after(fn:()=>void|Promise<void>):void}){
  const sockets=new Set<Socket>();let received!:(socket:Socket)=>void;
  const requested=new Promise<Socket>(resolve=>{received=resolve;});
  const server=createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
    socket.once('data',()=>received(socket));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{for(const socket of sockets)socket.destroy();server.close();});
  const address=server.address();assert.ok(address&&typeof address!=='string');
  return {receipt:{address:'127.0.0.1:'+address.port,id:'owned-retirement'},requested};
}

test('a slow live broker retains the worker and its parent until the last peak is captured',async t=>{
  const b=await broker(t),root=testScratch(t,'case-retirement');
  const env=ownMemory(join(root,'observations'),{resident:{kind:'live'},scopePeak:{kind:'fixed',bytes:16*2**20,resettable:true}});
  const host=hostObservations(env),run=new MemoryRun({budgetBytes:256*2**20}),worker=run.worker('retirement',256*2**20);
  const rows:number[]=[];
  const lease=new CaseMemoryLease({step:'types',backend:'node',path:'tests/fixture/retirement'}, {
    history:()=>new Map(),completed:(_step,row)=>rows.push(row.peak),open:group=>{
      const meter=host.scopeMemoryPeak(group);return {charge:()=>0,peak:()=>meter.read(),close:()=>meter.close()};
    },
  });
  lease.attach(worker.group,256*2**20);
  worker.scope(process.execPath,['-e',''],{...env,NTS_GATE_CASE_LEASE_ADDRESS:b.receipt.address,NTS_GATE_CASE_LEASE_ID:b.receipt.id});
  let socket:Socket|undefined;
  t.after(async()=>{socket?.end('ready\n');worker.close();run.close();await Promise.allSettled([worker.closed,run.closed]);lease.close(false);});
  t.mock.timers.enable({apis:['setTimeout']});
  worker.close();run.close();socket=await b.requested;
  let finished=false;void run.closed.then(()=>{finished=true;});
  t.mock.timers.tick(45_000);await Promise.resolve();
  assert.equal(finished,false,'forty-five seconds of broker delay is still pending, not a case failure');
  assert.ok(host.cgroupCharge(worker.group)>=0);assert.ok(host.cgroupCharge(run.group)>=0);
  const packet=JSON.parse(readFileSync(env.NTS_HOST_OBSERVATIONS!,'utf8'));packet.scopePeak.bytes=96*2**20;
  writeFileSync(env.NTS_HOST_OBSERVATIONS!,JSON.stringify(packet));
  lease.retire(worker.group);socket.end('ready\n');await worker.closed;await run.closed;lease.close();
  assert.deepEqual(rows,[96*2**20]);
  assert.throws(()=>host.cgroupCharge(worker.group),CgroupDeparted);assert.throws(()=>host.cgroupCharge(run.group),CgroupDeparted);
});

test('a departed broker is a named cleanup instrument, never a product failure',async t=>{
  const b=await broker(t),pending=retireCaseScope(b.receipt,'/owned/worker.slice');
  const socket=await b.requested;socket.destroy();
  const error=await pending.then(()=>assert.fail('a departed broker cannot acknowledge a sample'),error=>error);
  assert.ok(error instanceof ToolingInstrumentError);assert.equal(error.kind,'tooling-cleanup');
  assert.match(error.message,/owned-retirement.*\/owned\/worker.slice.*broker departed/);
  const path=join(testScratch(t,'retirement-instrument'),'result.json');
  publishToolingFailure(error,{NTS_GATE_STEP_RESULT:path,NTS_GATE_STEP:'types',NTS_GATE_STEP_ATTEMPT:'owned'});
  assert.equal(readStepInstrument(path,'types','owned')?.verdict,'INSTRUMENT');
});

test('a live but wedged broker names the lease and group at its five-minute instrument backstop',async t=>{
  const b=await broker(t);t.mock.timers.enable({apis:['setTimeout']});
  const pending=retireCaseScope(b.receipt,'/owned/wedged.slice');
  const rejected=assert.rejects(pending,error=>error instanceof ToolingInstrumentError&&error.kind==='tooling-cleanup'
    &&/owned-retirement.*\/owned\/wedged.slice.*five-minute/.test(error.message));
  await b.requested;t.mock.timers.tick(CASE_RETIRE_HANG_MS);await rejected;
});
