import test from 'node:test';
import assert from 'node:assert/strict';
import {CaseMemoryLease,caseIdentity,caseMemoryKey,type CaseMemoryEffects} from './case-memory.ts';
import {peakReservation,type CaseObservation} from './step-scheduling.ts';

const MiB=2**20;
function fixture(known?:number){
  const identity={step:'benches',backend:'llvm',path:'benchmarks/cases/heavy'};
  const samples=new Map<string,{charge:number;peak:number;closed:number}>();
  const observed:CaseObservation[]=[];
  const effects:CaseMemoryEffects={history:()=>known===undefined?new Map():new Map([[caseMemoryKey(identity),[known]]]),
    completed:(_step,row)=>observed.push(row),open:group=>{
      const row=samples.get(group);assert.ok(row,'fixture owns every meter');
      return {charge:()=>row.charge,peak:()=>row.peak,close:()=>{row.closed++;}};
    }};
  return {identity,samples,observed,lease:new CaseMemoryLease(identity,effects)};
}

test('case identity keeps its measured history across compiler and content changes',()=>{
  const context={project:'/source/benchmarks/cases/heavy',backend:'llvm',binary:'old',source:'old'};
  const before=caseIdentity('benches',context,'/source');
  assert.deepEqual(caseIdentity('benches',{...context,binary:'new',source:'new'},'/source'),before);
  assert.notEqual(caseMemoryKey(before),caseMemoryKey({...before,backend:'c'}));
  assert.notEqual(caseMemoryKey(before),caseMemoryKey({...before,step:'dex'}));
  assert.throws(()=>caseIdentity('benches',{project:'/outside'},'/source'),/outside its source tree/);
});

test('a known case asks for its own peak, including when it exceeds the entire initial grant',()=>{
  const f=fixture(3*2**30),initialGrant=256*MiB;
  assert.ok(f.lease.bytes>initialGrant);
  assert.equal(f.lease.bytes,peakReservation([3*2**30]));
  const grownGrant=f.lease.bytes;
  assert.ok(f.lease.bytes<=grownGrant);
  assert.ok(2*f.lease.bytes>grownGrant,'a second large case must wait, not borrow the same promise');
});

test('an unknown case charges live use and margin, and records its own peak',()=>{
  const f=fixture(),row={charge:40*MiB,peak:50*MiB,closed:0};f.samples.set('/workers/a',row);
  assert.equal(f.lease.measured,false);
  assert.equal(f.lease.bytes,peakReservation([1]));
  f.lease.attach('/workers/a',6*2**30);
  row.charge=400*MiB;row.peak=450*MiB;f.lease.sample();
  assert.equal(f.lease.bytes,peakReservation([400*MiB]));
  assert.equal(f.lease.capBytes,6*2**30,'a hard cap is independent of the promise');
  row.charge=10*MiB;f.lease.close();f.lease.close();
  assert.deepEqual(f.observed,[{key:caseMemoryKey(f.identity),peak:450*MiB}]);
  assert.equal(row.closed,1);
});

test('concurrent roots sum live charges, while nested scopes stay inside one case cap',()=>{
  const f=fixture();
  for(const [group,charge] of [['/workers/a',200*MiB],['/workers/a/nested',100*MiB],['/workers/b',300*MiB]] as const)f.samples.set(group,{charge,peak:charge,closed:0});
  f.lease.attach('/workers/a',2**30);f.lease.attach('/workers/a/nested',512*MiB);f.lease.attach('/workers/b',2**30);
  assert.equal(f.lease.charge,500*MiB);assert.equal(f.lease.capBytes,2*2**30);
  assert.throws(()=>f.lease.attach('/workers/a/too-large',2*2**30),/exceeds its enclosing case/);
  f.lease.close();assert.equal(f.observed[0]?.peak,500*MiB);
});
