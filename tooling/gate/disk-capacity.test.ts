import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {existsSync,mkdirSync,readdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {DiskCapacity,coldBuildForecast,DISK_CAPACITY,DISK_BUILD_ADMISSION} from './disk-capacity.ts';
import {completeBuild,completedBuild} from './build-completion.ts';
import {hostObservations,HOST_OBSERVATIONS} from './host-observations.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';
import {TemporaryAdmission} from './admission.ts';
import {acquire,processIdentity,withLock} from '../landing/lock.ts';
import {spawn} from 'node:child_process';
import {fixtureEnvironment} from './test-environment.ts';
import {spawnTest,waitFor} from './test-wait.ts';
import {generatedJavaScript} from './generated-javascript.ts';
import {DiskBuildAdmissionError,ToolingInstrumentError} from './step-result.ts';
import {DiskState,DiskTransactions,type DiskTransaction} from './disk-transaction.ts';
import {ClaimReceipt,GitReceipt,PoolMembershipReceipt} from './disk-preparation.ts';
import {durableRecord} from './durable-record.ts';
import {scratchRepo} from '../landing/scratch-repo.ts';
import {writeWorkerPresence,removeWorkerPresence} from '../landing/pool-presence.ts';
const GiB=2**30;

test('transaction observations measure a real critical section and report only after release',t=>{
  const root=testScratch(t,'disk-transaction-observer'),path=join(root,'.lock');let now=0;
  const rows:DiskTransaction[]=[];
  const owner=new DiskTransactions(path,{now:()=>now},row=>{
    const control=acquire(path);assert.ok(control,'observer runs after lock release');control.release();rows.push(row);
  });
  owner.run('claim-publish',root,()=>{now+=7;});
  assert.throws(()=>owner.run('claim-failure',root,()=>{now+=3;throw Error('control');}),/control/);
  assert.deepEqual(rows.map(row=>[row.operation,row.lockHeldMs,row.maximumLockHeldMs,row.status]),[
    ['claim-publish',7,7,'completed'],['claim-failure',3,7,'failed'],
  ]);
  assert.equal(rows[0]!.identity,processIdentity(process.pid));
});

test('advisory transaction damage and stale identities cannot change a lock decision',t=>{
  const root=testScratch(t,'disk-transaction-sidecar'),path=join(root,'.lock');
  const owner=new DiskTransactions(path,{now:()=>0}),lock=acquire(path);assert.ok(lock);
  try{
    assert.equal(owner.describeHolder(),'holder phase unknown');
    for(const text of ['', '{broken', '{}']){
      writeFileSync(path+'.transaction.json',text);assert.equal(owner.describeHolder(),'holder phase unknown');
    }
    const row={pid:process.pid,identity:processIdentity(process.pid),unit:'fixture.scope',operation:'detach',root,phase:'publish'};
    writeFileSync(path+'.transaction.json',JSON.stringify(row));assert.match(owner.describeHolder(),/holder transaction detach.*phase publish/);
    writeFileSync(path+'.transaction.json',JSON.stringify({...row,identity:row.identity+'-old'}));assert.match(owner.describeHolder(),/stale transaction sidecar/);
  }finally{lock.release();}
});

for(const kind of ['temporary','build'] as const)for(const failedRead of [1,2])
test(kind+' release removes its claim before clock read '+failedRead+' raises a missing observation',t=>{
  const root=testScratch(t,'disk-release-clock'),env=ownMemory(join(root,'observations'),{disk:{freeBytes:(kind==='temporary'?41:47)*GiB,freeInodes:100}});
  const capacity=new DiskCapacity({env,pool:null});
  const admit=(name:string):(()=>void)=>{
    if(kind==='build')return capacity.beginBuild({root:join(root,name),target:join(root,name,'target')});
    const lease=capacity.tryTemporary(join(root,name),GiB).lease;assert.ok(lease);return ()=>lease.release();
  };
  const release=admit('first'),original=capacity.host.now;
  const brokenEnv=ownMemory(join(root,'missing-clock'),{disk:{freeBytes:60*GiB,freeInodes:100}});
  const missing=brokenEnv[HOST_OBSERVATIONS]!,broken=hostObservations(brokenEnv);
  renameSync(missing,missing+'.saved');
  let reads=0,observationError:unknown;
  capacity.host.now=()=>{
    if(++reads!==failedRead)return original();
    try{return broken.now();}catch(error){observationError=error;throw error;}
  };
  try{
    assert.throws(release,error=>{
      assert.equal(error,observationError,'the observation error is raised unchanged');
      assert.match(String(error),/ENOENT/);assert.ok(String(error).includes(missing));return true;
    });
    const file=kind==='build'?capacity.stateFile:capacity.temporaryStateFile;
    assert.deepEqual(JSON.parse(readFileSync(file,'utf8')).claims,[],'removal is durable before the timing error escapes');
    const lock=acquire(capacity.transactions.path);assert.ok(lock,'release also unlocks before reporting the error');lock.release();
  }finally{capacity.host.now=original;}
  const retiredGeneration=capacity.state.read().generation;
  release();assert.equal(capacity.state.read().generation,retiredGeneration,'retrying an already completed release changes no capacity fact');
  const next=admit('next');next();
});

test('duplicate protection and retirement do not invalidate other preparations',t=>{
  const root=testScratch(t,'disk-idempotent-intents'),state=new DiskState(new DiskTransactions(join(root,'.lock'),{now:()=>0}));
  const intent=state.begin(root,'control'),lease={root,target:join(root,'target')};
  state.protect(intent,lease);const protectedGeneration=state.read().generation;
  state.protect(intent,{...lease,outputs:['clippy']});assert.equal(state.read().generation,protectedGeneration);
  state.end(intent);const retiredGeneration=state.read().generation;
  state.end(intent);assert.equal(state.read().generation,retiredGeneration);
});

test('prepare rejects an ABA mutation by generation even when its bytes are restored',t=>{
  const root=testScratch(t,'disk-generation-aba'),state=new DiskState(new DiskTransactions(join(root,'.lock'),{now:()=>0}));
  let observations=0,value='original',publications=0;
  const result=state.prepared('control',root,()=>{
    observations++;
    if(observations===1){const intent=state.begin(root,'change');value='changed';state.end(intent);value='original';}
    return value;
  },seen=>{publications++;return seen;});
  assert.equal(result,'original');assert.equal(observations,2);assert.equal(publications,1);
});

test('preparation observations expose each retry and cumulative latency under supplied churn',t=>{
  const root=testScratch(t,'disk-preparation-churn'),rows:DiskTransaction[]=[];let now=0,observations=0;
  const owner=new DiskTransactions(join(root,'.lock'),{now:()=>now},row=>rows.push(row)),state=new DiskState(owner);
  const result=state.prepared('churn',root,()=>{
    observations++;now+=35_000;
    if(observations<=3){const intent=state.begin(join(root,'other'),'churn-control');state.end(intent);}
    return 'prepared';
  },value=>value);
  assert.equal(result,'prepared');assert.equal(observations,4);
  const publications=rows.filter(row=>row.operation==='churn-publish');
  assert.deepEqual(publications.map(row=>[row.preparation?.attempt,row.preparation?.retries,row.preparation?.invalidation,row.preparation?.elapsedMs,row.preparation?.observationMs]),[
    [1,1,'generation',35_000,35_000],[2,2,'generation',70_000,35_000],[3,3,'generation',105_000,35_000],[4,3,undefined,140_000,35_000],
  ]);
  assert.equal(new Set(publications.map(row=>row.preparation?.id)).size,1);
  assert.equal(Math.max(...rows.map(row=>row.lockHeldMs)),0);
});

test('shallow membership timing reports its entry count without counting the hold twice',t=>{
  const root=testScratch(t,'disk-phase-timing'),rows:DiskTransaction[]=[];let now=0;
  const owner=new DiskTransactions(join(root,'.lock'),{now:()=>now},row=>rows.push(row));
  owner.run('capture',root,()=>{owner.measure('pool-membership-capture',()=>{now+=7;return 13;},entries=>entries);now+=2;});
  assert.deepEqual(rows[0]!.phases,[{phase:'pool-membership-capture',entries:13,lockHeldMs:7}]);
  assert.equal(rows[0]!.lockHeldMs,9);assert.equal(owner.totalLockHeldMs,9);
});

for(const kind of ['temporary','build'] as const)for(const order of ['old-first','new-first'] as const)
test('a claim-less legacy pool take cannot double spend with '+kind+' admission: '+order,t=>{
  const s=scratchRepo(t,'disk-legacy-take');s.commit({'.gitignore':'target/\n','Cargo.toml':'[workspace]\n'},'policy');
  const dir=join(s.dir,'pool'),tree=join(dir,'1'),root=join(s.dir,'independent');mkdirSync(dir);
  s.git(['worktree','add','-q','--detach',tree,'main']);
  const env=ownMemory(join(s.dir,'observations'),{disk:{freeBytes:49*GiB,freeInodes:1000}});
  const capacity=new DiskCapacity({env,pool:{dir,git:{root:s.root,env:s.env}},reclamation:{services:[],ownership:()=>{throw Error('fixture retains its free checkout');}}});
  const legacyTake=()=>withLock(join(dir,'.lock'),()=>{
    const generation=capacity.state.read().generation;
    const snapshot=capacity.poolSnapshot(dir,[...capacity.activeLeases(),{root:tree,target:join(tree,'target')}]);
    if(snapshot.availableBytes<0)throw Error('legacy pool room denied');
    s.git(['switch','-q','-c','legacy-task','main'],tree);writeWorkerPresence(tree,'legacy-task','attached',0);
    assert.equal(capacity.state.read().generation,generation,'main take writes no generation or claim');
  });
  const admit=()=>kind==='temporary'?capacity.tryTemporary(root,4*GiB).lease:capacity.beginBuild({root,target:join(root,'target')});
  if(order==='new-first'){
    const held=admit();assert.ok(held);
    try{assert.throws(legacyTake,/legacy pool room denied/);}finally{if(typeof held==='function')held();else held.release();}
  }else{
    const run=capacity.transactions.run.bind(capacity.transactions);let took=false;
    capacity.transactions.run=(operation,path,body,wait,options)=>{
      if(operation===(kind==='temporary'?'temporary-admission-publish':'build-admission-publish')&&!took){took=true;legacyTake();}
      return run(operation,path,body,wait,options);
    };
    if(kind==='temporary')assert.equal(admit(),null);else assert.throws(admit,DiskBuildAdmissionError);
    assert.equal(took,true);assert.equal(capacity.activeLeases().length,1);
  }
});

test('Git membership detects add B, add C, give B and reclaim B while C stays attached',t=>{
  const s=scratchRepo(t,'disk-membership'),dir=join(s.dir,'pool');mkdirSync(dir);
  s.commit({'.gitignore':'target/\n','Cargo.toml':'[workspace]\n'},'policy');
  s.git(['worktree','add','-q','--detach',join(dir,'1'),'main']);
  const receipt=new PoolMembershipReceipt(s.root);assert.equal(receipt.entryCount,1);
  for(const [name,branch]of [['2','legacy-B'],['3','legacy-C']]){
    const tree=join(dir,name!);s.git(['worktree','add','-q','-b',branch!,tree,'main']);writeWorkerPresence(tree,branch!,'attached',0);
  }
  const b=join(dir,'2');s.git(['switch','-q','--detach','main'],b);removeWorkerPresence(b);s.git(['worktree','remove',b]);
  assert.equal(existsSync(b),false);assert.equal(receipt.recheck().valid,false);
  assert.equal(new PoolMembershipReceipt(s.root).roots(dir).length,2);
});

function registrationPool(t:TestContext){
  const s=scratchRepo(t,'disk-registration');s.commit({'.gitignore':'target/\n','Cargo.toml':'[workspace]\n'},'policy');
  const dir=join(s.dir,'pool'),tree=join(dir,'1');mkdirSync(dir);s.git(['worktree','add','-q','--detach',tree,'main']);
  const env=ownMemory(join(s.dir,'observations'),{disk:{freeBytes:200*GiB,freeInodes:1000}}),rows:DiskTransaction[]=[];
  const capacity=new DiskCapacity({env,pool:{dir,git:{root:s.root,env:s.env}},observeTransaction:row=>rows.push(row),reclamation:{services:[],ownership:()=>{}}});
  return {s,dir,tree,capacity,rows,registry:join(s.root,'.git/worktrees')};
}

test('an initializing-only registration does not hold any pool capacity route',t=>{
  const f=registrationPool(t),entry=join(f.registry,'interrupted-pin');mkdirSync(entry);writeFileSync(join(entry,'locked'),'initializing');
  assert.equal(f.s.git(['worktree','list','--porcelain']).includes('interrupted-pin'),false,'Git skips a registration with no gitdir');
  const request={root:f.tree,target:join(f.tree,'target')};
  const temporary=f.capacity.tryTemporary(f.dir,GiB).lease;assert.ok(temporary);temporary.release();
  const build=f.capacity.beginBuild(request);build();
  assert.ok(f.capacity.buildSnapshot(request).availableBytes>0);
  assert.ok(f.capacity.snapshot(f.dir).availableBytes>0);
  assert.equal(f.rows.some(row=>(row.preparation?.retries??0)>0),false,'a persistent irrelevant partial entry cannot cause a retry loop');
});

test('a registration removed between enumeration and metadata is an invalid receipt, not an exception',t=>{
  const f=registrationPool(t),entry=join(f.registry,'departing-pin');mkdirSync(entry);writeFileSync(join(entry,'locked'),'initializing');
  let removed=false;
  const receipt=new PoolMembershipReceipt(f.s.root,path=>{
    const names=readdirSync(path);
    if(!removed){assert.ok(names.includes('departing-pin'));rmSync(entry,{recursive:true});removed=true;}
    return names;
  });
  assert.equal(removed,true);assert.equal(receipt.recheck().valid,false);
  assert.equal(new PoolMembershipReceipt(f.s.root).recheck().valid,true,'the next capture sees stable membership');
  const temporary=f.capacity.tryTemporary(f.dir,GiB).lease;assert.ok(temporary);temporary.release();
});

for(const action of ['add','remove','complete'] as const)
test('a non-pool registration '+action+' during preparation cancels and retries',t=>{
  const f=registrationPool(t),outside=join(f.s.dir,'pin-tree'),entry=join(f.registry,'initializing-pin');
  if(action==='remove')f.s.git(['worktree','add','-q','--detach',outside,'main']);
  if(action==='complete'){mkdirSync(entry);writeFileSync(join(entry,'locked'),'initializing');}
  const run=f.capacity.transactions.run.bind(f.capacity.transactions);let changed=false;
  f.capacity.transactions.run=(operation,path,body,wait,options)=>{
    if(operation==='capacity-snapshot-publish'&&!changed){
      changed=true;
      if(action==='add')f.s.git(['worktree','add','-q','--detach',outside,'main']);
      if(action==='remove')f.s.git(['worktree','remove',outside]);
      if(action==='complete'){
        writeFileSync(join(entry,'gitdir'),join(outside,'.git')+'\n');
        writeFileSync(join(entry,'HEAD'),f.s.git(['rev-parse','main'])+'\n');
      }
    }
    return run(operation,path,body,wait,options);
  };
  assert.ok(f.capacity.snapshot(f.dir).availableBytes>0);assert.equal(changed,true);
  const publications=f.rows.filter(row=>row.operation==='capacity-snapshot-publish');
  assert.deepEqual(publications.map(row=>[row.preparation?.attempt,row.preparation?.retries,row.preparation?.invalidation]),[[1,1,'receipt'],[2,1,undefined]]);
});

for(const changeRef of [false,true])
test('an empty non-request Git pointer still binds its registered lease, ref change '+changeRef,t=>{
  const f=registrationPool(t);f.s.git(['switch','-q','-c','worker','main'],f.tree);
  const next=f.s.commit({'next.txt':'next identity\n'},'next'),path=join(f.tree,'.git'),pointer=readFileSync(path,'utf8');
  const run=f.capacity.transactions.run.bind(f.capacity.transactions);let changed=false;
  f.capacity.transactions.run=(operation,root,body,wait,options)=>{
    if(changeRef&&operation==='capacity-snapshot-publish'&&!changed){changed=true;f.s.git(['update-ref','refs/heads/worker',next]);}
    return run(operation,root,body,wait,options);
  };
  writeFileSync(path,'');
  try{
    assert.equal(f.capacity.snapshot(f.dir).leases.length,1,'the missing pointer never drops the registered promise');
    const publications=f.rows.filter(row=>row.operation==='capacity-snapshot-publish');
    assert.deepEqual(publications.map(row=>[row.preparation?.attempt,row.preparation?.retries]),changeRef?[[1,1],[2,1]]:[[1,0]]);
  }finally{writeFileSync(path,pointer);}
});

test('a pool registration with missing HEAD retries when initialization completes',t=>{
  const f=registrationPool(t);f.s.git(['switch','-q','-c','worker','main'],f.tree);
  const path=join(f.s.git(['rev-parse','--absolute-git-dir'],f.tree),'HEAD'),head=readFileSync(path,'utf8');rmSync(path);
  const run=f.capacity.transactions.run.bind(f.capacity.transactions);let completed=false;
  f.capacity.transactions.run=(operation,root,body,wait,options)=>{
    if(operation==='capacity-snapshot-publish'&&!completed){completed=true;writeFileSync(path,head);}
    return run(operation,root,body,wait,options);
  };
  assert.equal(f.capacity.snapshot(f.dir).leases.length,1);
  assert.deepEqual(f.rows.filter(row=>row.operation==='capacity-snapshot-publish').map(row=>[row.preparation?.attempt,row.preparation?.retries]),[[1,1],[2,1]]);
});

for(const broken of ['empty','missing','unparsable-ref'] as const)
test('a persistent '+broken+' HEAD permits every capacity route without retry',t=>{
  const f=registrationPool(t),other=join(f.dir,'2');f.s.git(['worktree','add','-q','-b','w2',other,'main']);
  const head=join(f.s.git(['rev-parse','--absolute-git-dir'],other),'HEAD');
  if(broken==='missing')rmSync(head);else writeFileSync(head,broken==='empty'?'':'ref: refs/heads/../w2\n');
  assert.doesNotMatch(f.s.git(['worktree','list','--porcelain']),/branch refs\/heads\/w2/,'Git observes no lease for the broken HEAD');
  const run=f.capacity.transactions.run.bind(f.capacity.transactions),counts=new Map<string,number>();
  f.capacity.transactions.run=(operation,root,body,wait,options)=>{
    const kind=operation.replace(/-(capture|publish)$/,'');
    if(kind!==operation){
      const count=(counts.get(kind)??0)+1;counts.set(kind,count);
      assert.ok(count<=4,kind+' repeated a stable broken HEAD instead of returning');
    }
    return run(operation,root,body,wait,options);
  };
  assert.equal(f.capacity.snapshot(f.dir).leases.length,0);
  const temporary=f.capacity.tryTemporary(f.dir,GiB).lease;assert.ok(temporary);temporary.release();
  const request={root:f.tree,target:join(f.tree,'target')},release=f.capacity.beginBuild(request);release();
  assert.equal(f.capacity.buildSnapshot(request).leases.length,1,'only the healthy explicit request is promised');
  assert.deepEqual([...counts],[['capacity-snapshot',2],['temporary-admission',2],['build-admission',2],['build-readiness',2]]);
  assert.equal(f.rows.some(row=>(row.preparation?.retries??0)>0),false);
});

for(const changed of ['unrelated','request'] as const)
test('index and input activity in the '+changed+' tree has only its intended admission scope',t=>{
  const f=registrationPool(t),other=join(f.dir,'2');f.s.git(['worktree','add','-q','-b','other-worker',other,'main']);
  let now=0;f.capacity.host.now=()=>now;f.capacity.host.allocatedBytes=()=>{now+=35_000;return 0;};
  const run=f.capacity.transactions.run.bind(f.capacity.transactions);let mutated=false;
  f.capacity.transactions.run=(operation,path,body,wait,options)=>{
    if(operation==='build-admission-publish'&&!mutated){
      mutated=true;const root=changed==='request'?f.tree:other;
      for(let n=0;n<8;n++){
        const name='staged-'+n+'.txt';writeFileSync(join(root,name),'ordinary edit\n');f.s.git(['add',name],root);
      }
      writeFileSync(join(root,'Cargo.toml'),'[workspace]\n# ordinary edit\n');
      writeFileSync(join(root,'rust-toolchain.toml'),'# ordinary edit\n');
      for(let n=0;n<64;n++)writeFileSync(join(root,'untracked-'+n),'ordinary edit\n');
    }
    return run(operation,path,body,wait,options);
  };
  const release=f.capacity.beginBuild({root:f.tree,target:join(f.tree,'target')});release();assert.equal(mutated,true);
  const publications=f.rows.filter(row=>row.operation==='build-admission-publish');
  assert.deepEqual(publications.map(row=>[row.preparation?.attempt,row.preparation?.retries]),changed==='request'?[[1,1],[2,1]]:[[1,0]]);
  assert.deepEqual(publications.map(row=>row.preparation?.observationMs),changed==='request'?[140_000,140_000]:[140_000]);
  assert.equal(Math.max(...f.rows.map(row=>row.lockHeldMs)),0,'eight outside-lock edits never add held work');
});

for(const change of ['head','ref','landed','presence'] as const)
test('a non-request lease receipt still invalidates a changed '+change,t=>{
  const f=registrationPool(t);f.s.git(['switch','-q','-c','worker','main'],f.tree);
  const receipt=new GitReceipt(f.tree,[],'lease');assert.equal(receipt.valid(),true);
  if(change==='head')f.s.git(['switch','-q','--detach','main'],f.tree);
  if(change==='ref')f.s.commit({'committed.txt':'new identity\n'},'advance worker',f.tree);
  if(change==='landed')f.s.git(['update-ref','refs/nts/landed/worker',f.s.git(['rev-parse','HEAD'],f.tree)]);
  if(change==='presence')writeWorkerPresence(f.tree,'worker','detached',0);
  assert.equal(receipt.valid(),false);
});

test('an absent claim publication validates until an old writer creates it',t=>{
  const root=testScratch(t,'disk-claim-absence'),file=join(root,'claims.json'),receipt=new ClaimReceipt([file]);
  try{assert.equal(receipt.valid(),true);durableRecord(file,{version:1,claims:[]});assert.equal(receipt.valid(),false);}
  finally{receipt.close();}
});

test('claim receipts pin publication identity across a legacy atomic ABA without a generation',t=>{
  const root=testScratch(t,'disk-claim-receipt'),file=join(root,'claims.json');
  const before={version:1,claims:[{id:'first',bytes:GiB}]};durableRecord(file,before);
  const receipt=new ClaimReceipt([file]);
  try{
    assert.equal(receipt.valid(),true);
    durableRecord(file,{version:1,claims:[{id:'second',bytes:2*GiB}]});durableRecord(file,before);
    assert.equal(receipt.valid(),false,'restored bytes cannot recycle the still-open publication inode');
  }finally{receipt.close();}
});

for(const kind of ['temporary','build'] as const)test('a legacy claim without a generation prevents '+kind+' double spend',t=>{
  const root=testScratch(t,'disk-legacy-claim'),env=ownMemory(join(root,'observations'),{disk:{freeBytes:42*GiB,freeInodes:100}});
  const capacity=new DiskCapacity({env,pool:null}),run=capacity.transactions.run.bind(capacity.transactions);
  let inserted=false,attempts=0;
  capacity.transactions.run=(operation,path,body,wait,options)=>{
    if(operation===(kind==='temporary'?'temporary-admission-publish':'build-admission-publish')){
      attempts++;
      if(!inserted){
        inserted=true;const generation=capacity.state.read().generation;
        withLock(capacity.transactions.path,()=>durableRecord(capacity.temporaryStateFile,{version:1,claims:[{
          id:'legacy',pid:process.pid,identity:processIdentity(process.pid),path:join(root,'legacy'),bytes:kind==='temporary'?2*GiB:GiB,
        }]}));
        assert.equal(capacity.state.read().generation,generation,'the old writer did not know the generation');
      }
    }
    return run(operation,path,body,wait,options);
  };
  if(kind==='temporary')assert.equal(capacity.tryTemporary(join(root,'next'),GiB).lease,null);
  else assert.throws(()=>capacity.beginBuild({root:join(root,'next'),target:join(root,'next','target'),outputs:['clippy']}),DiskBuildAdmissionError);
  assert.ok(attempts>=2,'the stale observation was prepared again before refusal');
  assert.equal(JSON.parse(readFileSync(capacity.temporaryStateFile,'utf8')).version,1,'main can still read the new publication');
});

for(const width of [1,4])test('capacity allocation scans never own the pool lock, width '+width,t=>{
  const root=testScratch(t,'disk-scan-outside'),env=ownMemory(join(root,'observations'),{disk:{freeBytes:100*GiB,freeInodes:100}});
  let now=0,scans=0;const rows:DiskTransaction[]=[];
  const original=hostObservations(env);
  const capacity=new DiskCapacity({env,pool:null,host:{...original,now:()=>now},observeTransaction:row=>rows.push(row)});
  // The capability's lock is beside its state, not beside the measured output.
  const actual=capacity.transactions.path;
  capacity.host.allocatedBytes=()=>{const control=acquire(actual);assert.ok(control);control.release();now+=35_000;scans++;return 0;};
  capacity.activeLeases=()=>Array.from({length:width},(_,index)=>({root:join(root,String(index)),target:join(root,String(index),'target')}));
  capacity.snapshot(root);
  assert.equal(scans,width*2);assert.equal(Math.max(...rows.map(row=>row.lockHeldMs)),0);
  assert.equal(now,width*70_000);
});

test('a reclamation intent blocks its target while independent admissions proceed',t=>{
  const root=testScratch(t,'disk-intent-admission'),env=ownMemory(join(root,'observations'),{disk:{freeBytes:100*GiB,freeInodes:100}});
  const capacity=new DiskCapacity({env,pool:null}),target=join(root,'old','target');
  const intent=capacity.state.begin(join(root,'old'),'reclaim');
  try{
    const generation=capacity.state.read().generation;
    assert.throws(()=>capacity.beginBuild({root:join(root,'old'),target}),DiskBuildAdmissionError);
    assert.equal(capacity.state.read().generation,generation,'denial publishes no claim and cannot invalidate the reclaimer');
    const independent=capacity.beginBuild({root:join(root,'new'),target:join(root,'new','target')});independent();
    assert.equal(capacity.tryTemporary(join(target,'capture'),GiB).lease,null);
  }finally{capacity.state.end(intent);}
  const build=capacity.beginBuild({root:join(root,'old'),target});build();
});

test('dead intent births expire and future transaction state is never overwritten',t=>{
  const root=testScratch(t,'disk-intent-birth'),env=ownMemory(join(root,'observations'),{disk:{freeBytes:100*GiB,freeInodes:100}});
  const capacity=new DiskCapacity({env,pool:null}),target=join(root,'target');
  const intent=capacity.state.begin(root,'reclaim'),row=capacity.state.read();
  writeFileSync(capacity.state.file,JSON.stringify({...row,intents:[{...intent,identity:intent.identity+'-departed'}]}));
  const build=capacity.beginBuild({root,target});build();
  const future=JSON.stringify({version:99,generation:row.generation,intents:[]});writeFileSync(capacity.state.file,future);
  assert.throws(()=>capacity.beginBuild({root,target}),/version/);
  assert.equal(readFileSync(capacity.state.file,'utf8'),future);
});

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

test('temporary admission sees the same outstanding build promises, and its wait names their holders',async t=>{
  const root=testScratch(t,'disk-admission'),target=join(root,'target');
  const env=ownMemory(join(root,'observations'),{disk:{freeBytes:47*GiB,freeInodes:100}});
  const capacity=new DiskCapacity({env,pool:null});
  capacity.activeLeases=()=>[{root,target}];
  const admission=new TemporaryAdmission({path:root,context:{kind:'standalone'},reservedBytes:GiB,host:capacity.host,capacity});
  const stop=new AbortController();let result:import('./admission.ts').TemporaryAdmissionSnapshot|undefined,line='';
  await assert.rejects(admission.acquire({what:'test capture',signal:stop.signal,report:(text,snapshot)=>{result=snapshot;line=text;
    assert.deepEqual(capacity.diskWaits().map(wait=>wait.holders),[[{kind:'build',path:root,bytes:7*GiB}]]);stop.abort();}}));
  assert.ok(result);
  assert.equal(result.buildPromisesBytes,7*GiB);
  assert.equal(result.requiredFreeBytes,48*GiB);
  assert.equal(result.admitted,false);
  assert.equal(line,`disk: test capture waits for 1.0 GiB of disk above the 40.0 GiB floor: 47.0 GiB free, 7.0 GiB promised to builds (${root} 7.0 GiB), 0.0 GiB to temporaries`);
  assert.deepEqual(capacity.diskWaits(),[]);
});

test('a wait record whose owner is gone expires, a live one stays, and an unobservable owner is a host fault',t=>{
  const root=testScratch(t,'disk-wait-owners'),env=ownMemory(join(root,'observations'),{disk:{freeBytes:41*GiB,freeInodes:100}}),capacity=new DiskCapacity({env,pool:null});
  const row=(id:string,pid:number,identity:string)=>({id,pid,identity,cgroup:'/fixture',path:join(root,id),bytes:GiB,what:id,since:new Date(0).toISOString(),freeBytes:41*GiB,floorBytes:40*GiB,holders:[]});
  const live=row('live',process.pid,processIdentity(process.pid)!),reused=row('reused',process.pid,processIdentity(process.pid)+'-wrong-birth');
  writeFileSync(capacity.waitStateFile,JSON.stringify({version:1,waits:[live,reused]}));
  assert.deepEqual(capacity.diskWaits().map(wait=>wait.id),['live']);
  writeFileSync(capacity.waitStateFile,JSON.stringify({version:1,waits:[{...live,holders:[{kind:'other',path:root,bytes:1}]}]}));
  assert.throws(()=>capacity.diskWaits(),/invalid temporary disk wait/);
  writeFileSync(capacity.waitStateFile,'{"version":2,"future":"keep"}\n');
  assert.throws(()=>capacity.diskWaits(),/version/);
});

test('only TemporaryAdmission.acquire waits on a temporary claim: no other production module asks tryTemporary',()=>{
  const tooling=new URL('..',import.meta.url).pathname,callers:string[]=[];
  const walk=(dir:string)=>{for(const entry of readdirSync(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='node_modules')walk(path);continue;}
    if(!/\.(ts|mjs|cjs|js)$/.test(entry.name)||/\.test\.|test-|fixture/.test(entry.name))continue;
    if(/\.tryTemporary\(/.test(readFileSync(path,'utf8')))callers.push(relative(tooling,path));
  }};
  walk(tooling);
  assert.deepEqual(callers,['gate/admission.ts']);
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
    assert.deepEqual(error.disk,{kind:'shortfall',root,target,outputs:['nts-dev'],shortBytes:GiB,freeBytes:45*GiB,floorBytes:40*GiB,buildReservedBytes:6*GiB,temporaryReservedBytes:0});
    return true;
  });
  assert.equal(existsSync(capacity.stateFile),false,'a refused attempt publishes no build claim');
  assert.equal(capacity.buildSnapshot({root,target,outputs:['nts-dev']}).availableBytes,-GiB);
  writeFileSync(capacity.stateFile,'{"version":2,"future":"keep"}\n');
  const before=readFileSync(capacity.stateFile,'utf8');
  assert.throws(()=>capacity.beginBuild({root,target,outputs:['clippy']}),/version/);
  assert.equal(readFileSync(capacity.stateFile,'utf8'),before);
});

test('a build handed its owner\'s admission is not admitted again, and a handed admission must be live',t=>{
  const root=testScratch(t,'handed-build-disk'),target=join(root,'target'),observations=join(root,'observations');
  const env=ownMemory(observations,{disk:{freeBytes:60*GiB,freeInodes:100}}),owner=new DiskCapacity({env});
  const admission=owner.beginBuild({root,target,outputs:['nts-dev']});
  assert.deepEqual(Object.keys(admission.env),[DISK_BUILD_ADMISSION]);
  const claims=()=>JSON.parse(readFileSync(owner.stateFile,'utf8')).claims as {id:string}[];
  assert.deepEqual(claims().map(claim=>claim.id),[admission.env[DISK_BUILD_ADMISSION]]);
  // The disk moves below the floor between the owner's admission and its build's command.
  ownMemory(observations,{disk:{freeBytes:39*GiB,freeInodes:100}});
  const handed={...env,...admission.env},build=new DiskCapacity({env:handed});
  const inner=build.beginBuild({root,target,outputs:['nts-dev']});
  assert.deepEqual(inner.env,admission.env,'the build runs inside, and hands on, its owner\'s admission');
  assert.equal(claims().length,1,'no second claim for the same build');
  inner();assert.equal(claims().length,1,'only the owner ends its admission');
  assert.throws(()=>build.beginBuild({root,target,outputs:['clippy']}),DiskBuildAdmissionError,'outputs the admission does not cover are admitted on their own');
  assert.throws(()=>build.beginBuild({root,target:join(root,'other'),outputs:['nts-dev']}),DiskBuildAdmissionError,'another target is another build');
  admission();assert.deepEqual(claims(),[]);
  assert.throws(()=>build.beginBuild({root,target,outputs:['nts-dev']}),(error:unknown)=>{
    assert.ok(error instanceof ToolingInstrumentError);assert.equal(error.kind,'tooling-setup');
    assert.match(error.message,/is not held by a live build owner/);return true;
  },'an ended admission is never replaced by a fresh one');
});

test('a build lock timeout is a named tooling instrument, while an unlocked build passes',t=>{
  const root=testScratch(t,'build-lock-timeout'),env=ownMemory(join(root,'observations'),{disk:{freeBytes:60*GiB,freeInodes:100}});
  const capacity=new DiskCapacity({env,pool:null,lockWaitMs:0});
  // Derive the exact lock namespace from the capacity owner.
  const actual=join(capacity.stateFile.slice(0,capacity.stateFile.lastIndexOf('/')),'.disk-lock');
  const lock=acquire(actual);assert.ok(lock);
  try{assert.throws(()=>capacity.beginBuild({root,target:join(root,'target')}),error=>{
    assert.ok(error instanceof ToolingInstrumentError);assert.equal(error.kind,'tooling-setup');
    for(const expected of [actual,String(process.pid),processIdentity(process.pid)!])assert.ok(error.message.includes(expected),error.message);
    return true;
  });}finally{lock.release();}
  const release=capacity.beginBuild({root,target:join(root,'target')});release();
  assert.equal(capacity.snapshot(root).buildReservedBytes,0);
});

for(const kind of ['build','temporary'])test('a completed '+kind+' keeps PASS when claim release meets a held lock',t=>{
  const root=testScratch(t,'release-lock-timeout'),env=ownMemory(join(root,'observations'),{disk:{freeBytes:60*GiB,freeInodes:100}});
  const capacity=new DiskCapacity({env,pool:null,lockWaitMs:0});
  const release=kind==='build'?capacity.beginBuild({root,target:join(root,'target')}):capacity.tryTemporary(root,GiB).lease!.release;
  const actual=join(capacity.stateFile.slice(0,capacity.stateFile.lastIndexOf('/')),'.disk-lock'),lock=acquire(actual);assert.ok(lock);
  const messages:string[]=[];t.mock.method(console,'error',(message:string)=>messages.push(message));
  try{assert.doesNotThrow(()=>release());assert.doesNotThrow(()=>release());}finally{lock.release();}
  assert.equal(messages.length,1);assert.match(messages[0]!,/release deferred until owner exit/);
  assert.ok(messages[0]!.includes(actual));assert.ok(messages[0]!.includes(processIdentity(process.pid)!));
  assert.ok(capacity.snapshot(root).reservedBytes>0,'deferred claim remains conservative until its process birth expires');
});

for(const mode of ['admission','release'])test('command receipt preserves '+mode+' lock contention outcome',t=>{
  const root=testScratch(t,'lock-command-receipt'),env=ownMemory(join(root,'observations'),{disk:{freeBytes:60*GiB,freeInodes:100}});
  const entry=join(root,'entry.mjs'),receipt=join(root,'receipt.json');
  writeFileSync(entry,generatedJavaScript(`
import {join,dirname} from 'node:path';
import {DiskCapacity} from ${JSON.stringify(new URL('./disk-capacity.ts',import.meta.url).href)};
import {acquire} from ${JSON.stringify(new URL('../landing/lock.ts',import.meta.url).href)};
import {runAsCommand} from ${JSON.stringify(new URL('../differential/command-entry/main.ts',import.meta.url).href)};
runAsCommand(import.meta.url,()=>{
 const capacity=new DiskCapacity({pool:null,lockWaitMs:0});
 const lease={root:${JSON.stringify(root)},target:${JSON.stringify(root)}+'/target'};
 const release=${mode==='release'?'capacity.beginBuild(lease)':'null'};
 const lock=acquire(join(dirname(capacity.stateFile),'.disk-lock'));
 if(!lock)throw Error('control did not hold lock');
 try{${mode==='release'?"release();console.log('completed step PASS');":"capacity.beginBuild(lease);"}}
 finally{lock.release();}
 return 0;
});`));
  const result=spawnTest(process.execPath,[entry],{env:{...fixtureEnvironment(t),...env,NTS_GATE_STEP:'clippy',NTS_GATE_STEP_ATTEMPT:'lock-control',NTS_GATE_STEP_RESULT:receipt},encoding:'utf8'});
  if(mode==='release'){
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/completed step PASS/);
    assert.match(result.stderr,/release deferred.*held by process/);assert.equal(existsSync(receipt),false);
  }else{
    assert.equal(result.status,1,result.stderr);const row=JSON.parse(readFileSync(receipt,'utf8'));
    assert.equal(row.verdict,'INSTRUMENT');assert.equal(row.kind,'tooling-setup');
    assert.match(row.reason,/held by process [0-9]+; birth identity/);assert.match(row.reason,/unit .*\.(?:service|scope)/);
  }
});
