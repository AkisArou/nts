import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DiskCapacity,coldBuildForecast,DISK_CAPACITY} from './disk-capacity.ts';
import {completeBuild,completedBuild} from './build-completion.ts';
import {hostObservations} from './host-observations.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';
import {TemporaryAdmission} from './admission.ts';
import {processIdentity} from '../landing/lock.ts';
import {spawn} from 'node:child_process';
import {fixtureEnvironment} from './test-environment.ts';
import {waitFor} from './test-wait.ts';
import {DiskBuildAdmissionError} from './step-result.ts';
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
  const {snapshot:result,lease}=admission.tryAcquire();assert.equal(lease,null);
  assert.equal(result.buildPromisesBytes,7*GiB);
  assert.equal(result.requiredFreeBytes,48*GiB);
  assert.equal(result.admitted,false);
});

test('two temporary requests cannot spend the same bytes and release only their own claims',t=>{
  const root=testScratch(t,'temporary-disk-claims'),env=ownMemory(join(root,'observations'),{disk:{freeBytes:41*GiB,freeInodes:100}});
  const first=new DiskCapacity({env}),second=new DiskCapacity({env});
  const a=first.tryTemporary(join(root,'first'),GiB);assert.ok(a.lease);
  try{
    const b=second.tryTemporary(join(root,'second'),GiB);assert.equal(b.lease,null);
    assert.equal(b.snapshot.temporaryReservedBytes,GiB);assert.equal(b.snapshot.availableBytes,0);
    assert.equal(first.snapshot(root).reservedBytes,GiB);
    assert.equal(existsSync(first.stateFile),false,'temporary acquisition does not rewrite the build schema');
    a.lease.release();a.lease.release();
    const c=second.tryTemporary(join(root,'second'),GiB);assert.ok(c.lease);
    try{a.lease.release();assert.equal(first.snapshot(root).temporaryReservedBytes,GiB);}
    finally{c.lease.release();}
    assert.equal(first.snapshot(root).reservedBytes,0);
  }finally{a.lease.release();}
});

test('builds and pool leases see temporary promises through the same capacity equation',t=>{
  const root=testScratch(t,'temporary-build-equation'),target=join(root,'target');
  const env=ownMemory(join(root,'observations'),{disk:{freeBytes:46*GiB,freeInodes:100}}),capacity=new DiskCapacity({env});
  const temporary=capacity.tryTemporary(join(root,'capture'),GiB);assert.ok(temporary.lease);
  try{
    assert.throws(()=>capacity.beginBuild({root,target,outputs:['nts-dev']}),/disk build admission/);
    assert.equal(capacity.poolSnapshot(root,[{root,target}]).reservedBytes,8*GiB);
    assert.equal(capacity.poolSnapshot(root,[{root,target}]).temporaryReservedBytes,GiB);
  }finally{temporary.lease.release();}
  const build=capacity.beginBuild({root,target,outputs:['nts-dev']});
  try{assert.equal(capacity.tryTemporary(join(root,'capture'),GiB).lease,null);}
  finally{build();}
});

test('dead and reused temporary owners are reclaimed, while future state is never overwritten',t=>{
  const root=testScratch(t,'temporary-owner-generation'),env=ownMemory(join(root,'observations'),{disk:{freeBytes:41*GiB,freeInodes:100}}),capacity=new DiskCapacity({env});
  const wrong={id:'old',path:join(root,'old'),bytes:GiB,pid:process.pid,identity:processIdentity(process.pid)+'-wrong-birth'};
  writeFileSync(capacity.temporaryStateFile,JSON.stringify({version:1,claims:[wrong]}));
  assert.equal(capacity.snapshot(root).reservedBytes,0);
  const attempt=capacity.tryTemporary(join(root,'new'),GiB);assert.ok(attempt.lease);
  try{assert.equal(JSON.parse(readFileSync(capacity.temporaryStateFile,'utf8')).claims.length,1);}
  finally{attempt.lease.release();}
  writeFileSync(capacity.temporaryStateFile,'{"version":2,"future":"keep"}\n');
  const before=readFileSync(capacity.temporaryStateFile,'utf8');
  assert.throws(()=>capacity.tryTemporary(join(root,'new'),GiB),/version/);
  assert.equal(readFileSync(capacity.temporaryStateFile,'utf8'),before);
});

function contender(t:import('node:test').TestContext,root:string,env:NodeJS.ProcessEnv){
  const code=`import {createInterface} from 'node:readline';
import {DiskCapacity} from ${JSON.stringify(new URL('./disk-capacity.ts',import.meta.url).href)};
const owner=new DiskCapacity(),input=createInterface({input:process.stdin});let lease;
const send=value=>console.log(JSON.stringify(value));
input.on('line',command=>{
 if(command==='acquire'){const attempt=owner.tryTemporary(${JSON.stringify(root)}+'/capture-'+process.pid,2**30);lease=attempt.lease;send({kind:'attempt',admitted:lease!==null,promised:attempt.snapshot.temporaryReservedBytes});}
 else if(command==='release'){lease?.release();lease=null;send({kind:'released'});}
 else if(command==='crash')throw Error('deliberately abandoned temporary disk claim');
 else if(command==='finish'){lease?.release();input.close();}
});send({kind:'ready'});`;
  const child=spawn(process.execPath,['--input-type=module','-e',code],{env:{...fixtureEnvironment(t),...env},stdio:['pipe','pipe','pipe']});
  const rows:{kind:string;admitted?:boolean;promised?:number}[]=[];let pending='',stderr='';
  child.stdout.on('data',bytes=>{pending+=String(bytes);for(;;){const end=pending.indexOf('\n');if(end<0)break;rows.push(JSON.parse(pending.slice(0,end)));pending=pending.slice(end+1);}});
  child.stderr.on('data',bytes=>{stderr+=String(bytes);});
  let stopped:string|undefined;
  const closed=new Promise<{status:number|null;signal:NodeJS.Signals|null}>((done,reject)=>{child.once('error',error=>{stopped=String(error);reject(error);});child.once('close',(status,signal)=>{stopped='temporary contender ended: '+status+' '+signal;done({status,signal});});});
  const send=(command:string)=>child.stdin.write(command+'\n');
  t.after(async()=>{if(!child.stdin.destroyed)child.stdin.end('finish\n');await closed;});
  return {child,rows,closed,send,stderr:()=>stderr,stopped:()=>stopped};
}

test('simultaneous processes serialize their byte claims before either receives admission',async t=>{
  const root=testScratch(t,'temporary-concurrent'),env=ownMemory(join(root,'observations'),{disk:{freeBytes:41*GiB,freeInodes:100}});
  const contenders=[contender(t,root,env),contender(t,root,env)];
  const stopped=()=>contenders.map(row=>row.stopped()).find(Boolean);
  await waitFor('both temporary contenders ready',()=>contenders.every(row=>row.rows.some(event=>event.kind==='ready')),{stopped});
  for(const row of contenders)row.send('acquire');
  await waitFor('both atomic admission answers',()=>contenders.every(row=>row.rows.some(event=>event.kind==='attempt')),{stopped});
  const admitted=contenders.find(row=>row.rows.some(event=>event.kind==='attempt'&&event.admitted));
  const denied=contenders.find(row=>row.rows.some(event=>event.kind==='attempt'&&!event.admitted));assert.ok(admitted);assert.ok(denied);assert.notEqual(admitted,denied);
  assert.equal(new DiskCapacity({env}).snapshot(root).temporaryReservedBytes,GiB);
  admitted.send('release');await waitFor('first holder release',()=>admitted.rows.some(event=>event.kind==='released'),{stopped});
  denied.send('acquire');await waitFor('second contender admission after release',()=>denied.rows.filter(event=>event.kind==='attempt').length===2,{stopped});
  assert.equal(denied.rows.at(-1)?.admitted,true);
  denied.send('release');await waitFor('second holder release',()=>denied.rows.some(event=>event.kind==='released'),{stopped});
  assert.equal(new DiskCapacity({env}).snapshot(root).temporaryReservedBytes,0);
});

test('a failed child that abandons its acquired claim cannot hold later admissions',async t=>{
  const root=testScratch(t,'temporary-crashed-holder'),env=ownMemory(join(root,'observations'),{disk:{freeBytes:41*GiB,freeInodes:100}}),owner=new DiskCapacity({env});
  const child=contender(t,root,env);await waitFor('abandoning holder ready',()=>child.rows.some(row=>row.kind==='ready'),{stopped:child.stopped});
  child.send('acquire');await waitFor('abandoning holder acquired',()=>child.rows.some(row=>row.kind==='attempt'),{stopped:child.stopped});
  assert.equal(child.rows.at(-1)?.admitted,true);assert.equal(owner.snapshot(root).temporaryReservedBytes,GiB);
  child.send('crash');assert.deepEqual(await child.closed,{status:1,signal:null});assert.match(child.stderr(),/deliberately abandoned temporary disk claim/);
  assert.equal(JSON.parse(readFileSync(owner.temporaryStateFile,'utf8')).claims.length,1,'no graceful release ran');
  const next=owner.tryTemporary(join(root,'next'),GiB);assert.ok(next.lease);
  try{assert.equal(JSON.parse(readFileSync(owner.temporaryStateFile,'utf8')).claims.length,1,'dead claim is replaced by only the actual next owner');}
  finally{next.lease.release();}
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
  assert.throws(()=>capacity.beginBuild({root,target,outputs:['nts-dev']}),error=>{
    assert.ok(error instanceof DiskBuildAdmissionError);assert.equal(error.kind,'disk-capacity');
    assert.deepEqual(error.disk,{root,target,outputs:['nts-dev'],shortBytes:GiB,freeBytes:45*GiB,floorBytes:40*GiB,buildReservedBytes:6*GiB,temporaryReservedBytes:0});
    return true;
  });
  assert.equal(existsSync(capacity.stateFile),false,'a refused attempt publishes no build claim');
  assert.equal(capacity.buildSnapshot({root,target,outputs:['nts-dev']}).availableBytes,-GiB);
  writeFileSync(capacity.stateFile,'{"version":2,"future":"keep"}\n');
  const before=readFileSync(capacity.stateFile,'utf8');
  assert.throws(()=>capacity.beginBuild({root,target,outputs:['clippy']}),/version/);
  assert.equal(readFileSync(capacity.stateFile,'utf8'),before);
});
