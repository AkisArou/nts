import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {HOST_OBSERVATIONS,HOST_OBSERVATION_ENVIRONMENT,hostObservations} from './host-observations.ts';
import {gateEnvironment,hostEnvironment,assertLandingEnvironment} from './canonical-environment.ts';
import {TemporaryAdmission} from './admission.ts';
import {reserveJob,readLedger} from './memory-ledger.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';

test('one complete owned view supplies every resource, including child observations',t=>{
  const root=testScratch(t,'host-observations'),clock=join(root,'clock');
  writeFileSync(clock,'125');
  const env=ownMemory(root,{availableKiB:123,totalKiB:456,clock:{kind:'file',file:clock},
    disk:{freeBytes:789,freeInodes:12},resident:{kind:'fixed',defaultBytes:34,processes:{'71':56},cgroups:{'/owned':78}}});
  const data=JSON.parse(readFileSync(env.NTS_HOST_OBSERVATIONS,"utf8"));data.width={logical:7,available:6};data.load=[2,3,4];writeFileSync(env.NTS_HOST_OBSERVATIONS,JSON.stringify(data));
  const host=hostObservations(env);
  assert.deepEqual(host.memory(),{availableBytes:123*1024,totalBytes:456*1024});
  assert.deepEqual(host.paging(),{inputPages:0,outputPages:0});
  assert.deepEqual(host.swap(),{totalBytes:0,freeBytes:0});
  assert.deepEqual(host.load(),[2,3,4]);
  assert.deepEqual(host.disk('/a/path/that/does/not/exist'),{freeBytes:789,freeInodes:12});
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

test('an omitted or unreadable observation fails by name, without a host fallback',t=>{
  const root=testScratch(t,'host-observations-omitted'),env=ownMemory(root);
  const file=env.NTS_HOST_OBSERVATIONS,complete=JSON.parse(readFileSync(file,'utf8'));
  for(const [parent,key,name] of [['disk','freeBytes','disk.freeBytes'],['disk','freeInodes','disk.freeInodes'],['memory','file','memory.file'],['paging','file','paging.file'],['resident','defaultBytes','resident.defaultBytes'],['width','logical','width.logical'],['width','available','width.available'],['clock','kind','clock'],['','load','load']] as const){
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
  const job=await reserveJob({key:'fixture-job',what:'owned sampler control'},{env,report:()=>{}});
  const file=env.NTS_HOST_OBSERVATIONS,value=JSON.parse(readFileSync(file,'utf8'));
  delete value.resident;
  writeFileSync(file,JSON.stringify(value));
  assert.throws(()=>job.release(),/host observation resident/);
  assert.deepEqual(readLedger(env.NTS_MEMORY_LEDGER),{waiting:[],admitted:[]});
  assert.equal((env as NodeJS.ProcessEnv).NTS_MEMORY_RESERVATION,undefined);
});


test('the fixture CLI supplies every shared environment field and gate classification follows that list',t=>{
  const root=testScratch(t,'host-observations-cli');
  const result=spawnSync(process.execPath,[new URL('./test-memory.ts',import.meta.url).pathname,root],{encoding:'utf8'});
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
