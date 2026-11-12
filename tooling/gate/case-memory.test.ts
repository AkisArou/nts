import test from 'node:test';
import assert from 'node:assert/strict';
import {CaseMemoryLease,caseIdentity,type CaseMemoryEffects} from './case-memory.ts';
import {caseMemoryKey,peakReservation,type CaseObservation} from './step-scheduling.ts';
import {CgroupDeparted} from './host-observations.ts';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {hostObservations} from './host-observations.ts';
import {MemoryRun} from '../census/worker-memory.ts';
import {testScratch} from './test-scratch.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {ownMemory} from './test-memory.ts';
import {waitFor} from './test-wait.ts';

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
  assert.deepEqual(caseIdentity('benches',{...context,project:'benchmarks/./cases/../cases/heavy'},'/source'),before);
  assert.notEqual(caseMemoryKey(before),caseMemoryKey({...before,backend:'c'}));
  assert.notEqual(caseMemoryKey(before),caseMemoryKey({...before,step:'dex'}));
  assert.throws(()=>caseIdentity('benches',{project:'/outside'},'/source'),/outside its source tree/);
  assert.throws(()=>caseIdentity('benches',{project:'tests/../../outside'},'/source'),/outside its source tree/);
  assert.deepEqual(caseIdentity('benches',{scope:'step'},'/source'),{step:'benches',backend:'',path:'@step'});
  assert.throws(()=>caseIdentity('benches',{scope:'step',project:'tests/fixture'},'/source'),/step lease cannot also name a case/);
});

for(const retainedPeak of [false,true])test(`an attached departed worker retires once and keeps its observed peak (descriptor retained=${retainedPeak})`,()=>{
  const identity={step:'benches',backend:'llvm',path:'benchmarks/cases/heavy'},observed:CaseObservation[]=[];
  let gone=false,closed=0;
  const group='/workers/exited',departed=()=>new CgroupDeparted(group,Error('worker exited'));
  const lease=new CaseMemoryLease(identity,{history:()=>new Map(),completed:(_step,row)=>observed.push(row),open:()=>({
    charge:()=>{if(gone)throw departed();return 40*MiB;},
    peak:()=>{if(gone&&!retainedPeak)throw departed();return (gone?70:50)*MiB;},
    close:()=>{closed++;},
  })});
  lease.attach(group,2**30);gone=true;lease.sample();lease.sample();lease.retire(group);
  assert.equal(lease.charge,0);assert.equal(lease.capBytes,0);assert.deepEqual(lease.groups,[]);
  lease.close();assert.equal(closed,1);
  assert.deepEqual(observed,[{key:caseMemoryKey(identity),peak:(retainedPeak?70:50)*MiB}]);
});

test('only the departure of an already attached exact group can retire a meter',()=>{
  const identity={step:'benches',backend:'llvm',path:'benchmarks/cases/heavy'};
  const effects:CaseMemoryEffects={history:()=>new Map(),completed:()=>{},open:group=>{throw new CgroupDeparted(group,Error('never existed'));}};
  const unopened=new CaseMemoryLease(identity,effects);
  assert.throws(()=>unopened.attach('/workers/unopened',2**30),CgroupDeparted);
  assert.deepEqual(unopened.groups,[]);
  let failure:unknown;
  const attached=new CaseMemoryLease(identity,{...effects,open:()=>({charge:()=>{if(failure)throw failure;return 1;},peak:()=>1,close:()=>{}})});
  attached.attach('/workers/attached',2**30);
  for(const error of [new CgroupDeparted('/workers/step-boundary',Error('missing boundary')),Object.assign(Error('unclassified missing observation'),{code:'ENOENT'}),Object.assign(Error('permission denied'),{code:'EACCES'})]){
    failure=error;assert.throws(()=>attached.sample(),value=>value===error);
  }
  failure=undefined;attached.close();
});

test('a real worker cgroup removed between samples keeps its case peak without failing the collector',async t=>{
  const root=testScratch(t,'case-worker-departure'),ready=join(root,'ready.json');
  const env=fixtureEnvironment(t,ownMemory(join(root,'memory'),{resident:{kind:'live'},scopePeak:{kind:'live'}}));
  const host=hostObservations(env),run=new MemoryRun({id:'case-departure',budgetBytes:256*MiB});
  const worker=run.worker('owned',256*MiB),identity={step:'benches',backend:'llvm',path:'benchmarks/cases/departure'};
  const observed:CaseObservation[]=[];
  const lease=new CaseMemoryLease(identity,{history:()=>new Map(),completed:(_step,row)=>observed.push(row),open:group=>{
    const meter=host.scopeMemoryPeak(group);assert.equal(meter.resettable,true);meter.reset();
    return {charge:()=>host.cgroupCharge(group),peak:()=>meter.read(),close:()=>meter.close()};
  }});
  const code=`import {watch} from 'node:fs';import {durableRecord} from ${JSON.stringify(new URL('./durable-record.ts',import.meta.url).href)};
globalThis.bytes=Buffer.alloc(32*1024**2,7);watch(${JSON.stringify(root)},()=>{});durableRecord(${JSON.stringify(ready)},{allocated:globalThis.bytes.length});`;
  const scope=worker.scope(process.execPath,['--input-type=module','-e',code],env);
  const child=spawn('systemd-run',scope.argv,{env:scope.env,stdio:['ignore','pipe','pipe']});
  let output='',ended=false;child.stdout.on('data',part=>{output+=part;});child.stderr.on('data',part=>{output+=part;});
  const closed=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',()=>{ended=true;resolve();});});
  try{
    await waitFor('the owned worker allocation',()=>existsSync(ready),{stopped:()=>ended?output||'worker exited':undefined});
    lease.attach(worker.group,256*MiB);assert.ok(lease.peak>=32*MiB);
    const peak=lease.peak;worker.close();await closed;
    await waitFor('the owned worker cgroup removal',()=>{
      try{host.cgroupCharge(worker.group);return false;}
      catch(error){if(error instanceof CgroupDeparted&&error.group===worker.group)return true;throw error;}
    });
    lease.sample();lease.close();assert.deepEqual(lease.groups,[]);
    assert.equal(observed.length,1);assert.ok(observed[0]!.peak>=peak);
    assert.throws(()=>host.scopeMemoryPeak(worker.group),/cannot open own memory.peak/,'an unopened missing group is fatal');
    run.close();assert.throws(()=>host.cgroupCharge(run.group),CgroupDeparted,'a missing step boundary remains fatal');
  }finally{worker.close();run.close();await closed;lease.close(false);}
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
