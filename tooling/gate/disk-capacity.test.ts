import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DiskCapacity,coldBuildForecast,DISK_CAPACITY} from './disk-capacity.ts';
import {completeBuild,completedBuild} from './build-completion.ts';
import {hostObservations} from './host-observations.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';
import {TemporaryAdmission} from './admission.ts';
import {processIdentity} from '../landing/lock.ts';
const GiB=2**30;

test('the forecast is the tool-written sum of declared peaks, rounded once',()=>{
  const forecast=coldBuildForecast();
  assert.equal(forecast.outputs['nts-dev'],5894328320);
  assert.equal(forecast.outputs.clippy,1358548992);
  assert.equal(forecast.bytes,7*GiB);
  assert.equal(Object.values(forecast.outputs).reduce((sum,n)=>sum+n,0),7252877312);
});

test('free trees promise zero; partial declared output consumes a promise; completed owners release it',t=>{
  const root=testScratch(t,'disk-capacity'),target=join(root,'target');
  writeFileSync(join(root,'Cargo.toml'),'[workspace]\n[profile.nts-dev]\ndebug=0\n');
  const observations=join(root,'observations');
  const update=(paths:Record<string,number>)=>ownMemory(observations,{disk:{freeBytes:60*GiB,freeInodes:100},allocated:{kind:'fixed',defaultBytes:0,paths}});
  const env=update({}),host=hostObservations(env),capacity=new DiskCapacity({env,host,pool:null});
  assert.equal(capacity.snapshot(root,[]).reservedBytes,0);
  assert.equal(capacity.snapshot(root,[{root,target}]).reservedBytes,7*GiB);
  update({[join(target,'nts-dev')]:GiB,[join(target,'evidence')]:77*GiB,[join(target,'debug')]:100*GiB});
  assert.equal(capacity.snapshot(root,[{root,target}]).reservedBytes,6*GiB);
  for(const name of ['nts-dev','clippy'] as const){const output=join(target,name);mkdirSync(output,{recursive:true});completeBuild(root,name,output);}
  assert.equal(capacity.snapshot(root,[{root,target}]).reservedBytes,0);
  writeFileSync(join(root,'Cargo.toml'),'[workspace]\n[profile.nts-dev]\ndebug=1\n');
  assert.equal(completedBuild(root,'nts-dev',join(target,'nts-dev')),false,'a different profile generation is cold again');
  assert.ok(capacity.snapshot(root,[{root,target}]).reservedBytes>0);
});

test('temporary admission sees the same outstanding build promises',t=>{
  const root=testScratch(t,'disk-admission'),target=join(root,'target');
  const env=ownMemory(join(root,'observations'),{disk:{freeBytes:47*GiB,freeInodes:100}});
  const capacity=new DiskCapacity({env,pool:null});
  capacity.activeLeases=()=>[{root,target}];
  const admission=new TemporaryAdmission({path:root,context:{kind:'standalone'},reservedBytes:GiB,host:capacity.host,capacity});
  const result=admission.check();
  assert.equal(result.buildPromisesBytes,7*GiB);
  assert.equal(result.requiredFreeBytes,48*GiB);
  assert.equal(result.admitted,false);
});

test('fixture capacity cannot discover the account pool, and its grant is complete',t=>{
  const root=testScratch(t,'disk-capability'),env=ownMemory(join(root,'observations'));
  assert.deepEqual(JSON.parse(readFileSync(env[DISK_CAPACITY]!,'utf8')),{version:1,pool:null});
  assert.deepEqual(new DiskCapacity({env:{...env,NTS_TEST_ENVIRONMENT:'1'}}).activeLeases(),[]);
  assert.throws(()=>new DiskCapacity({env:{...env,NTS_TEST_ENVIRONMENT:'',NTS_DISK_CAPACITY:undefined}}),/fixture has no NTS_DISK_CAPACITY/);
});

test('service builds claim only declared profiles, merge one target, and reclaim a dead owner',t=>{
  const root=testScratch(t,'service-build-disk'),target=join(root,'target');
  const env=ownMemory(join(root,'observations'),{disk:{freeBytes:60*GiB,freeInodes:100}}),capacity=new DiskCapacity({env});
  const tests=capacity.beginBuild({root,target,outputs:['nts-dev']});
  assert.equal(capacity.snapshot(root).reservedBytes,6*GiB);
  const clippy=capacity.beginBuild({root,target,outputs:['clippy']});
  assert.equal(capacity.snapshot(root).reservedBytes,7*GiB,'two builders of one target share the combined forecast');
  tests();assert.equal(capacity.snapshot(root).reservedBytes,2*GiB);
  clippy();assert.equal(capacity.snapshot(root).reservedBytes,0);
  writeFileSync(capacity.stateFile,JSON.stringify({version:1,claims:[{id:'dead',root,target,outputs:['nts-dev'],pid:process.pid,identity:processIdentity(process.pid)+'-wrong-birth'}]}));
  assert.equal(capacity.snapshot(root).reservedBytes,0,'a reused pid cannot keep a claim alive');
  const release=capacity.beginBuild({root,target,outputs:['clippy']});
  assert.equal(JSON.parse(readFileSync(capacity.stateFile,'utf8')).claims.length,1,'the next write reclaims the dead claim');
  release();
});

test('capacity refuses before a builder starts and never downgrades future claims',t=>{
  const root=testScratch(t,'build-refusal'),target=join(root,'target');
  const env=ownMemory(join(root,'observations'),{disk:{freeBytes:45*GiB,freeInodes:100}}),capacity=new DiskCapacity({env});
  assert.throws(()=>capacity.beginBuild({root,target,outputs:['nts-dev']}),/disk build admission/);
  writeFileSync(capacity.stateFile,'{"version":2,"future":"keep"}\n');
  const before=readFileSync(capacity.stateFile,'utf8');
  assert.throws(()=>capacity.beginBuild({root,target,outputs:['clippy']}),/version/);
  assert.equal(readFileSync(capacity.stateFile,'utf8'),before);
});
