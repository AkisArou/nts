import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {CaseMemoryBroker,type CaseTokenRequest} from './case-memory-broker.ts';
import {hostObservations} from './host-observations.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';
import {caseMemoryKey} from './step-scheduling.ts';

test('persistent worker caps use fresh file observations while each lease resets its own accounting',async t=>{
  const monitorURL='data:text/javascript,'+encodeURIComponent(`
    import {EventEmitter} from 'node:events';
    export const reads=[],writes=[],limits=new Map(),identities=new Map(),errors=new Map();
    export function statSync(path){const group=path.slice('/sys/fs/cgroup'.length);if(errors.has(group))throw errors.get(group);if(!identities.has(group))throw Object.assign(Error('scope departed: '+group),{code:'ENOENT'});return {dev:28n,ino:BigInt(identities.get(group))};}
    export function readLimits(group){reads.push(group);if(!limits.has(group))throw Error('unowned cgroup: '+group);return {max:limits.get(group),high:Infinity,swap:0};}
    export function spawn(command,args){
      if(command!=='systemctl'||args[1]!=='set-property')throw Error('unexpected process: '+command);
      writes.push([...args]);const group=[...limits.keys()].find(group=>group.endsWith('/'+args[3]));
      if(!group)throw Error('unowned property: '+args[3]);limits.set(group,Number(args[4].split('=')[1]));
      const child=new EventEmitter();child.stderr=new EventEmitter();child.stderr.setEncoding=()=>child.stderr;
      queueMicrotask(()=>child.emit('close',0));return child;
    }
  `);
  const query=new URL('./case-memory-broker.ts?persistent-cap-control',import.meta.url).href;
  const hooks=registerHooks({resolve(specifier,context,next){
    if(context.parentURL===query&&['node:child_process','node:fs','./scopes/memory-limits.ts'].includes(specifier))return {url:monitorURL,shortCircuit:true};
    return next(specifier,context);
  }});
  t.after(()=>hooks.deregister());
  const monitor=await import(monitorURL),{CaseMemoryBroker:ObservedBroker}=await import(query);
  const root=testScratch(t,'persistent-worker-case-caps'),env=fixtureEnvironment(t,ownMemory(root));
  const group='/owned/run/worker.slice',scope=group+'/worker.scope',cap=128*2**20;
  for(const path of ['/owned/run',group,scope])monitor.limits.set(path,cap);
  monitor.identities.set(group,1);monitor.identities.set(scope,2);
  let peak=0,charge=10,resets=0,closes=0;
  let parentCap=0;const parentWrites:number[]=[];
  const boundary={group:'/owned',raise:async(bytes:number)=>{if(bytes!==parentCap){parentCap=bytes;parentWrites.push(bytes);}}};
  const host={...hostObservations(env),cgroupCharge:()=>charge,scopeMemoryPeak:()=>({resettable:true,
    reset:()=>{resets++;peak=charge;},read:()=>peak,close:()=>{closes++;}})};
  const broker:CaseMemoryBroker=new ObservedBroker({root,env,host,boundary:()=>boundary,report:()=>{}});
  const request=(name:string):CaseTokenRequest=>({step:'test262-census-c',lease:name,context:'json64:'+Buffer.from(JSON.stringify({project:name,backend:'c'})).toString('base64url'),answered:true});
  const first=request('first');broker.prepare(first);await broker.attach(first,{group,scope,cap});
  assert.deepEqual(monitor.writes,[],'a matching kernel cap starts no manager process');
  peak=100;charge=20;await broker.completed(first);assert.equal(first.memory?.peak,100);
  const reads=monitor.reads.length;
  const second=request('second');broker.prepare(second);await broker.attach(second,{group,scope,cap});
  assert.ok(monitor.reads.length>reads,'the next lease rereads the cgroup files');
  for(const path of ['/owned/run',group,scope])assert.ok(monitor.reads.slice(reads).includes(path),'fresh ancestry and cap read: '+path);
  assert.equal(second.memory?.peak,20,'the prior case peak cannot size the new observation');
  peak=50;await broker.completed(second);assert.equal(second.memory?.peak,50);
  assert.equal(resets,2);assert.equal(closes,2);assert.deepEqual(monitor.writes,[]);
  // The same persistent scope can need a real change. Exactly that endpoint
  // is written, and then observed again before the case is admitted.
  monitor.limits.set(scope,cap/2);
  const third=request('third');broker.prepare(third);await broker.attach(third,{group,scope,cap});
  assert.deepEqual(monitor.writes,[['--user','set-property','--runtime','worker.scope','MemoryMax='+cap]]);
  await broker.completed(third);assert.equal(resets,3);assert.equal(closes,3);
  // A full-cap case can finish and another can attach while the same worker
  // remains alive. The parent never drops to a small next-case forecast.
  charge=cap;peak=cap;
  const full=request('full-cap');broker.prepare(full);await broker.attach(full,{group,scope,cap});
  assert.equal(full.memory?.charge,cap);await broker.completed(full);
  assert.equal(broker.caps('test262-census-c'),cap);assert.equal(parentCap,cap);
  const next=request('after-full-cap');broker.prepare(next);await broker.attach(next,{group,scope,cap});
  assert.equal(next.memory?.charge,cap);await broker.completed(next);
  assert.deepEqual(parentWrites,[cap],'lease transitions cause no parent-cap writes');
  monitor.identities.delete(scope);
  await boundary.raise(broker.caps('test262-census-c'));
  assert.equal(parentCap,0,'only observed scope departure retires the allowance');
  monitor.identities.set(scope,3);
  const replacement=request('replacement');broker.prepare(replacement);await broker.attach(replacement,{group,scope,cap});
  monitor.identities.set(scope,4);
  assert.throws(()=>broker.caps('test262-census-c'),/registered worker identity changed/);
  monitor.identities.set(scope,3);
  monitor.errors.set(scope,Object.assign(Error('unreadable owned scope'),{code:'EACCES'}));
  assert.throws(()=>broker.caps('test262-census-c'),/registered worker observation failed/);
  monitor.errors.clear();await broker.completed(replacement);
  const foreign=request('foreign');broker.prepare(foreign);
  await assert.rejects(broker.attach(foreign,{group:'/outside/worker.slice',scope:'/outside/worker.slice/worker.scope',cap}),/escapes its step/);
  await broker.completed(foreign);
  broker.flush('test262-census-c');
  assert.equal(first.memory?.key,caseMemoryKey({step:'test262-census-c',backend:'c',path:'first'}));
});
