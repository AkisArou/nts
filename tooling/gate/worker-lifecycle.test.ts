import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {workerLifecycle,WORKER_DRAIN_MS,type WorkerTransport} from './worker-lifecycle.ts';
function fixture(){
 const worker=new EventEmitter(),messages:unknown[]=[],warnings:string[]=[];let terminated=0,unrefs=0,callback:(()=>void)|undefined,cancelled=false;
 const transport=Object.assign(worker,{postMessage(message:unknown){messages.push(message);},unref(){unrefs++;},async terminate(){terminated++;worker.emit('exit',1);return 1;}}) as unknown as WorkerTransport;
 const lifecycle=workerLifecycle(transport,'control sampler',line=>warnings.push(line),{arm(fn,milliseconds){assert.equal(milliseconds,WORKER_DRAIN_MS);callback=fn;return()=>{cancelled=true;};}});
 return {worker,messages,warnings,lifecycle,get terminated(){return terminated;},get unrefs(){return unrefs;},get cancelled(){return cancelled;},expire(){assert.ok(callback);callback();}};
}
test('a worker stops by one message and closes only after its final reply and exit',async()=>{
 const f=fixture();let closed=false;void f.lifecycle.closed.then(()=>{closed=true;});
 f.lifecycle.stop();f.lifecycle.stop();assert.deepEqual(f.messages,[{kind:'stop'}]);assert.equal(closed,false);assert.equal(f.unrefs,1);
 f.worker.emit('message',{kind:'stopped',peak:17});assert.equal(closed,false);f.worker.emit('exit',0);await f.lifecycle.closed;
 assert.equal(f.terminated,0);assert.equal(f.cancelled,true);assert.deepEqual(f.warnings,[]);
});
test('a wedged worker is terminated only at its supplied bound and the failure is named',async()=>{
 const f=fixture();f.lifecycle.stop();assert.equal(f.terminated,0);f.expire();
 await assert.rejects(f.lifecycle.closed,/control sampler did not stop within 60000 ms/);assert.equal(f.terminated,1);assert.equal(f.warnings.length,1);
});
test('a worker exit without its final reply cannot certify a clean shutdown',async()=>{
 const f=fixture();f.lifecycle.stop();f.worker.emit('exit',0);await assert.rejects(f.lifecycle.closed,/without its final reply/);assert.equal(f.terminated,0);
});

test('a final reply without a valid sample is a named protocol failure',async()=>{
 const f=fixture();f.lifecycle.stop();f.worker.emit('message',{kind:'stopped'});f.worker.emit('exit',0);
 await assert.rejects(f.lifecycle.closed,/invalid final reply/);assert.equal(f.terminated,0);
});

test('a valid final reply followed by exit is clean when the reservation ends naturally',async()=>{
 const f=fixture();f.worker.emit('message',{kind:'stopped',peak:23});f.worker.emit('exit',0);await f.lifecycle.closed;
 f.lifecycle.stop();assert.deepEqual(f.messages,[]);assert.equal(f.terminated,0);assert.deepEqual(f.warnings,[]);
});
test('a throwing owned reporter rejects closed without escaping the worker callback',async()=>{
 const worker=new EventEmitter();Object.assign(worker,{postMessage(){},unref(){},async terminate(){return 1;}});
 const lifetime=workerLifecycle(worker as unknown as WorkerTransport,'owned reporter',()=>{throw Error('report namespace unavailable');},{arm(){return()=>{};}});
 assert.doesNotThrow(()=>worker.emit('exit',1));await assert.rejects(lifetime.closed,/reporting failed.*report namespace unavailable/);
});
