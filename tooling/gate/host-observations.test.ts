import {declareOwnMembers} from './test-cgroup-members.ts';
import {fixtureEnvironment} from "./test-environment.ts";
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {HOST_OBSERVATIONS,HOST_OBSERVATION_ENVIRONMENT,hostObservations,parseCgroupCpu,CgroupObservations,CgroupDeparted,HostObservationError,retainedCgroupCharge,retainedCgroupMembers,retainedCgroupPopulation,reportMemoryFailure,type CgroupFiles} from './host-observations.ts';
import {gateEnvironment,assertLandingEnvironment} from './canonical-environment.ts';
import {hostEnvironment,acquireHostObservations} from './host-environment.ts';
import {TemporaryAdmission} from './admission.ts';
import {reserve,reserveJob,readLedger,lockLedger,entryUsage,type LedgerEntry} from './memory-ledger.ts';
import {waitFor} from './test-wait.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';
import {compileActive,closeMemoryRun,MemoryRun} from '../census/worker-memory.ts';
import {treeProcessFixture} from '../landing/tree-users-fixture.ts';
import {assertNoObservedProcessUsers} from '../landing/tree-users.ts';

test('process users come from the owned observation, with missing or malformed views refusing by name',t=>{
  const f=treeProcessFixture(t),env=ownMemory(join(f.root,'observations')),host=hostObservations(env);
  assert.deepEqual(host.processUsers([f.tree]),{users:[],ignored:[],unreadable:[]});
  ownMemory(join(f.root,'observations'),{processUsers:{kind:'proc',root:f.proc}});
  assert.deepEqual(host.processUsers([f.tree]),{users:[],ignored:[],unreadable:[]});
  const file=env.NTS_HOST_OBSERVATIONS,complete=JSON.parse(readFileSync(file,'utf8'));
  for(const value of [undefined,{kind:'proc'},{kind:'proc',root:'relative'},{kind:'live'},{kind:'live',pids:[0]},{kind:'live',pids:[42,42]}]){
    writeFileSync(file,JSON.stringify({...complete,processUsers:value}));
    assert.throws(()=>hostObservations(env),/host observation processUsers/);
  }
  writeFileSync(file,JSON.stringify(complete));
  ownMemory(join(f.root,'observations'),{availableKiB:123});
  assert.deepEqual(JSON.parse(readFileSync(file,'utf8')).processUsers,complete.processUsers,'memory updates preserve the selected process observation');
  assert.deepEqual(assertNoObservedProcessUsers(host.processUsers([f.tree])),[]);
  rmSync(f.proc,{recursive:true});
  assert.throws(()=>host.processUsers([f.tree]),/host observation processUsers failed/);
});

test('constructing an observation validates descriptors without walking proc or reading resource files',t=>{
 const root=testScratch(t,'host-validation-only'),env=ownMemory(root,{processUsers:{kind:'proc',root:join(root,'unread-proc')}});
 const file=env.NTS_HOST_OBSERVATIONS,value=JSON.parse(readFileSync(file,'utf8'));
 value.memory.file=join(root,'unread-memory');value.paging.file=join(root,'unread-paging');writeFileSync(file,JSON.stringify(value));
 const host=hostObservations(env);
 assert.equal(typeof host.processUsers,'function');assert.equal(typeof host.memory,'function');
 assert.throws(()=>host.processUsers([root]),/host observation processUsers failed/);
 assert.throws(()=>host.memory(),/host observation memory.file/);
});

test('launch acquisition binds the descriptor and view from the supplied packet without changing ambient values',t=>{
 const root=testScratch(t,'host-launch-packet'),ambient=ownMemory(join(root,'ambient'));
 const supplied=ownMemory(join(root,'supplied'),{processUsers:{kind:'proc',root:join(root,'not-read-at-acquisition')}}),before={...ambient};
 const acquired=acquireHostObservations(ambient,supplied);
 assert.equal(acquired.descriptor,supplied.NTS_HOST_OBSERVATIONS);assert.notEqual(acquired.descriptor,ambient.NTS_HOST_OBSERVATIONS);
 assert.deepEqual(ambient,before);assert.throws(()=>acquired.observations.processUsers([root]),/host observation processUsers failed/);
 assert.deepEqual(hostObservations(ambient).processUsers([root]),{users:[],ignored:[],unreadable:[]});
});

test('one complete owned view supplies every resource, including child observations',t=>{
  const root=testScratch(t,'host-observations'),clock=join(root,'clock');
  writeFileSync(clock,'125');
  const env=ownMemory(root,{availableKiB:123,totalKiB:456,clock:{kind:'file',file:clock},
    disk:{freeBytes:789,freeInodes:12},allocated:{kind:'fixed',defaultBytes:11,paths:{'/owned/build':456}},resident:{kind:'fixed',defaultBytes:34,processes:{'71':56},cgroups:{'/owned':78},members:{'/owned':[71]}}});
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
  assert.deepEqual(host.cgroupMembers('/owned'),[71]);assert.throws(()=>host.cgroupMembers('/missing'),/host observation resident.members has no cgroup \/missing/);
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

test('temporary admission obeys the same owned disk even when the path cannot be read on the host',async t=>{
  const root=testScratch(t,'host-observations-disk'),env=ownMemory(root,{disk:{freeBytes:0,freeInodes:0}});
  const host=hostObservations(env),admission=new TemporaryAdmission({path:'/unreadable/missing',context:{kind:'standalone'},reservedBytes:1024,host,env});
  const stop=new AbortController();let refused:boolean|undefined;
  await assert.rejects(admission.acquire({what:'owned disk',signal:stop.signal,report:(_,snapshot)=>{refused=!snapshot.admitted;stop.abort();}}));
  assert.equal(refused,true);
  ownMemory(root,{disk:{freeBytes:2**40,freeInodes:2**30}});
  const attempt=await admission.acquire({what:'owned disk',report:()=>assert.fail('free disk admits without a report')});assert.equal(attempt.snapshot.admitted,true);attempt.lease.release();
});


test('a missing sampler observation fails its job and still releases the owned ledger',async t=>{
  const root=testScratch(t,'host-observations-sampler'),env=ownMemory(root);
  declareOwnMembers(env,[process.pid]);
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

// Kernel file operations are supplied together. A child's parent listing is
// the existence witness even if that child departs before its first stat.
function cgroupFiles(){
  const root='/owned',child=root+'/worker',present=new Set([root,child]);
  let failed:{group:string;operation:string;code:string}|undefined,hits=0;
  const check=(group:string,operation:string)=>{
    if(failed?.group===group&&failed.operation===operation){hits++;throw Object.assign(Error('supplied '+failed.code),{code:failed.code});}
    if(!present.has(group))throw Object.assign(Error('never existed'),{code:'ENOENT'});
  };
  const files:CgroupFiles={
    inode:group=>{check(group,'stat');return group;},
    text:(group,file)=>{check(group,file);if(file==='cgroup.procs')return group===root?'11':'12';if(file==='memory.peak')return '456';if(file==='memory.current')return '123';if(file==='memory.stat')return 'active_file 0\ninactive_file 0\nslab_reclaimable 0\n';throw Error('unexpected file '+file);},
    children:group=>{check(group,'children');return group===root?['worker']:[];},
  };
  return {root,child,files,present,fail:(group:string,operation:string,code:string)=>{failed={group,operation,code};},hits:()=>hits};
}

for(const code of ['ENODEV','ENOENT','ESRCH'])for(const operation of ['cgroup.procs','children','stat'])
test(`a listed scope departing at ${operation} with ${code} ends only its membership sample`,t=>{
  const f=cgroupFiles(),reader=new CgroupObservations(f.files),env=ownMemory(testScratch(t,'departed-membership'));
  const host={...hostObservations(env),cgroupCharge:(group:string,inode?:string)=>reader.charge(group,inode),cgroupMembers:(group:string,inode?:string)=>reader.members(group,inode),cgroupPopulation:(group:string,inode?:string)=>reader.population(group,inode)};
  const entry={owner:{pid:process.pid},measure:{tree:true,cgroup:{path:f.root,inode:f.root}}} as LedgerEntry;
  assert.deepEqual(host.cgroupMembers(f.root),[11,12]);assert.equal(entryUsage(entry,{host}),123);
  f.fail(f.child,operation,code);
  assert.equal(entryUsage(entry,{host}),123,'the surviving step retains its own charge');
  assert.ok(f.hits()>0,'the ledger routes the operation through its observation owner');
  assert.deepEqual(host.cgroupMembers(f.root),[11]);
  assert.throws(()=>host.cgroupMembers(f.child),error=>error instanceof CgroupDeparted&&error.group===f.child&&(error.cause as NodeJS.ErrnoException).code===code);
});

for(const code of ['ENODEV','ENOENT','ESRCH'])for(const operation of ['memory.current','memory.stat','stat','open'])
test(`an acquired scope departing at ${operation} maps ${code} through the owner`,()=>{
  const f=cgroupFiles(),reader=new CgroupObservations(f.files);
  reader.charge(f.child);f.fail(f.child,operation,code);
  if(operation==='open')assert.throws(()=>reader.observe(f.child,'open',()=>{throw Object.assign(Error(code),{code});}),CgroupDeparted);
  else assert.throws(()=>reader.charge(f.child),error=>error instanceof CgroupDeparted&&error.group===f.child&&(error.cause as NodeJS.ErrnoException).code===code);
});

test('a parent listing proves existence before a first child observation',()=>{
  const f=cgroupFiles(),reader=new CgroupObservations(f.files);
  f.fail(f.child,'stat','ENODEV');assert.deepEqual(reader.members(f.root),[11]);assert.equal(f.hits(),1);
});

for(const code of ['EACCES','EIO'])for(const operation of ['cgroup.procs','children','stat','memory.current','memory.stat'])
test(`an acquired scope's ${operation} failure with ${code} remains a named error`,()=>{
  const f=cgroupFiles(),reader=new CgroupObservations(f.files);
  reader.charge(f.child);f.fail(f.child,operation,code);
  assert.throws(()=>operation.startsWith('memory.')?reader.charge(f.child):reader.members(f.root),error=>
    error instanceof HostObservationError&&!(error instanceof CgroupDeparted)&&error.message.includes(operation)&&error.message.includes(code));
});

test('a never-observed scope is a named error, never a departed sample',()=>{
  const f=cgroupFiles(),reader=new CgroupObservations(f.files);
  for(const operation of [()=>reader.members('/never-created'),()=>reader.children('/never-created'),()=>reader.charge('/never-created')])
    assert.throws(operation,error=>error instanceof HostObservationError&&!(error instanceof CgroupDeparted)&&error.message.includes('/never-created'));
  for(const code of ['ENODEV','ENOENT','ESRCH']){
    f.fail('/never-created','stat',code);
    assert.throws(()=>reader.members('/never-created'),error=>error instanceof HostObservationError&&!(error instanceof CgroupDeparted)&&error.message.includes(code));
  }
});

test('retained root samples finish on departure and preserve other instrument failures',t=>{
  const f=cgroupFiles(),reader=new CgroupObservations(f.files),env=ownMemory(testScratch(t,'retained-departure'));
  const host={...hostObservations(env),cgroupCharge:(group:string,inode?:string)=>reader.charge(group,inode),cgroupMembers:(group:string,inode?:string)=>reader.members(group,inode),cgroupPopulation:(group:string,inode?:string)=>reader.population(group,inode)};
  const ref={path:f.child,inode:f.child};
  assert.equal(retainedCgroupCharge(host,ref),123);assert.deepEqual(retainedCgroupMembers(host,ref),[12]);
  assert.deepEqual(retainedCgroupPopulation(host,ref),{pids:[12],unnamed:0});
  f.fail(f.child,'stat','ENODEV');assert.equal(retainedCgroupCharge(host,ref),0);assert.deepEqual(retainedCgroupMembers(host,ref),[]);
  assert.deepEqual(retainedCgroupPopulation(host,ref),{pids:[],unnamed:0});
  f.fail(f.child,'stat','EIO');assert.throws(()=>retainedCgroupCharge(host,ref),/stat.*EIO/);
  assert.throws(()=>retainedCgroupPopulation(host,ref),/stat.*EIO/);
});

test('zero cgroup members retain population and charge but supply no complete PID list',t=>{
  const f=cgroupFiles(),original=f.files.text;
  let procs='123\n0\n',childProcs='0\n0\n';
  f.files.text=(group,file)=>file==='cgroup.procs'?(group===f.root?procs:childProcs):file==='cgroup.events'?'populated 1\n':original(group,file);
  const reader=new CgroupObservations(f.files),host={...hostObservations(ownMemory(testScratch(t,'unnamed-cgroup'))),
    cgroupCharge:(group:string,inode?:string)=>reader.charge(group,inode),cgroupPopulation:(group:string,inode?:string)=>reader.population(group,inode),
    processCharge:(pid:number)=>{assert.equal(pid,123,'only a named excluded member can be inspected');return 23;}};
  assert.deepEqual(reader.population(f.child),{pids:[],unnamed:2},'unnamed members are not deduplicated');
  assert.deepEqual(reader.population(f.root),{pids:[123],unnamed:3},'recursive population retains every unnamed member');
  assert.equal(reader.populated(f.root),true,'the drain observation keeps the group nonempty');
  let signals=0;
  assert.throws(()=>{for(const _pid of reader.members(f.root))signals++;},/cgroup \/owned complete PIDs unavailable: 3 unnamed/);
  assert.equal(signals,0,'an incomplete PID projection grants no per-PID action');
  // No process-tree scan is needed: both the group charge and the named
  // exclusion are supplied observations, independent of real PID 123.
  const entry={owner:{pid:123},measure:{tree:false,cgroup:{path:f.root,inode:f.root}}} as LedgerEntry;
  assert.equal(entryUsage(entry,{host}),123,'unnamed members retain the full cgroup charge');
  assert.equal(entryUsage(entry,{host,exclude:123}),100);
  procs='123\n123\n0\n';
  assert.deepEqual(reader.population(f.root),{pids:[123],unnamed:3},'kernel repeats of a named PID do not duplicate its identity');
  childProcs='123\n0\n0\n';
  assert.deepEqual(reader.population(f.root),{pids:[123],unnamed:3},'a named PID repeated during recursive sampling is counted once');
  procs='123\n0\n';
  f.present.delete(f.child);f.files.children=()=>[];
  assert.deepEqual(reader.population(f.root),{pids:[123],unnamed:1});
  procs='0\n';assert.deepEqual(reader.population(f.root),{pids:[],unnamed:1});
  procs='123\n';assert.deepEqual(reader.members(f.root),[123]);
  procs='';assert.deepEqual(reader.population(f.root),{pids:[],unnamed:0});assert.deepEqual(reader.members(f.root),[]);
  for(const bad of ['abc','-1','-0','1.5','1e2','0x10','Infinity','9007199254740992']){
    procs=bad;assert.throws(()=>reader.population(f.root),error=>error instanceof HostObservationError&&error.message.includes('cgroup /owned cgroup.procs is invalid: '+JSON.stringify(bad)));
  }
});

test('fixed population declarations retain unnamed members and reject malformed declarations',t=>{
  const root=testScratch(t,'fixed-cgroup-population'),env=ownMemory(root,{resident:{kind:'fixed',defaultBytes:0,members:{'/owned':{pids:[123],unnamed:1},'/named':[123]}}}),host=hostObservations(env);
  assert.deepEqual(host.cgroupPopulation('/owned'),{pids:[123],unnamed:1});
  assert.deepEqual(host.cgroupPopulation('/named'),{pids:[123],unnamed:0});
  assert.throws(()=>host.cgroupMembers('/owned'),/cgroup \/owned complete PIDs unavailable: 1 unnamed/);
  assert.deepEqual(host.cgroupMembers('/named'),[123]);
  assert.throws(()=>host.cgroupPopulation('/missing'),/resident.members has no cgroup \/missing/);
  const complete=JSON.parse(readFileSync(env.NTS_HOST_OBSERVATIONS,'utf8'));
  for(const value of [{pids:[0],unnamed:1},{pids:[123,123],unnamed:0},{pids:[123],unnamed:-1},{pids:[123],unnamed:1.5},{pids:[123],unnamed:2**53},{pids:[123]},null,{pids:[123],unnamed:0,extra:true},[0]]){
    writeFileSync(env.NTS_HOST_OBSERVATIONS,JSON.stringify({...complete,resident:{...complete.resident,members:{'/owned':value}}}));
    assert.throws(()=>host.cgroupPopulation('/owned'),/resident.members declaration is invalid for \/owned/);
  }
});

test('a growth rejection reports its full stack and cause before stopping the run',()=>{
  const cause=Object.assign(Error('supplied EIO read'),{code:'EIO'}),failure=new HostObservationError('named observation failed',{cause});
  const lines:string[]=[],stops:string[]=[];
  reportMemoryFailure(failure,line=>lines.push(line),reason=>stops.push(reason));
  assert.deepEqual(lines,[failure.stack,cause.stack]);assert.deepEqual(stops,['memory: named observation failed']);
  assert.match(lines.join('\n'),/host-observations.test.ts/);
});

test('a live child scope exits between samples without changing its completed verdict',async t=>{
  const root=testScratch(t,'membership-live-departure'),ready=join(root,'ready'),release=join(root,'release');
  const env=fixtureEnvironment(t,ownMemory(join(root,'memory'),{resident:{kind:'live'},scopePeak:{kind:'live'}}));
  const host=hostObservations(env),run=new MemoryRun({id:'membership-departure',budgetBytes:256*2**20});
  const worker=run.worker('owned',256*2**20);
  const scope=worker.scope(process.execPath,['--input-type=module','-e',`
import {existsSync,watch} from 'node:fs';
import {durableRecord} from ${JSON.stringify(new URL('./durable-record.ts',import.meta.url).href)};
const stop=()=>{if(existsSync(${JSON.stringify(release)})){watcher.close();}};
const watcher=watch(${JSON.stringify(root)},stop);durableRecord(${JSON.stringify(ready)},{pid:process.pid});stop();
`],env);
  const child=spawn('systemd-run',scope.argv,{env:scope.env,stdio:['ignore','pipe','pipe']});
  let output='',ended=false;
  child.stdout.on('data',part=>{output+=part;});child.stderr.on('data',part=>{output+=part;});
  const closed=new Promise<[number|null,NodeJS.Signals|null]>((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{ended=true;resolve([code,signal]);});});
  try{
    await waitFor('the live scope readiness',()=>existsSync(ready),{stopped:()=>ended?output||'worker exited':undefined});
    const pid=(JSON.parse(readFileSync(ready,'utf8')) as {pid:number}).pid;
    assert.ok(host.cgroupMembers(run.group).includes(pid));host.cgroupCharge(worker.group);
    writeFileSync(release,'');assert.deepEqual(await closed,[0,null],output);
    worker.close();
    assert.throws(()=>host.cgroupCharge(worker.group),CgroupDeparted);
    assert.throws(()=>host.cgroupMembers(worker.group),CgroupDeparted);
    assert.ok(!host.cgroupMembers(run.group).includes(pid));assert.ok(host.cgroupCharge(run.group)>=0);
    assert.throws(()=>host.cgroupMembers(run.group+'/never-created'),error=>error instanceof HostObservationError&&!(error instanceof CgroupDeparted));
  }finally{worker.close();run.close();await closed;}
});


test('physical acquisition never supplies an undeclared fixed membership observation',async t=>{
  const root=testScratch(t,'acquired-members'),env=ownMemory(root),host=hostObservations(env);
  const run=new MemoryRun({budgetBytes:128*2**20,id:'members-acquisition'});
  t.after(async()=>{run.close();await run.closed;});
  assert.throws(()=>host.cgroupMembers(run.group),/host observation resident.members has no cgroup/);
  const held=await reserve({bytes:1,what:'acquired members control',owner:{cgroup:run.group}},{env});
  t.after(async()=>{held.release();await held.closed;});
  const ref=readLedger(env.NTS_MEMORY_LEDGER).admitted.find(entry=>entry.id===held.id)!.measure.cgroup!;
  assert.equal(ref.path,run.group);assert.ok(ref.inode);
  assert.throws(()=>host.cgroupMembers(run.group),/host observation resident.members has no cgroup/);
  assert.throws(()=>hostObservations(env).cgroupMembers(run.group),/host observation resident.members has no cgroup/,'acquisition provenance does not supply membership to a new sampler');
  const child=spawnSync(process.execPath,['--input-type=module','-e',`import {hostObservations} from ${JSON.stringify(new URL('./host-observations.ts',import.meta.url).href)};console.log(JSON.stringify(hostObservations().cgroupMembers(${JSON.stringify(run.group)})));`],{env:{[HOST_OBSERVATIONS]:env.NTS_HOST_OBSERVATIONS},encoding:'utf8'});
  assert.notEqual(child.status,0);assert.match(child.stderr,/host observation resident.members has no cgroup/);
  ownMemory(root,{resident:{kind:'fixed',defaultBytes:0,members:{[run.group]:[process.pid]}}});
  assert.deepEqual(host.cgroupMembers(run.group),[process.pid],'only the declared per-group row supplies membership');
  assert.throws(()=>host.cgroupMembers('/unexpected'),/host observation resident.members has no cgroup \/unexpected/);
});

test('tree plus cgroup accounting refuses an omitted membership observation',t=>{
  const root=testScratch(t,'members-omitted'),group='/owned',host=hostObservations(ownMemory(root,{resident:{kind:'fixed',defaultBytes:0,cgroups:{[group]:123},processes:{[process.pid]:45}}}));
  const entry={owner:{pid:process.pid},measure:{tree:true,cgroup:{path:group,inode:'retained'}}} as LedgerEntry;
  assert.throws(()=>entryUsage(entry,{host}),/host observation resident.members has no cgroup \/owned/);
});
