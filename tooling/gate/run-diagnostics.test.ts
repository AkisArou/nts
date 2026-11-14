import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {CgroupDeparted,hostObservations,type PressureReading} from './host-observations.ts';
import {parsePressure} from './host-pressure.ts';
import {RunDiagnostics,pressureDelta} from './run-diagnostics.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';
import {waitFor} from './test-wait.ts';

const reading=(identity:string,total=0):PressureReading=>{
  const resource=()=>({some:{avg10:12.5,totalUsec:total},full:{avg10:2.5,totalUsec:total/2}});
  return {identity,resources:{cpu:resource(),memory:resource(),io:resource()}};
};

test('PSI parsing requires named some/full counters and records their units',()=>{
  assert.deepEqual(parsePressure('some avg10=12.50 avg60=0.00 avg300=0.00 total=1234\nfull avg10=1.25 avg60=0.00 avg300=0.00 total=50\n','fixture'),
    {some:{avg10:12.5,totalUsec:1234},full:{avg10:1.25,totalUsec:50}});
  for(const text of ['some avg10=0 total=0\n','some avg10=0 total=0\nsome avg10=1 total=1\nfull avg10=0 total=0\n',
    'some avg10=101 total=1\nfull avg10=0 total=0\n','some avg10=0 total=1.5\nfull avg10=0 total=0\n'])assert.throws(()=>parsePressure(text,'fixture'),/host observation fixture/);
  assert.throws(()=>pressureDelta(reading('old'),reading('new')),/scope changed/);
  assert.throws(()=>pressureDelta(reading('scope',2),reading('scope',0)),/counter reset/);
});

test('supplied delay histograms and shared pressure endpoints survive overlapping steps and minute windows',t=>{
  const root=testScratch(t,'run-diagnostics'),clock=join(root,'clock');writeFileSync(clock,'0');
  const pressure=(total:number)=>({kind:'fixed' as const,ownGroup:'/runner',machine:reading('machine',total),default:reading('cgroup',total)});
  const env=ownMemory(root,{clock:{kind:'file',file:clock},pressure:pressure(100)}),rows:unknown[]=[],logs:string[]=[],errors:unknown[]=[];
  const diagnostics=new RunDiagnostics({host:hostObservations(env),sourceRun:'/retained/run',workersGroup:'/workers',startedAt:0,
    emit:row=>rows.push(row),log:line=>logs.push(line),failed:error=>errors.push(error)});
  diagnostics.beginStep('one');
  writeFileSync(clock,'1000');ownMemory(root,{pressure:pressure(200)});diagnostics.beginStep('two');
  writeFileSync(clock,'61000');ownMemory(root,{pressure:pressure(400),loopDelay:{kind:'fixed',value:{count:9,maxMs:1234,p99Ms:1111}}});
  const first=diagnostics.endStep('one');
  assert.equal(first.pressureExposure.machine.stallUsec.cpu.some,300);assert.equal(first.pressureExposure.runner.stallUsec.io.full,150);
  assert.deepEqual(first.loopDelay,{count:9,maxMs:1234,p99Ms:1111});
  assert.equal(first.pressureBasis,'shared-scope-endpoints-overlap');assert.equal(first.sourceRun,'/retained/run');
  writeFileSync(clock,'62000');ownMemory(root,{pressure:pressure(500),loopDelay:{kind:'fixed',value:{count:10,maxMs:1500,p99Ms:900}}});
  const second=diagnostics.endStep('two');assert.equal(second.pressureExposure.workers?.stallUsec.memory.some,300);
  diagnostics.close();diagnostics.close();
  const report=diagnostics.report();assert.equal(report.state,'complete');assert.equal(report.finishedAt,new Date(62000).toISOString());
  assert.equal(report.pressureExposure?.machine.stallUsec.io.some,400);
  assert.deepEqual(report.loopDelay,{count:10,maxMs:1500,p99Ms:900},'the run reads its own histogram rather than averaging step percentiles');
  assert.equal(report.minutes.length,2);assert.equal(report.minutes[0]?.elapsedMs,61000);
  assert.ok(rows.some(row=>(row as {kind:string}).kind==='event-loop-block'));assert.match(logs[0]!,/1234.000 ms observed at 1970-01-01T00:01:01/);
  assert.deepEqual(errors,[]);report.minutes.length=0;assert.equal(diagnostics.report().minutes.length,2);
});

test('missing pressure or delay is named and empty native windows remain unavailable',t=>{
  const root=testScratch(t,'diagnostics-missing'),env=ownMemory(root),host=hostObservations(env),meter=host.loopDelay();
  assert.deepEqual(meter.read(),{count:0,maxMs:null,p99Ms:null});meter.close();assert.throws(()=>meter.read(),/loopDelay meter is closed/);
  const complete=JSON.parse(readFileSync(env.NTS_HOST_OBSERVATIONS,'utf8'));
  for(const field of ['pressure','loopDelay','wallClock']){
    const broken=structuredClone(complete);delete broken[field];writeFileSync(env.NTS_HOST_OBSERVATIONS,JSON.stringify(broken));
    assert.throws(()=>hostObservations(env),new RegExp('host observation '+field));
  }
  writeFileSync(env.NTS_HOST_OBSERVATIONS,JSON.stringify(complete));
  const diagnostics=new RunDiagnostics({host,sourceRun:root,workersGroup:'/workers',startedAt:0,emit:()=>{},log:()=>{},failed:()=>{}});
  delete complete.pressure;writeFileSync(env.NTS_HOST_OBSERVATIONS,JSON.stringify(complete));
  assert.throws(()=>diagnostics.close(),/run diagnostics incomplete:.*host observation pressure/);
  assert.equal(diagnostics.report().state,'incomplete');
});

test('an explicitly live native delay meter reports readiness and closes without supplying empty zeros',async t=>{
  const root=testScratch(t,'diagnostics-live'),env=ownMemory(root,{loopDelay:{kind:'live'}}),meter=hostObservations(env).loopDelay();
  t.after(()=>meter.close());
  await waitFor('the native loop-delay monitor to observe a completed turn',()=>meter.read().count>0);
  const sample=meter.read();assert.ok(sample.count>0);assert.ok(sample.maxMs!==null&&sample.p99Ms!==null&&sample.maxMs>=sample.p99Ms);
  meter.reset();assert.deepEqual(meter.read(),{count:0,maxMs:null,p99Ms:null});
});

test('explicit live PSI retains machine and own cgroup identities without a substitute reading',t=>{
  const env=ownMemory(testScratch(t,'pressure-live'),{pressure:{kind:'live'}}),host=hostObservations(env);
  const machine=host.machinePressure(),group=host.ownCgroup(),own=host.cgroupPressure(group);
  assert.notEqual(machine.identity,own.identity);assert.ok(own.identity.includes(group));
  assert.equal(pressureDelta(machine,host.machinePressure()).identity,machine.identity);
  assert.equal(pressureDelta(own,host.cgroupPressure(group)).identity,own.identity);
});

test('a meter close failure still closes every acquired diagnostic meter',t=>{
  const env=ownMemory(testScratch(t,'diagnostics-meter-cleanup')),closed:number[]=[],base=hostObservations(env);let next=0;
  const host={...base,loopDelay:()=>{const id=next++,meter=base.loopDelay();return {...meter,close:()=>{closed.push(id);meter.close();if(id===0)throw Error('supplied meter close failure');}};}};
  const rows:{kind?:string;state?:string;error?:string}[]=[];
  const diagnostics=new RunDiagnostics({host,sourceRun:'/run',workersGroup:'/workers',startedAt:0,emit:row=>rows.push(row as typeof rows[number]),log:()=>{},failed:()=>{}});
  assert.throws(()=>diagnostics.close(),/supplied meter close failure/);assert.deepEqual(closed,[0,1,2]);assert.equal(diagnostics.report().state,'incomplete');
  const terminal=rows.filter(row=>row.kind==='run-diagnostics-complete');assert.equal(terminal.length,1);assert.equal(terminal[0]?.state,'incomplete');assert.match(terminal[0]?.error??'',/supplied meter close failure/);
});

test('delayed acquisition pairs its own wall clock and attaches a later worker root at its own endpoint',t=>{
  const root=testScratch(t,'diagnostics-delayed-start'),clock=join(root,'clock');writeFileSync(clock,'5000');
  const pressure=(total:number)=>({kind:'fixed' as const,ownGroup:'/runner',machine:reading('machine',total),default:reading('cgroup',total)});
  const env=ownMemory(root,{clock:{kind:'file',file:clock},wallClock:{kind:'fixed',now:10_000},pressure:pressure(100)}),host=hostObservations(env);
  const rows:unknown[]=[],diagnostics=new RunDiagnostics({host,sourceRun:'/run',startedAt:host.wallNow(),emit:row=>rows.push(row),log:()=>{},failed:()=>{}});
  assert.equal(diagnostics.report().startedAt,new Date(10_000).toISOString());
  assert.equal(diagnostics.report().pressureExposure?.workers,null);assert.equal(diagnostics.report().workersStartedAt,null);
  writeFileSync(clock,'7000');ownMemory(root,{pressure:pressure(900)});diagnostics.attachWorkers('/late-root');
  assert.equal(diagnostics.report().workersStartedAt,new Date(12_000).toISOString());
  writeFileSync(clock,'8000');ownMemory(root,{pressure:pressure(1000)});diagnostics.close();
  const report=diagnostics.report();assert.equal(report.finishedAt,new Date(13_000).toISOString());
  assert.equal(report.pressureExposure?.machine.stallUsec.cpu.some,900);assert.equal(report.pressureExposure?.workers?.stallUsec.cpu.some,100);
  const first=rows[0] as {pressure:{workers:unknown}};assert.equal(first.pressure.workers,null);
});

test('a proved owned worker departure keeps its last real counters and observation time',t=>{
  const root=testScratch(t,'diagnostics-owned-departure'),clock=join(root,'clock');writeFileSync(clock,'0');
  const env=ownMemory(root,{clock:{kind:'file',file:clock}}),base=hostObservations(env);let ended=false,total=100,workerReads=0;
  const host={...base,cgroupPressure:(group:string)=>{
    if(group!=='/workers')return base.cgroupPressure(group);
    workerReads++;if(ended)throw new CgroupDeparted(group,Error('supplied exact departure'));
    return reading('owned-worker',total);
  }};
  const rows:{kind?:string;pressure?:{workers:unknown}}[]=[],errors:unknown[]=[];
  const diagnostics=new RunDiagnostics({host,sourceRun:'/run',startedAt:0,emit:row=>rows.push(row as typeof rows[number]),log:()=>{},failed:error=>errors.push(error)});
  diagnostics.attachWorkers('/workers',()=>ended);
  writeFileSync(clock,'1000');total=200;diagnostics.beginStep('active');
  writeFileSync(clock,'2000');total=400;diagnostics.sample();const lastReads=workerReads;
  writeFileSync(clock,'3000');ended=true;const departed=diagnostics.sample();assert.equal(departed.pressure.workers,null);
  writeFileSync(clock,'4000');const step=diagnostics.endStep('active');
  assert.equal(step.pressureExposure.workers?.stallUsec.cpu.some,200);
  assert.deepEqual(step.workersPressureInterval,{startedAt:new Date(1000).toISOString(),finishedAt:new Date(2000).toISOString(),departedAt:new Date(3000).toISOString()});
  assert.throws(()=>diagnostics.beginStep('too-late'),/root departed/);
  writeFileSync(clock,'5000');diagnostics.close();
  const report=diagnostics.report();assert.equal(report.state,'complete');assert.equal(report.finishedAt,new Date(5000).toISOString());
  assert.equal(report.workersPressure?.observedAt,new Date(2000).toISOString());assert.equal(report.workersPressure?.departedAt,new Date(3000).toISOString());
  assert.equal(report.workersPressure?.reading.resources.cpu.some.totalUsec,400);assert.equal(report.pressureExposure?.workers?.stallUsec.cpu.some,300);
  assert.equal(workerReads,lastReads,'retired endpoints are never sampled as live again');assert.deepEqual(errors,[]);
  assert.equal(rows.filter(row=>row.kind==='run-diagnostics-workers-departed').length,1);
  const samples=rows.filter(row=>row.kind==='run-diagnostics-sample');assert.equal(samples.at(-1)?.pressure?.workers,null,'no synthetic terminal pressure endpoint');
});

test('missing unowned, changed and live-unreadable endpoints remain instrument failures',t=>{
  const base=hostObservations(ownMemory(testScratch(t,'diagnostics-departure-refusals')));
  for(const kind of ['unowned','foreign','live','changed','unreadable'] as const){
    let broken=false;
    const host={...base,cgroupPressure:(group:string)=>{
      if(group!=='/workers')return base.cgroupPressure(group);
      if(broken){
        if(kind==='changed')return reading('new-worker');
        if(kind==='unreadable')throw Error('supplied live pressure file unreadable');
        throw new CgroupDeparted(kind==='foreign'?'/other':'/workers',Error('supplied missing endpoint'));
      }
      return reading('owned-worker');
    }};
    const diagnostics=new RunDiagnostics({host,sourceRun:'/run',startedAt:0,emit:()=>{},log:()=>{},failed:()=>{}});
    diagnostics.attachWorkers('/workers',kind==='unowned'?undefined:()=>false);broken=true;
    assert.throws(()=>diagnostics.close(),/run diagnostics incomplete/);assert.equal(diagnostics.report().state,'incomplete',kind);
  }
  const missing=new RunDiagnostics({host:base,sourceRun:'/run',startedAt:0,emit:()=>{},log:()=>{},failed:()=>{}});
  assert.throws(()=>missing.attachWorkers('/workers',()=>true),/before its pressure endpoint was acquired/);
  assert.throws(()=>missing.close(),/incomplete/);
});
