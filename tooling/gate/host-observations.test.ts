import {fixtureEnvironment} from "./test-environment.ts";
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {HOST_OBSERVATIONS,HOST_OBSERVATION_ENVIRONMENT,hostObservations,parseCgroupCpu} from './host-observations.ts';
import {gateEnvironment,hostEnvironment,assertLandingEnvironment} from './canonical-environment.ts';
import {TemporaryAdmission} from './admission.ts';
import {reserveJob,readLedger,lockLedger} from './memory-ledger.ts';
import {waitFor} from './test-wait.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';
import {compileActive,closeMemoryRun} from '../census/worker-memory.ts';

test('one complete owned view supplies every resource, including child observations',t=>{
  const root=testScratch(t,'host-observations'),clock=join(root,'clock');
  writeFileSync(clock,'125');
  const env=ownMemory(root,{availableKiB:123,totalKiB:456,clock:{kind:'file',file:clock},
    disk:{freeBytes:789,freeInodes:12},allocated:{kind:'fixed',defaultBytes:11,paths:{'/owned/build':456}},resident:{kind:'fixed',defaultBytes:34,processes:{'71':56},cgroups:{'/owned':78}}});
  const data=JSON.parse(readFileSync(env.NTS_HOST_OBSERVATIONS,"utf8"));data.width={logical:7,available:6};data.load=[2,3,4];writeFileSync(env.NTS_HOST_OBSERVATIONS,JSON.stringify(data));
  const host=hostObservations(env);
  assert.deepEqual(host.memory(),{availableBytes:123*1024,totalBytes:456*1024});
  assert.deepEqual(host.paging(),{inputPages:0,outputPages:0});
  assert.deepEqual(host.swap(),{totalBytes:0,freeBytes:0});
  assert.deepEqual(host.load(),[2,3,4]);
  assert.deepEqual(host.disk('/a/path/that/does/not/exist'),{freeBytes:789,freeInodes:12});
  assert.equal(host.allocatedBytes('/owned/build'),456);
  assert.equal(host.allocatedBytes('/missing'),11);
  assert.deepEqual([host.processCharge(71),host.processCharge(-1),host.cgroupCharge('/owned'),host.cgroupCharge('/missing')],[56,34,78,34]);
  assert.deepEqual([host.machineWidth(),host.availableWidth(),host.now()],[7,6,125]);
  ownMemory(root,{availableKiB:321,totalKiB:456});
  writeFileSync(clock,'250');
  assert.equal(host.memory().availableBytes,321*1024);
  assert.equal(host.now(),250,'a memory update preserves the owned clock');
  const run=spawnSync(process.execPath,['--input-type=module','-e',`import {hostObservations} from ${JSON.stringify(new URL('./host-observations.ts',import.meta.url).href)};const host=hostObservations();console.log(JSON.stringify([host.disk('/missing'),host.processCharge(71),host.now()]));`],
    {env:{[HOST_OBSERVATIONS]:env.NTS_HOST_OBSERVATIONS},encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.deepEqual(JSON.parse(run.stdout),[{freeBytes:789,freeInodes:12},56,250]);
});

test('own CPU is supplied, advances with the capability, and refuses an omitted counter',t=>{
  const root=testScratch(t,'host-own-cpu'),env=ownMemory(root),host=hostObservations(env);
  assert.deepEqual(host.ownCpu(),{userUsec:0,systemUsec:0});
  ownMemory(root,{selfCpu:{kind:'fixed',value:{userUsec:123,systemUsec:45}}});
  assert.deepEqual(host.ownCpu(),{userUsec:123,systemUsec:45});
  const complete=JSON.parse(readFileSync(env.NTS_HOST_OBSERVATIONS,'utf8'));
  delete complete.selfCpu.value.systemUsec;writeFileSync(env.NTS_HOST_OBSERVATIONS,JSON.stringify(complete));
  assert.throws(()=>host.ownCpu(),/selfCpu.value.systemUsec/);
  delete complete.selfCpu;writeFileSync(env.NTS_HOST_OBSERVATIONS,JSON.stringify(complete));
  assert.throws(()=>hostObservations(env),/selfCpu/);
});

test('an omitted or unreadable observation fails by name, without a host fallback',t=>{
  const root=testScratch(t,'host-observations-omitted'),env=ownMemory(root);
  const file=env.NTS_HOST_OBSERVATIONS,complete=JSON.parse(readFileSync(file,'utf8'));
  for(const [parent,key,name] of [['disk','freeBytes','disk.freeBytes'],['disk','freeInodes','disk.freeInodes'],['memory','file','memory.file'],['paging','file','paging.file'],['resident','defaultBytes','resident.defaultBytes'],['scopePeak','bytes','scopePeak.bytes'],['scopePeak','resettable','scopePeak.resettable'],['width','logical','width.logical'],['width','available','width.available'],['clock','kind','clock'],['','load','load'],['','cpu','cpu'],['','scopePeak','scopePeak'],['','allocated','allocated'],['allocated','defaultBytes','allocated.defaultBytes']] as const){
    const broken=structuredClone(complete);
    delete (parent?broken[parent]:broken)[key];
    writeFileSync(file,JSON.stringify(broken));
    assert.throws(()=>hostObservations(env),new RegExp(name.replaceAll('.','\\.')),name);
  }
  writeFileSync(file,JSON.stringify(complete));
  const host=hostObservations(env);
  rmSync(env.NTS_MEMINFO);
  assert.throws(()=>host.memory(),/host observation memory.file/);
  assert.throws(()=>hostObservations({NTS_MEMINFO:'/proc/meminfo'}),/require an owned HostObservations/);
});

test('an owned per-case peak meter advances only from its capability and closes by name',t=>{
  const root=testScratch(t,'host-scope-peak'),env=ownMemory(root,{scopePeak:{kind:'fixed',bytes:123,resettable:true}});
  const meter=hostObservations(env).ownScopeMemoryPeak();
  assert.equal(meter.resettable,true);meter.reset();assert.equal(meter.read(),123);
  ownMemory(root,{scopePeak:{kind:'fixed',bytes:456,resettable:true}});
  assert.equal(meter.read(),456);
  meter.reset();meter.close();meter.close();
  assert.throws(()=>meter.read(),/scopePeak meter is closed/);
  assert.throws(()=>meter.reset(),/scopePeak meter is closed/);
  ownMemory(root,{scopePeak:{kind:'fixed',bytes:789,resettable:false}});
  const unsupported=hostObservations(env).ownScopeMemoryPeak();
  assert.equal(unsupported.resettable,false);
  assert.throws(()=>unsupported.reset(),/scopePeak meter cannot reset/);
  unsupported.close();
});

test('an explicitly live own-scope peak meter retains the worker descriptor',async t=>{
  const root=testScratch(t,'host-scope-peak-live'),env=fixtureEnvironment(t,ownMemory(join(root,'observations'),{scopePeak:{kind:'live'}}));
  // This kernel wiring control explicitly selects live counters in its own
  // bounded worker. No timing interval or machine-wide resource decides it.
  try {
    const result=await compileActive({memoryCapKb:256*1024},process.execPath,['--input-type=module','-e',`
import assert from 'node:assert/strict';
import {hostObservations} from ${JSON.stringify(new URL('./host-observations.ts',import.meta.url).href)};
const meter=hostObservations().ownScopeMemoryPeak();
assert.equal(meter.resettable,true);
const bytes=Buffer.alloc(16*1024**2,7);meter.reset();
assert.ok(meter.read()>=bytes.length);assert.equal(bytes[0],7);
meter.close();assert.throws(()=>meter.read(),/scopePeak meter is closed/);
`],{env,maxBuffer:64*1024});
    assert.equal(result.status,0,result.out);
  } finally {closeMemoryRun();}
});

test('canonical children retain the owned bundle, while a launcher override cannot be landing evidence',t=>{
  const root=testScratch(t,'host-observations-handoff'),memory=ownMemory(join(root,'memory'));
  const first=gateEnvironment(hostEnvironment(process.env),{run:join(root,'run'),owned:memory,oracleRoot:root});
  const child=gateEnvironment(first.env,{run:join(root,'run/child'),oracleRoot:root});
  assert.equal(child.env[HOST_OBSERVATIONS],memory.NTS_HOST_OBSERVATIONS);
  assert.equal(child.report.canonical,true);
  assert.throws(()=>assertLandingEnvironment({...hostEnvironment(process.env),...memory}),/NTS_HOST_OBSERVATIONS/);
});

test('temporary admission obeys the same owned disk even when the path cannot be read on the host',t=>{
  const root=testScratch(t,'host-observations-disk'),env=ownMemory(root,{disk:{freeBytes:0,freeInodes:0}});
  const host=hostObservations(env),admission=new TemporaryAdmission({path:'/unreadable/missing',context:{kind:'standalone'},reservedBytes:1024,host});
  assert.equal(admission.check().admitted,false);
  ownMemory(root,{disk:{freeBytes:2**40,freeInodes:2**30}});
  assert.equal(admission.check().admitted,true);
});


test('a missing sampler observation fails its job and still releases the owned ledger',async t=>{
  const root=testScratch(t,'host-observations-sampler'),env=ownMemory(root);
  const reports:string[]=[];
  const job=await reserveJob({key:'fixture-job',what:'owned sampler control'},{env,report:line=>reports.push(line)});
  const file=env.NTS_HOST_OBSERVATIONS,value=JSON.parse(readFileSync(file,'utf8'));
  delete value.resident;
  writeFileSync(file,JSON.stringify(value));
  let settled=false;
  const closed=job.closed.then(()=>{settled=true;},error=>{settled=true;throw error;});
  const failure=assert.rejects(closed,/memory: fixture-job sampler failed: host observation resident/);
  t.after(async()=>{
    try{job.release();}catch(error){assert.match(String(error),/host observation resident/);}
    await failure;
  });
  await waitFor('the sampler to report the missing resident observation',()=>reports.some(line=>line.includes('sampler failed: host observation resident')));
  const lock=lockLedger(env.NTS_MEMORY_LEDGER);assert.ok(lock);
  try{
    assert.throws(()=>job.release(),/host observation resident/);
    await Promise.resolve();
    assert.equal(settled,false,'a sampler failure cannot bypass the pending ledger deletion');
    assert.equal(readLedger(env.NTS_MEMORY_LEDGER).admitted.length,1);
  }finally{lock.release();}
  await failure;
  assert.deepEqual(readLedger(env.NTS_MEMORY_LEDGER),{waiting:[],admitted:[]});
  assert.equal((env as NodeJS.ProcessEnv).NTS_MEMORY_RESERVATION,undefined);
});


test('the fixture CLI supplies every shared environment field and gate classification follows that list',t=>{
  const root=testScratch(t,'host-observations-cli');
  const result=spawnSync(process.execPath,[new URL('./test-memory.ts',import.meta.url).pathname,root],{env:fixtureEnvironment(t),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const value=JSON.parse(result.stdout);
  assert.equal(value.version,1);
  assert.deepEqual(value.fields,HOST_OBSERVATION_ENVIRONMENT);
  assert.deepEqual(Object.keys(value.environment).sort(),[...HOST_OBSERVATION_ENVIRONMENT].sort());
  assert.equal(hostObservations(value.environment).disk('/missing').freeBytes,2**40);
  for(const field of value.fields){
    const planned=gateEnvironment({...hostEnvironment(process.env),[field]:value.environment[field]},{run:join(root,'run-'+field),standalone:true,owned:value.environment,oracleRoot:root});
    assert.equal(planned.report.canonical,false,field);
    assert.ok(planned.report.experiments.some(item=>item.name===field),field);
  }
});


test('CPU observations own all three counters, and an omission cannot select the live kernel',t=>{
  const root=testScratch(t,'host-cpu'),env=ownMemory(root,{cpu:{kind:'fixed',default:{usageUsec:100,userUsec:60,systemUsec:40},cgroups:{'/owned':{usageUsec:300,userUsec:200,systemUsec:100}}}});
  const host=hostObservations(env);
  assert.deepEqual(host.cgroupCpu('/owned'),{usageUsec:300,userUsec:200,systemUsec:100});
  assert.deepEqual(host.cgroupCpu('/does-not-exist'),{usageUsec:100,userUsec:60,systemUsec:40});
  const data=JSON.parse(readFileSync(env.NTS_HOST_OBSERVATIONS,'utf8'));delete data.cpu.default.userUsec;writeFileSync(env.NTS_HOST_OBSERVATIONS,JSON.stringify(data));
  assert.throws(()=>host.cgroupCpu('/does-not-exist'),/cpu.default.userUsec/);
});

test('cpu.stat requires one whole nonnegative counter of each kind',()=>{
  assert.deepEqual(parseCgroupCpu('usage_usec 600\nuser_usec 400\nsystem_usec 200\nnice_usec 15\n'),{usageUsec:600,userUsec:400,systemUsec:200});
  for(const text of ['user_usec 1\nsystem_usec 0\n','usage_usec -1\nuser_usec 1\nsystem_usec 0\n','usage_usec 1\nuser_usec 1\nuser_usec 1\nsystem_usec 0\n'])assert.throws(()=>parseCgroupCpu(text),/cpu.stat/);
});
