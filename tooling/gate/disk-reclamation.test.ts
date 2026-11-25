import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {chmodSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {scratchRepo} from '../landing/scratch-repo.ts';
import {hostObservations} from './host-observations.ts';
import {ownMemory} from './test-memory.ts';
import {buildGeneration,completeBuild} from './build-completion.ts';
import {DiskCapacity} from './disk-capacity.ts';
import {DiskBuildAdmissionError} from '../differential/command-entry/instrument.ts';
import {reclaimDisk,profileMarker,ProfileMarkerError,targetProfiles,diskTrash,DISK_TRASH,assertNoUnitUsers,assertUnitTreeUnused,parseUnitTreeOwnership,type UnitTreeOwnership,type ReclaimOwnership,type ReclaimTarget} from './disk-reclamation.ts';
import {GateResource} from './gate-resource.ts';
import {acquire,processIdentity,withLock} from '../landing/lock.ts';
import {assertNoProcessUsers,observeTreeProcesses,processCgroup} from '../landing/tree-users.ts';
import {spawnTest,waitFor} from './test-wait.ts';
import {generatedJavaScript} from './generated-javascript.ts';
import {Pool} from '../landing/pool.ts';
import {cargoSync} from './cargo.ts';
import {workerPresence,workerPresenceFile,writeWorkerPresence} from '../landing/pool-presence.ts';
import {DISK_CAPACITY} from './disk-capacity.ts';
import {durableRecord} from './durable-record.ts';
import {DiskState,DiskTransactions,type DiskTransaction} from './disk-transaction.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {pathToFileURL} from 'node:url';
import {declaredTargets,readKeep} from '../full-check/keep.ts';
const GiB=2**30;
const cargoTag='Signature: 8a477f597d28d172789f06886806bc55\n';

test('pressure keeps one compatible free target; ordinary idle upkeep keeps two',t=>{
  for(const pressure of [true,false]){
    const f=fixture(t),trees=['1','2','3'].map(f.tree);trees.forEach(tree=>f.output(tree));
    if(!pressure)f.setFree(100*GiB);
    const report=reclaimDisk({...f.options,maintenance:{before:Infinity,keep:2}});
    assert.equal(trees.filter(tree=>existsSync(join(tree,'target'))).length,pressure?1:2,JSON.stringify(report));
    assert.equal(report.removed.filter(row=>row.kind==='free-build-output').length,pressure?2:1);
  }
});

test('every declared non-pool target offers obsolete debug, preserving its own current generation',t=>{
  const f=fixture(t),cache=join(f.s.dir,'cache');f.setFree(0);
  const keep=Object.fromEntries(Object.entries(readKeep()).filter(([,rule])=>rule.kind!=='pool'));
  const targets=declaredTargets(cache,keep);
  assert.ok(targets.some(row=>row.target===join(cache,'nts-gate/target')));
  assert.ok(targets.some(row=>row.target===join(cache,'nts-pins/target')));
  for(const {tree,target} of targets){
    mkdirSync(tree,{recursive:true});writeFileSync(join(tree,'Cargo.toml'),'[workspace]\n[profile.nts-dev]\ndebug=1\n');
    for(const profile of ['debug','nts-dev']){mkdirSync(join(target,profile),{recursive:true});writeFileSync(join(target,profile,'artifact'),'rebuildable');}
    completeBuild(tree,'nts-dev',join(target,'nts-dev'));
  }
  const report=reclaimDisk({...f.options,services:targets.map(row=>({...row,service:true}))});
  assert.deepEqual(report.removed.map(row=>row.root).sort(),targets.map(row=>join(row.target,'debug')).sort(),JSON.stringify(report));
  assert.ok(report.removed.every(row=>row.kind==='obsolete-profile'));
  for(const row of targets)assert.ok(existsSync(join(row.target,'nts-dev')),'current service generation differs from main');
});

for(const name of ['test-scratch','interop','tmp','accumulator-tests','interop-example'])test('free trees reclaim declared or legacy scratch: '+name,t=>{
  const f=fixture(t),tree=f.tree('1'),path=join(tree,'target',name);
  mkdirSync(path,{recursive:true});writeFileSync(join(path,'leftover'),'rebuildable scratch');
  mkdirSync(join(tree,'target/unowned-scratch'));writeFileSync(join(tree,'target/unowned-scratch/keep'),'unknown writer');
  const report=reclaimDisk(f.options);
  assert.deepEqual(report.removed.map(row=>[row.root,row.kind]),[[path,['test-scratch','interop'].includes(name)?'test-scratch':'legacy-scratch']],JSON.stringify(report));
  assert.equal(existsSync(path),false);assert.equal(readFileSync(join(tree,'target/unowned-scratch/keep'),'utf8'),'unknown writer');
  assert.equal(JSON.parse(readFileSync(join(f.dir,'.disk-reclaim.log'),'utf8')).kind,report.removed[0]!.kind);
});

for(const guard of ['branch','service','claim','unit','tracked','lock','replacement'])test('scratch retained at '+guard+' boundary',t=>{
  const f=fixture(t),tree=f.tree('1'),path=join(tree,'target/test-scratch');mkdirSync(path,{recursive:true});
  writeFileSync(join(path,'leftover'),'retained');
  if(guard==='branch')f.s.git(['switch','-q','-c','841-test'],tree);
  if(guard==='tracked')f.s.git(['add','-f','target/test-scratch/leftover'],tree);
  const lock=guard==='lock'?GateResource.tryAcquire(tree+'.lock'):null;
  try{
    const report=reclaimDisk({...f.options,
      ...(guard==='service'?{pool:{...f.options.pool,dir:join(f.s.dir,'unused')},services:[{tree,target:join(tree,'target'),service:true}]}:{}),
      protectedRoots:()=>guard==='claim'?[{root:tree,target:join(tree,'target')}]:[],
      ownership:()=>{
        if(guard==='unit')throw Error('unit scratch-reader.service owns root');
        if(guard==='replacement'){renameSync(path,join(f.s.dir,'saved'));mkdirSync(path);writeFileSync(join(path,'replacement'),'new owner');}
      }});
    assert.deepEqual(report.removed,[],JSON.stringify(report));assert.ok(existsSync(path));
  }finally{lock?.close();}
});

function fixture(t:TestContext){
  const s=scratchRepo(t,'disk-reclamation');
  s.commit({'.gitignore':'target/\nlocal/\n','Cargo.toml':'[workspace]\n[profile.nts-dev]\ndebug=0\n'},'build policy');
  // Reclamation order is a supplied fact, never the seconds fixture setup
  // happened to cross while the machine ran other checks.
  s.env.GIT_COMMITTER_DATE='@1000000000 +0000';
  const dir=join(s.dir,'pool');mkdirSync(dir);
  const env=ownMemory(join(s.dir,'observations'),{disk:{freeBytes:44*GiB,freeInodes:1000},wallClock:{kind:'fixed',now:1_800_000_000_000}});
  const original=hostObservations(env),outputs=new Map<string,number>();
  let initialFree=44*GiB;
  const allocated=(path:string)=>{
    if(existsSync(path))return true;
    const trash=join(dir,DISK_TRASH);
    if(!existsSync(trash))return false;
    return readdirSync(trash).some(name=>{
      const file=join(trash,name,'manifest.json');if(!existsSync(file))return false;
      const row=JSON.parse(readFileSync(file,'utf8')) as {removal:{root:string}};
      return (path===row.removal.root||path.startsWith(row.removal.root+'/'))&&existsSync(join(trash,name,'payload',path.slice(row.removal.root.length)));
    });
  };
  const free=()=>initialFree+[...outputs].filter(([path])=>!allocated(path)).reduce((sum,[,bytes])=>sum+bytes,0);
  const host={...original,disk:(path:string)=>({...original.disk(path),freeBytes:free()}),allocatedBytes:(path:string)=>[...outputs].filter(([root])=>existsSync(root)&&(root===path||root.startsWith(path+'/'))).reduce((sum,[,bytes])=>sum+bytes,0)};
  const tree=(name:string)=>{const path=join(dir,name);s.git(['worktree','add','-q','--detach',path,'main']);return path;};
  const output=(tree:string,name='nts-dev',bytes=4*GiB)=>{
    const target=join(tree,'target'),path=join(target,name);mkdirSync(path,{recursive:true});
    writeFileSync(join(target,'CACHEDIR.TAG'),cargoTag);writeFileSync(join(path,'built'),'immutable artifact');outputs.set(path,bytes);
    if(name==='nts-dev'||name==='clippy')completeBuild(tree,name,path);
    return path;
  };
  const options={pool:{dir,git:{root:s.root,env:s.env}},host,coldBytes:7*GiB,
    snapshot:()=>({freeBytes:free(),floorBytes:40*GiB,reservedBytes:0}),protectedRoots:()=>[],services:[] as ReclaimTarget[],ownership:((_tree,_target)=>{}) as ReclaimOwnership};
  return {s,dir,env,host,tree,output,options,outputs,setFree:(bytes:number)=>{initialFree=bytes;}};
}

test('a second process completes admission before the reclaimer leaves its ownership barrier',t=>{
  const f=fixture(t),tree=f.tree('1');f.output(tree,'debug',16*GiB);
  let now=0,entered=0;const rows:DiskTransaction[]=[],events:string[]=[];
  const host={...f.host,now:()=>now};
  const state=new DiskState(new DiskTransactions(join(f.dir,'.lock'),host,row=>rows.push(row)));
  durableRecord(f.env[DISK_CAPACITY]!,{version:1,pool:{dir:f.dir,root:f.s.root}});
  const target=join(f.s.dir,'independent','target');
  const source=generatedJavaScript(`
import {DiskCapacity} from ${JSON.stringify(new URL('./disk-capacity.ts',import.meta.url).href)};
const capacity=new DiskCapacity();
const release=capacity.beginBuild({root:${JSON.stringify(join(f.s.dir,'independent'))},target:${JSON.stringify(target)},outputs:['clippy']});
process.stdout.write('admission-published');release();`);
  const report=reclaimDisk({...f.options,host,state,ownership:()=>{
    now+=45_000;
    if(entered++)return;
    events.push('ownership-entered');
    // The parent cannot finish this barrier until the child has published and
    // released its independent claim. No scheduler deadline decides the test.
    const child=spawnTest(process.execPath,['--input-type=module','-e',source],{env:{...f.s.env,...f.env},encoding:'utf8'});
    assert.equal(child.status,0,child.stderr);assert.equal(child.stdout,'admission-published');
    events.push('admission-published','ownership-released');
  }});
  assert.deepEqual(events,['ownership-entered','admission-published','ownership-released']);
  assert.equal(report.removed.length,1,JSON.stringify(report));
  assert.equal(report.maxLockHeldMs,0);assert.ok(rows.length>0);assert.equal(Math.max(...rows.map(row=>row.lockHeldMs)),0);
});

test('allocation and ownership scans use only the tree fence, and a replaced target is retained',t=>{
  const f=fixture(t),tree=f.tree('1'),profile=f.output(tree,'debug',16*GiB),saved=join(f.s.dir,'original-output');
  let scans=0;
  const available=()=>{const lock=acquire(join(f.dir,'.lock'));assert.ok(lock,'slow work does not own the pool lock');lock.release();};
  const report=reclaimDisk({...f.options,host:{...f.host,allocatedBytes:path=>{available();scans++;return f.host.allocatedBytes(path);}},ownership:()=>{
    available();renameSync(profile,saved);mkdirSync(profile);writeFileSync(join(profile,'user-data'),'retained');
  }});
  assert.ok(scans>0);assert.deepEqual(report.removed,[]);
  assert.equal(readFileSync(join(profile,'user-data'),'utf8'),'retained');
  assert.ok(existsSync(saved));assert.match(report.kept.map(row=>row.reason).join('\n'),/identity changed/);
});

test('an old-style build claim between preparation and commit retains the target without advancing generation',t=>{
  const f=fixture(t),tree=f.tree('1'),profile=f.output(tree,'debug',16*GiB);
  const capacity=new DiskCapacity({env:f.env,host:f.host,pool:f.options.pool,reclamation:{services:[],ownership:()=>{}}});
  const run=capacity.transactions.run.bind(capacity.transactions);let inserted=false,publications=0;
  capacity.transactions.run=(operation,path,body,wait,options)=>{
    if(operation==='reclaim-detach-publish'){
      publications++;
      if(!inserted){
        inserted=true;const generation=capacity.state.read().generation;
        withLock(join(f.dir,'.lock'),()=>durableRecord(capacity.stateFile,{version:1,claims:[{
          id:'old-build',pid:process.pid,identity:processIdentity(process.pid),root:tree,target:profile,outputs:['clippy'],
        }]}));
        assert.equal(capacity.state.read().generation,generation);
      }
    }
    return run(operation,path,body,wait,options);
  };
  const report=capacity.reclaim(f.dir)!;
  assert.equal(inserted,true);assert.ok(publications>0);assert.deepEqual(report.removed,[]);
  assert.equal(readFileSync(join(profile,'built'),'utf8'),'immutable artifact');
  assert.match(report.kept.map(row=>row.reason).join('\n'),/live lease or build claim/);
});

test('a legacy Git move after preparation cancels before the atomic detach',t=>{
  const f=fixture(t),tree=f.tree('1'),profile=f.output(tree,'debug',16*GiB),moved=join(f.s.dir,'moved');
  const state=new DiskState(new DiskTransactions(join(f.dir,'.lock'),f.host)),run=state.transactions.run.bind(state.transactions);
  let changed=false;
  state.transactions.run=(operation,path,body,wait,options)=>{
    if(operation==='reclaim-detach-publish'&&!changed){
      changed=true;const generation=state.read().generation;
      withLock(join(f.dir,'.lock'),()=>f.s.git(['worktree','move','--',tree,moved]));
      f.outputs.delete(profile);f.outputs.set(join(moved,'target/debug'),16*GiB);
      assert.equal(state.read().generation,generation);
    }
    return run(operation,path,body,wait,options);
  };
  const report=reclaimDisk({...f.options,state});
  assert.equal(changed,true);assert.deepEqual(report.removed,[]);
  assert.equal(readFileSync(join(moved,'target/debug/built'),'utf8'),'immutable artifact');
});

test('a build admitted after the detach gets a fresh target outside the drainer grant',t=>{
  const f=fixture(t),tree=f.tree('1'),profile=f.output(tree,'debug',16*GiB);
  const capacity=new DiskCapacity({env:f.env,host:f.host,pool:f.options.pool,reclamation:{services:[],ownership:()=>{}}});
  let release:(()=>void)|undefined;
  const report=reclaimDisk({...f.options,removePayload:(payload,_kind,remove)=>{
    const lock=acquire(join(f.dir,'.lock'));assert.ok(lock);lock.release();
    assert.equal(existsSync(profile),false,'detach committed before the new admission');
    f.outputs.delete(profile);f.outputs.set(payload,16*GiB);
    release=capacity.beginBuild({root:tree,target:profile,outputs:['clippy']});
    mkdirSync(join(profile,'clippy'),{recursive:true});writeFileSync(join(profile,'clippy','new-build'),'new owner');
    assert.equal(readFileSync(join(payload,'built'),'utf8'),'immutable artifact');remove();
  }});
  try{
    assert.deepEqual(report.removed.map(row=>row.root),[profile]);
    assert.equal(readFileSync(join(profile,'clippy','new-build'),'utf8'),'new owner');
  }finally{release?.();}
});

test('a crash between rename and the detach record repairs bounded checkout links and drains only its payload',t=>{
  const f=fixture(t),tree=f.tree('1'),stage=join(f.s.dir,'crash-stage');
  copyModuleClosure(['tooling/gate/disk-reclamation.ts'],stage);
  const file=join(stage,'tooling/gate/disk-reclamation.ts'),source=readFileSync(file,'utf8');
  assert.equal(source.split('renameSync(root,payload);').length,2,'one atomic detach commit point');
  writeFileSync(file,source.replace('renameSync(root,payload);','renameSync(root,payload);process.exit(79);'));
  const script=generatedJavaScript(`
import {reclaimDisk} from ${JSON.stringify(pathToFileURL(join(stage,'tooling/gate/disk-reclamation.ts')).href)};
import {hostObservations} from ${JSON.stringify(new URL('./host-observations.ts',import.meta.url).href)};
const host=hostObservations();
reclaimDisk({pool:${JSON.stringify(f.options.pool)},host,coldBytes:7*2**30,snapshot:()=>({freeBytes:44*2**30,floorBytes:40*2**30,reservedBytes:0}),protectedRoots:()=>[],services:[],ownership:()=>{}});`);
  const child=spawnTest(process.execPath,['--input-type=module','-e',script],{env:{...f.s.env,...f.env},encoding:'utf8'});
  assert.equal(child.status,79,child.stderr);assert.equal(existsSync(tree),false);
  const [entry]=diskTrash(f.dir,f.host.wallNow());assert.ok(entry);assert.ok(existsSync(join(entry.path,'payload','Cargo.toml')));
  const report=reclaimDisk(f.options);
  assert.deepEqual(report.removed.map(row=>[row.root,row.kind]),[[tree,'unbuilt-checkout']],JSON.stringify(report));
  assert.deepEqual(diskTrash(f.dir,f.host.wallNow()),[]);
  assert.equal(f.s.git(['worktree','list','--porcelain']).includes(entry.path),false,'Git retired the repaired payload registration');
});

test('ignored author data appearing during ownership inspection keeps an unbuilt checkout',t=>{
  const f=fixture(t),tree=f.tree('1');
  const report=reclaimDisk({...f.options,ownership:()=>{
    mkdirSync(join(tree,'local'));writeFileSync(join(tree,'local','notes'),'author data');
  }});
  assert.deepEqual(report.removed,[]);assert.equal(readFileSync(join(tree,'local','notes'),'utf8'),'author data');
  assert.match(report.kept.map(row=>row.reason).join('\n'),/ignored local data/);
});

test('a service profile completed during ownership inspection is retained',t=>{
  const f=fixture(t),tree=join(f.s.dir,'service');mkdirSync(tree);
  writeFileSync(join(tree,'Cargo.toml'),'[workspace]\n[profile.nts-dev]\ndebug=0\n');
  const profile=f.output(tree,'clippy',16*GiB);
  writeFileSync(join(profile,'.nts-complete.json'),JSON.stringify({version:1,generation:'0'.repeat(64)}));
  const report=reclaimDisk({...f.options,services:[{tree,target:join(tree,'target'),service:true}],ownership:()=>completeBuild(tree,'clippy',profile)});
  assert.deepEqual(report.removed,[]);assert.ok(existsSync(profile));
  assert.match(report.kept.map(row=>row.reason).join('\n'),/no longer obsolete/);
});

test('a service intent fences output beside the checkout, including a builder of its parent target',t=>{
  const f=fixture(t),tree=join(f.s.dir,'service'),target=join(f.s.dir,'external-target');mkdirSync(tree);
  writeFileSync(join(tree,'Cargo.toml'),'[workspace]\n');
  const old=f.output(tree,'debug',16*GiB),profile=join(target,'debug');
  renameSync(join(tree,'target'),target);f.outputs.delete(old);f.outputs.set(profile,16*GiB);
  const capacity=new DiskCapacity({env:f.s.env,host:f.host,pool:f.options.pool,reclamation:{services:[],ownership:()=>{}}});
  let fenced=false,inspections=0;
  const report=reclaimDisk({...f.options,services:[{tree,target,service:true}],ownership:()=>{
    assert.equal(++inspections,1,'a refused admission only observes the trash and cannot invalidate its owner');
    assert.throws(()=>capacity.beginBuild({root:tree,target,outputs:['clippy']}),error=>{
      assert.ok(error instanceof DiskBuildAdmissionError);assert.equal(error.disk.kind,'target-fenced');
      assert.equal(error.disk.intent!.root,profile);fenced=true;return true;
    });
  }});
  assert.equal(fenced,true);assert.deepEqual(report.removed.map(row=>row.root),[profile],JSON.stringify(report));
});

test('every Git preflight question runs outside the shared lock, with supplied slow-work time',t=>{
  const f=fixture(t),tree=f.tree('1');f.output(tree,'debug',16*GiB);
  const bin=join(f.s.dir,'git-tools'),clock=join(f.s.dir,'clock.json'),trace=join(f.s.dir,'git-questions.jsonl');mkdirSync(bin);
  durableRecord(clock,0);
  const resolved=spawnTest('sh',['-c','command -v git'],{env:f.s.env,encoding:'utf8'});assert.equal(resolved.status,0,resolved.stderr);
  const shim=generatedJavaScript(`#!${process.execPath}
import {acquire} from ${JSON.stringify(new URL('../landing/lock.ts',import.meta.url).href)};
import {gitArguments} from ${JSON.stringify(new URL('./git-arguments/main.ts',import.meta.url).href)};
import {durableRecord} from ${JSON.stringify(new URL('./durable-record.ts',import.meta.url).href)};
import {readFileSync,appendFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';
const lock=acquire(${JSON.stringify(join(f.dir,'.lock'))});
if(!lock){process.stderr.write('Git question owns the shared pool lock');process.exit(91);}lock.release();
durableRecord(${JSON.stringify(clock)},Number(readFileSync(${JSON.stringify(clock)},'utf8'))+35000);
appendFileSync(${JSON.stringify(trace)},JSON.stringify(process.argv.slice(2))+'\\n');
const result=spawnSync(${JSON.stringify(resolved.stdout.trim())},gitArguments(process.argv.slice(2)),{stdio:'inherit'});
process.exitCode=result.status??1;`);
  writeFileSync(join(bin,'git'),shim,{mode:0o755});f.s.env.PATH=bin+':'+f.s.env.PATH;
  const report=reclaimDisk({...f.options,host:{...f.host,now:()=>Number(readFileSync(clock,'utf8'))}});
  assert.equal(report.removed.length,1,JSON.stringify(report));
  const questions=readFileSync(trace,'utf8').trim().split('\n');assert.ok(questions.length>5);
  assert.equal(report.maxLockHeldMs,0);assert.equal(Number(readFileSync(clock,'utf8')),questions.length*35_000);
});

test('reclamation reports each nonzero transaction once and its maximum',t=>{
  const f=fixture(t),tree=f.tree('1');f.output(tree,'debug',16*GiB);let now=0;
  const report=reclaimDisk({...f.options,host:{...f.host,now:()=>++now}});
  const rows=readFileSync(join(f.dir,'.lock.transactions.'+process.pid+'.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line) as DiskTransaction);
  assert.ok(rows.length>1);assert.ok(rows.every(row=>row.lockHeldMs>0));
  assert.equal(report.lockHeldMs,rows.reduce((sum,row)=>sum+row.lockHeldMs,0));
  assert.equal(report.maxLockHeldMs,Math.max(...rows.map(row=>row.lockHeldMs)));
});

test('pressure reclaims in cost order to a measured hysteresis goal, then stops',t=>{
  const f=fixture(t),a=f.tree('1'),b=f.tree('2'),c=f.tree('3'),unbuilt=f.tree('4');
  f.output(a);f.output(b);f.output(c);f.output(a,'debug',10*GiB);
  // Keep this target less recently used without a wall-clock decision.
  const report=reclaimDisk(f.options);
  assert.equal(report.triggerBytes,47*GiB,JSON.stringify(report?.kept));assert.equal(report.goalBytes,54*GiB,JSON.stringify(report?.kept));
  assert.deepEqual(report.removed.map(row=>row.kind),['obsolete-profile'],JSON.stringify(report?.kept));
  assert.equal(report.after,54*GiB,JSON.stringify(report?.kept));assert.ok(existsSync(unbuilt),JSON.stringify(report?.kept));
  const log=JSON.parse(readFileSync(join(f.dir,'.disk-reclaim.log'),'utf8')) as {root:string;allocatedBytes:number;freeBytesChange:number;facts:string[]};
  assert.equal(log.root,join(a,'target/debug'),JSON.stringify(report?.kept));assert.equal(log.allocatedBytes,10*GiB,JSON.stringify(report?.kept));assert.equal(log.freeBytesChange,10*GiB,JSON.stringify(report?.kept));
  assert.ok(log.facts.includes('resource lock held'),JSON.stringify(report?.kept));
  const repeated=reclaimDisk(f.options);
  assert.deepEqual(repeated.removed,[],'headroom prevents repeated eviction; kept='+JSON.stringify(repeated.kept));
});

test('pressure reclaims an explicitly detached task target and preserves every form of task work',t=>{
  const f=fixture(t),tree=f.tree('1');
  f.s.git(['switch','-q','-c','884'],tree);
  const head=f.s.commit({'private.txt':'committed task work'},'task commit',tree);
  writeFileSync(join(tree,'private.txt'),'uncommitted edit');writeFileSync(join(tree,'untracked.txt'),'untracked work');
  f.output(tree,'nts-dev',16*GiB);
  writeWorkerPresence(tree,'884','detached',10);
  const before=f.s.git(['status','--porcelain','--untracked-files=all'],tree);
  const capacity=new DiskCapacity({env:f.s.env,host:f.host,pool:f.options.pool,reclamation:{services:[],ownership:f.options.ownership}});
  assert.deepEqual(capacity.activeLeases(),[],'detached tasks promise no cold build');
  const report=capacity.reclaim(f.dir)!;
  assert.deepEqual(report.removed.map(row=>[row.kind,row.tree,row.task,row.allocatedBytes]),[['detached-build-output',tree,'884',16*GiB]],JSON.stringify(report));
  assert.equal(existsSync(join(tree,'target')),false);
  assert.equal(f.s.git(['branch','--show-current'],tree),'884');assert.equal(f.s.git(['rev-parse','HEAD'],tree),head);
  assert.equal(f.s.git(['status','--porcelain','--untracked-files=all'],tree),before);
  assert.equal(readFileSync(join(tree,'private.txt'),'utf8'),'uncommitted edit');
  assert.equal(readFileSync(join(tree,'untracked.txt'),'utf8'),'untracked work');
  const logged=JSON.parse(readFileSync(join(f.dir,'.disk-reclaim.log'),'utf8'));
  assert.equal(logged.tree,tree);assert.equal(logged.task,'884');assert.equal(logged.allocatedBytes,16*GiB);
});

for(const cacheTag of [true,false])test('detached held profiles are reclaimed beside preserved and reported stray siblings; cache tag '+cacheTag,t=>{
  const f=fixture(t),tree=f.tree('1');f.s.git(['switch','-q','-c','938'],tree);
  const profiles=[f.output(tree,'nts-dev',8*GiB),f.output(tree,'clippy',4*GiB)];
  if(!cacheTag)rmSync(join(tree,'target/CACHEDIR.TAG'));
  const stray=join(tree,'target/696-base-matching'),scratch=join(tree,'target/accumulator-tests');
  writeFileSync(stray,'private experiment');mkdirSync(scratch);
  writeWorkerPresence(tree,'938','detached',10);
  const report=reclaimDisk(f.options);
  assert.deepEqual(report.removed.map(row=>row.root).sort(),profiles.sort(),JSON.stringify(report));
  assert.equal(report.removed.reduce((sum,row)=>sum+row.allocatedBytes,0),12*GiB);
  assert.ok(report.removed.every(row=>row.kind==='detached-build-output'&&row.tree===tree&&row.task==='938'));
  assert.equal(readFileSync(stray,'utf8'),'private experiment');assert.ok(lstatSync(scratch).isDirectory());
  for(const [root,writer] of [[stray,'historical issue #696'],[scratch,'compiler test scratch']]){
    assert.ok(report.kept.some(row=>row.root===root&&row.reason.includes(writer!)),JSON.stringify(report));
  }
  const log=readFileSync(join(f.dir,'.disk-reclaim.log'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(log.map(row=>row.root).sort(),profiles);
});

test('a reclaimed held profile rebuilds after task resume while its stray sibling survives',t=>{
  const f=fixture(t),tree=f.tree('1');f.s.git(['switch','-q','-c','938'],tree);
  f.s.commit({'Cargo.toml':'[package]\nname="resume-fixture"\nversion="0.0.0"\nedition="2021"\n[profile.nts-dev]\ninherits="dev"\ndebug=0\n',
    'src/main.rs':'fn main() { println!("task 938"); }\n'},'task source',tree);
  const p=new Pool(f.dir,f.options.pool.git,()=>{},{host:f.host,users:()=>[],reclamation:{services:[],ownership:f.options.ownership}});
  const profile=join(tree,'target/nts-dev'),binary=join(profile,'resume-fixture');
  const build=()=>{
    const release=p.capacity.beginBuild({root:tree,target:join(tree,'target'),outputs:['nts-dev']});
    try{const result=cargoSync(['build','--offline','--profile','nts-dev'],{cwd:tree,env:f.s.env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
    finally{release();}
  };
  f.setFree(100*GiB);build();f.outputs.set(profile,16*GiB);
  const stray=join(tree,'target/experiment');writeFileSync(stray,'retained');
  p.detach('938');f.setFree(44*GiB);
  const report=p.capacity.reclaim(f.dir)!;
  assert.deepEqual(report.removed.map(row=>[row.root,row.kind]),[[profile,'detached-build-output']],JSON.stringify(report));
  assert.equal(existsSync(binary),false);assert.equal(readFileSync(stray,'utf8'),'retained');
  f.setFree(100*GiB);p.attach('938');assert.equal(workerPresence(tree,'938').state,'attached');build();
  const ran=spawnTest(binary,[],{cwd:tree,env:f.s.env,encoding:'utf8'});
  assert.equal(ran.status,0,ran.stderr);assert.equal(ran.stdout.trim(),'task 938');
  assert.equal(readFileSync(stray,'utf8'),'retained');
});

test('free targets precede detached targets, keeping one warm, then oldest detached first',t=>{
  const f=fixture(t),free=['1','2','3'].map(f.tree),newer=f.tree('4'),older=f.tree('5');
  free.forEach(tree=>f.output(tree));
  for(const [tree,branch,at] of [[newer,'884',20],[older,'885',10]] as const){
    f.s.git(['switch','-q','-c',branch],tree);f.output(tree);writeWorkerPresence(tree,branch,'detached',at);
  }
  const report=reclaimDisk(f.options),kinds=report.removed.map(row=>row.kind);
  assert.deepEqual(kinds,['free-build-output','free-build-output','detached-build-output'],JSON.stringify(report));
  assert.deepEqual(report.removed.slice(2).map(row=>row.tree),[older]);
  assert.equal(free.filter(tree=>existsSync(join(tree,'target'))).length,1);
});

test('attached, absent, corrupt, future and mismatched presence records retain task targets by name',t=>{
  for(const state of ['attached','missing','corrupt','future','wrong-branch','wrong-tree']){
    const f=fixture(t),tree=f.tree('1');f.s.git(['switch','-q','-c','884'],tree);f.output(tree,'debug',16*GiB);writeFileSync(join(tree,'target/stray'),'retained');
    if(state!=='missing')writeWorkerPresence(tree,'884',state==='attached'?'attached':'detached',10);
    const file=workerPresenceFile(tree);
    if(state==='corrupt')writeFileSync(file,'{broken');
    if(state==='future')writeFileSync(file,JSON.stringify({version:99}));
    if(state==='wrong-branch')writeWorkerPresence(tree,'885','detached',10);
    if(state==='wrong-tree'){const row=JSON.parse(readFileSync(file,'utf8'));writeFileSync(file,JSON.stringify({...row,ino:row.ino+1}));}
    const report=reclaimDisk(f.options);
    assert.deepEqual(report.removed,[],JSON.stringify(report));assert.ok(existsSync(join(tree,'target/debug')));assert.equal(readFileSync(join(tree,'target/stray'),'utf8'),'retained');
    assert.ok(report.kept.some(row=>row.reason.includes(state==='attached'||state==='missing'?'attached worker':file)),JSON.stringify(report));
    const capacity=new DiskCapacity({env:f.s.env,host:f.host,pool:f.options.pool,reclamation:{services:[],ownership:f.options.ownership}});
    assert.equal(capacity.activeLeases().length,1,state+' protects its build promise');
  }
});

test('ordinary upkeep never evicts detached targets without pressure',t=>{
  const f=fixture(t),tree=f.tree('1');f.s.git(['switch','-q','-c','884'],tree);f.output(tree,'debug');
  writeWorkerPresence(tree,'884','detached',1);f.setFree(80*GiB);
  const report=reclaimDisk({...f.options,maintenance:{before:100,keep:2}});
  assert.deepEqual(report.removed,[]);assert.ok(existsSync(join(tree,'target/debug')));
});

test('a detached tree with a real cwd or target fd owner is retained',async t=>{
  for(const where of ['cwd','fd']){
    const f=fixture(t),tree=f.tree('1');f.s.git(['switch','-q','-c','884'],tree);const output=f.output(tree,'nts-dev',16*GiB);writeFileSync(join(tree,'target/stray'),'retained');
    writeWorkerPresence(tree,'884','detached',10);
    if(where==='cwd'){
      const child=spawn('cat',[],{cwd:tree,env:f.s.env,stdio:['pipe','ignore','pipe']});
      const exited=once(child,'exit');
      try{
        await once(child,'spawn');
        const report=reclaimDisk({...f.options,ownership:(root,target)=>assertNoProcessUsers([root,target],{pids:[child.pid!]})});
        assert.deepEqual(report.removed,[]);assert.match(report.kept.map(row=>row.reason).join('\n'),/owns cwd/);
      }finally{child.stdin.end();await exited;}
    }
    if(where==='fd'){
      const source=generatedJavaScript(`import{openSync,closeSync}from'node:fs';const fd=openSync(process.argv[1],'r');process.stdout.write('ready');process.stdin.resume();process.stdin.on('end',()=>closeSync(fd));`);
      const reader=spawn(process.execPath,['--input-type=module','-e',source,join(output,'built')],{cwd:f.s.dir,env:f.s.env,stdio:['pipe','pipe','pipe']});
      const closed=once(reader,'exit');let out='';reader.stdout.on('data',part=>{out+=String(part);});
      try{
        await waitFor('held target descriptor',()=>out.includes('ready'),{stopped:()=>reader.exitCode===null?undefined:'reader exited '+reader.exitCode});
        const report=reclaimDisk({...f.options,ownership:(root,target)=>assertNoProcessUsers([root,target],{pids:[reader.pid!]})});
        assert.deepEqual(report.removed,[]);assert.match(report.kept.map(row=>row.reason).join('\n'),/owns fd\//);
      }finally{reader.stdin.end();await closed;}
    }
    assert.ok(existsSync(output));assert.equal(readFileSync(join(tree,'target/stray'),'utf8'),'retained');
  }
});

test('detached targets recheck attachment and build claims after measuring',t=>{
  for(const guard of ['presence','claim','unit']){
    const f=fixture(t),tree=f.tree('1');f.s.git(['switch','-q','-c','884'],tree);f.output(tree,'nts-dev',16*GiB);writeFileSync(join(tree,'target/stray'),'retained');
    writeWorkerPresence(tree,'884','detached',10);let claimed=false;
    const report=reclaimDisk({...f.options,protectedRoots:()=>claimed?[{root:tree,target:join(tree,'target')}]:[],ownership:()=>{
      if(guard==='presence')writeWorkerPresence(tree,'884','attached',20);
      if(guard==='claim')claimed=true;
      if(guard==='unit')assertUnitTreeUnused([tree],{unit:'queued-build.service',workingDirectory:tree,rootDirectory:'',commands:[]});
    }});
    assert.deepEqual(report.removed,[],JSON.stringify(report));assert.ok(existsSync(join(tree,'target')));
    assert.match(report.kept.map(row=>row.reason).join('\n'),guard==='presence'?/attached worker/:guard==='claim'?/live lease or build claim/:/queued-build.service owns WorkingDirectory/);
  }
});

test('free build output keeps the checkout and one warm target; unbuilt removal uses Git',t=>{
  const f=fixture(t),trees=['1','2','3'].map(f.tree),unbuilt=f.tree('4');
  for(const tree of trees)f.output(tree);
  const report=reclaimDisk(f.options);
  assert.equal(report.removed.filter(row=>row.kind==='unbuilt-checkout').length,1,JSON.stringify(report?.kept));
  assert.equal(existsSync(unbuilt),false,JSON.stringify(report?.kept));
  assert.ok(!f.s.git(['worktree','list','--porcelain']).includes(unbuilt),JSON.stringify(report?.kept));
  assert.equal(report.removed.filter(row=>row.kind==='free-build-output').length,2,JSON.stringify(report?.kept));
  assert.ok(trees.every(path=>existsSync(path)),( 'built checkouts remain registered')+'; kept='+JSON.stringify(report?.kept));
  assert.equal(trees.filter(path=>existsSync(join(path,'target'))).length,1,JSON.stringify(report?.kept));
});

test('unbuilt checkout removal ends stale presence but keeps a future record and its tree',t=>{
  const f=fixture(t),old=f.tree('1'),future=f.tree('2');
  writeWorkerPresence(old,'ended-task','attached',10);
  const body=JSON.stringify({version:99});writeFileSync(workerPresenceFile(future),body);
  const report=reclaimDisk(f.options);
  assert.ok(report.removed.some(row=>row.kind==='unbuilt-checkout'&&row.root===old),JSON.stringify(report));
  assert.equal(existsSync(workerPresenceFile(old)),false);
  assert.ok(existsSync(future));assert.equal(readFileSync(workerPresenceFile(future),'utf8'),body);
  assert.ok(report.kept.some(row=>row.reason.includes(workerPresenceFile(future))&&row.reason.includes('future state version')),JSON.stringify(report));
});

test('a future presence appearing at the final ownership observation keeps the checkout',t=>{
  const f=fixture(t),tree=f.tree('1'),body=JSON.stringify({version:99});
  const report=reclaimDisk({...f.options,ownership:()=>writeFileSync(workerPresenceFile(tree),body)});
  assert.deepEqual(report.removed,[]);assert.ok(existsSync(tree));
  assert.equal(readFileSync(workerPresenceFile(tree),'utf8'),body);
  assert.ok(report.kept.some(row=>row.reason.includes('future state version')),JSON.stringify(report));
});

test('service targets offer obsolete whole profiles, never their current output',t=>{
  const f=fixture(t),tree=join(f.s.dir,'service');mkdirSync(tree);
  writeFileSync(join(tree,'Cargo.toml'),'[workspace]\n[profile.nts-dev]\ndebug=0\n');
  const current=f.output(tree),debug=f.output(tree,'debug',4*GiB),old=f.output(tree,'clippy',4*GiB);
  const marker=join(old,'.nts-complete.json');
  writeFileSync(marker,JSON.stringify({version:1,generation:'0'.repeat(64)}));
  f.options.services=[{tree,target:join(tree,'target'),service:true}];
  const report=reclaimDisk(f.options);
  assert.deepEqual(new Set(report.removed.map(row=>row.root)),new Set([debug,old]),JSON.stringify(report?.kept));
  assert.ok(existsSync(current),JSON.stringify(report?.kept));assert.ok(existsSync(tree),JSON.stringify(report?.kept));
  assert.equal(report.removed.some(row=>row.kind!=='obsolete-profile'),false,JSON.stringify(report?.kept));
});

test('both current service profiles survive legacy debug removal',t=>{
  const f=fixture(t),tree=join(f.s.dir,'service');mkdirSync(tree);
  writeFileSync(join(tree,'Cargo.toml'),'[workspace]\n[profile.nts-dev]\ndebug=0\n');
  const tests=f.output(tree),clippy=f.output(tree,'clippy'),debug=f.output(tree,'debug',16*GiB);
  const report=reclaimDisk({...f.options,services:[{tree,target:join(tree,'target'),service:true}]});
  assert.deepEqual(report.removed.map(row=>row.root),[debug],JSON.stringify(report?.kept));
  for(const path of [tests,clippy])assert.ok(existsSync(path),JSON.stringify(report?.kept));
});

test('corrupt and unknown profile markers keep the entire candidate inventory',t=>{
  for(const body of ['{broken',JSON.stringify({version:2,generation:'future'}),JSON.stringify({version:1,generation:42})]){
    const f=fixture(t),tree=f.tree('1'),current=f.output(tree),debug=f.output(tree,'debug');
    writeFileSync(join(current,'.nts-complete.json'),body);
    const report=reclaimDisk(f.options);
    assert.deepEqual(report.removed,[],JSON.stringify(report?.kept));assert.ok(report.kept.some(row=>row.root===tree),JSON.stringify(report?.kept));
    assert.ok(existsSync(debug),JSON.stringify(report?.kept));assert.ok(existsSync(current),JSON.stringify(report?.kept));
  }
});

test('a real cwd owner keeps a free scratch tree by name until it drains',async t=>{
  const f=fixture(t),tree=f.tree('1');
  const child=spawn('cat',[],{cwd:tree,env:f.s.env,stdio:['pipe','ignore','pipe']});
  const exited=once(child,'exit');let outsidePids:number[]=[];
  try{
    await once(child,'spawn');outsidePids=observeTreeProcesses([tree]).ignored.map(row=>row.pid);
    const report=reclaimDisk({...f.options,ownership:(root,target)=>assertNoProcessUsers([root,target])});
    assert.deepEqual(report.removed,[],JSON.stringify(report?.kept));
    assert.ok(report.kept.some(row=>row.root===tree&&row.reason.includes('process '+child.pid)&&row.reason.includes('cwd')),JSON.stringify(report));
  }finally{child.stdin.end();await exited;}
  const report=reclaimDisk({...f.options,ownership:(root,target)=>assertNoProcessUsers([root,target],{pids:[child.pid!,...outsidePids]})});
  assert.deepEqual(report.removed.map(row=>row.root),[tree],JSON.stringify(report));
  const facts=report.removed[0]!.facts;
  // The real user manager is present even when non-dumpable. Any ignored
  // observation names its exact PID/birth/cgroup in the removal receipt.
  assert.ok(facts.some(fact=>/ignored non-dumpable outside nts:.*systemd/.test(fact)),(JSON.stringify(facts))+'; kept='+JSON.stringify(report?.kept));
  const logged=JSON.parse(readFileSync(join(f.dir,'.disk-reclaim.log'),'utf8')) as {facts:string[]};
  assert.deepEqual(logged.facts,facts,JSON.stringify(report?.kept));
});

test('a real non-dumpable C child in the nts unit keeps its root by name',async t=>{
  const f=fixture(t),tree=f.tree('1'),executable=join(f.s.dir,'non-dumpable');
  const code='#include <sys/prctl.h>\n#include <unistd.h>\n#include <stdio.h>\nint main(int argc,char **argv){if(argc!=2||chdir(argv[1])||prctl(PR_SET_DUMPABLE,0))return 2;puts("ready");fflush(stdout);char byte;while(read(0,&byte,1)>0){}return 0;}\n';
  const build=spawnTest('clang',['-x','c','-','-o',executable],{input:code,env:f.s.env,encoding:'utf8'});
  assert.equal(build.status,0,build.stderr);
  const child=spawn(executable,[tree],{env:f.s.env,stdio:['pipe','pipe','pipe']});
  const exited=once(child,'exit');let out='',error='';
  child.stdout.on('data',bytes=>{out+=String(bytes);});child.stderr.on('data',bytes=>{error+=String(bytes);});
  try{
    await waitFor('non-dumpable child readiness',()=>out.includes('ready\n'),{stopped:()=>child.exitCode===null?undefined:error||'child exited '+child.exitCode});
    const cgroup=processCgroup(child.pid!);assert.match(cgroup,/(?:^|\/)nts[.-]/);
    const report=reclaimDisk({...f.options,ownership:(root,target)=>assertNoProcessUsers([root,target])});
    assert.deepEqual(report.removed,[],JSON.stringify(report?.kept));
    assert.ok(report.kept.some(row=>row.root===tree&&row.reason.includes('unreadable tool process '+child.pid)),JSON.stringify(report));
  }finally{child.stdin.end();await exited;}
});

test('a stale previous-boot lock and build claim confer no ownership after reboot',t=>{
  const f=fixture(t),tree=f.tree('1'),debug=f.output(tree,'debug',16*GiB);
  const capacity=new DiskCapacity({env:f.s.env,host:f.host,pool:f.options.pool,reclamation:{services:[],ownership:f.options.ownership}});
  const identity=processIdentity(process.pid);assert.ok(identity);
  const previousBoot=identity.replace(/^[^ ]+/,'00000000-0000-0000-0000-000000000000');assert.notEqual(previousBoot,identity);
  writeFileSync(join(f.dir,'.lock'),previousBoot+'\n');
  writeFileSync(capacity.stateFile,JSON.stringify({version:1,claims:[{id:'previous-boot',pid:process.pid,identity:previousBoot,root:tree,target:join(tree,'target')}]}));
  const report=capacity.reclaim(f.dir);assert.deepEqual(report?.removed.map(row=>row.root),[debug],JSON.stringify(report?.kept));
  assert.equal(existsSync(join(f.dir,'.lock')),false,JSON.stringify(report?.kept));
});

test('a live lease, dirty/unpublished/branched tree and unreadable owner remain named',t=>{
  const f=fixture(t),leased=f.tree('1'),dirty=f.tree('2'),unpublished=f.tree('3'),branched=f.tree('4'),unreadable=f.tree('5');
  f.output(leased,'debug');f.output(unreadable,'debug');
  writeFileSync(join(dirty,'README.md'),'not committed');
  f.s.commit({'private.txt':'not published'},'private commit',unpublished);
  f.s.git(['switch','-q','-c','not-published'],branched);
  const report=reclaimDisk({...f.options,protectedRoots:()=>[{root:leased,target:join(leased,'target')}],
    ownership:(tree)=>{if(tree===unreadable)throw Error('unreadable owned unit');}});
  for(const tree of [leased,dirty,unpublished,branched,unreadable])assert.ok(existsSync(tree),JSON.stringify(report?.kept));
  const text=report.kept.map(row=>row.reason).join('\n');
  for(const expected of [/live lease/,/uncommitted/,/unpublished detached/,/branch remains owned/,/unreadable owned unit/])assert.match(text,expected,JSON.stringify(report?.kept));
});

test('ignored local data, aliased roots and held resource locks prevent deletion',t=>{
  const f=fixture(t),local=f.tree('1'),aliased=f.tree('2'),locked=f.tree('3');
  mkdirSync(join(local,'local'));writeFileSync(join(local,'local/value'),'keep');
  const debug=f.output(locked,'debug');
  const saved=aliased+'.saved';renameSync(aliased,saved);symlinkSync(saved,aliased);
  const lock=GateResource.tryAcquire(locked+'.lock');assert.ok(lock);
  try{
    const report=reclaimDisk(f.options),text=report.kept.map(row=>row.reason).join('\n');
    assert.match(text,/ignored local data/,JSON.stringify(report?.kept));assert.match(text,/aliased root/,JSON.stringify(report?.kept));assert.match(text,/resource lock is held/,JSON.stringify(report?.kept));
    assert.ok(existsSync(join(local,'local/value')),JSON.stringify(report?.kept));assert.ok(existsSync(debug),JSON.stringify(report?.kept));assert.ok(lstatSync(aliased).isSymbolicLink(),JSON.stringify(report?.kept));
  }finally{lock.close();}
});

test('replacement between inventory and removal cannot borrow the acquired root identity',t=>{
  const f=fixture(t),tree=f.tree('1'),debug=f.output(tree,'debug');
  let changed=false;
  const report=reclaimDisk({...f.options,ownership:()=>{
    if(changed)return;changed=true;renameSync(debug,debug+'.old');mkdirSync(debug);writeFileSync(join(debug,'new'),'foreign generation');
  }});
  assert.match(report.kept.map(row=>row.reason).join('\n'),/identity changed/,JSON.stringify(report?.kept));
  assert.equal(readFileSync(join(debug,'new'),'utf8'),'foreign generation',JSON.stringify(report?.kept));
});

test('snapshot never collects; explicit admission reclamation uses the same promises and owner',t=>{
  const f=fixture(t),tree=f.tree('1');f.output(tree,'debug',16*GiB);
  const capacity=new DiskCapacity({env:f.s.env,host:f.host,pool:f.options.pool,reclamation:{services:[],ownership:f.options.ownership}});
  assert.equal(capacity.snapshot(f.dir).freeBytes,44*GiB);assert.ok(existsSync(join(tree,'target/debug')));
  const service=join(f.s.dir,'builder');mkdirSync(service);
  writeFileSync(join(service,'Cargo.toml'),'[workspace]\n[profile.nts-dev]\ndebug=0\n');
  const release=capacity.beginBuild({root:service,target:join(service,'target')});
  try{assert.equal(existsSync(join(tree,'target/debug')),false);assert.equal(capacity.snapshot(f.dir).reservedBytes,7*GiB);}
  finally{release();}
});

test('temporary acquisition reclaims before atomically claiming its bytes',t=>{
  const f=fixture(t),tree=f.tree('1'),debug=f.output(tree,'debug',16*GiB);
  const capacity=new DiskCapacity({env:f.s.env,host:f.host,pool:f.options.pool,reclamation:{services:[],ownership:f.options.ownership}});
  assert.equal(capacity.snapshot(f.dir).freeBytes,44*GiB);assert.ok(existsSync(debug));
  const attempt=capacity.tryTemporary(join(f.s.dir,'capture'),GiB);
  assert.ok(attempt.lease,'reclaim must preserve temporary admission');
  try{
    assert.equal(existsSync(debug),false);
    assert.equal(attempt.snapshot.freeBytes,60*GiB);
    assert.equal(capacity.snapshot(f.dir).temporaryReservedBytes,GiB);
    const audit=JSON.parse(readFileSync(join(f.dir,'.disk-reclaim.log'),'utf8'));
    assert.equal(audit.root,debug);assert.equal(audit.kind,'obsolete-profile');
  }finally{attempt.lease.release();}
  assert.equal(capacity.snapshot(f.dir).temporaryReservedBytes,0);
});

test('process ownership includes cwd, executable and open files and refuses unreadability',t=>{
  const f=fixture(t),root=join(f.s.dir,'owned'),proc=join(f.s.dir,'proc');mkdirSync(root);mkdirSync(proc);
  const pid=join(proc,'42');mkdirSync(join(pid,'fd'),{recursive:true});
  writeFileSync(join(pid,'comm'),'worker\n');
  writeFileSync(join(pid,'status'),'Uid:\t'+Array<number>(4).fill(process.getuid!()).join('\t')+'\n');
  writeFileSync(join(pid,'stat'),'42 (worker) '+['S',...Array<string>(18).fill('0'),'99'].join(' '));
  symlinkSync(root,join(pid,'cwd'));symlinkSync('/outside/node',join(pid,'exe'));
  assert.throws(()=>assertNoProcessUsers([root],{proc}),/42 owns cwd/);
  rmSync(join(pid,'cwd'));symlinkSync('/outside',join(pid,'cwd'));rmSync(join(pid,'exe'));symlinkSync(join(root,'program'),join(pid,'exe'));
  assert.throws(()=>assertNoProcessUsers([root],{proc}),/42 owns exe/);
  rmSync(join(pid,'exe'));symlinkSync('/outside/node',join(pid,'exe'));symlinkSync(join(root,'data')+' (deleted)',join(pid,'fd/7'));
  assert.throws(()=>assertNoProcessUsers([root],{proc}),/42 owns fd\/7/);
  rmSync(join(pid,'fd/7'));assert.doesNotThrow(()=>assertNoProcessUsers([root],{proc}));
  rmSync(join(pid,'exe'));assert.doesNotThrow(()=>assertNoProcessUsers([root],{proc}));
  symlinkSync('/outside/node',join(pid,'exe'));writeFileSync(join(pid,'comm'),'non-dumpable\n');
  writeFileSync(join(pid,'cgroup'),'0::/user.slice/session-2.scope\n');chmodSync(join(pid,'fd'),0);
  try{
    assert.match(assertNoProcessUsers([root],{proc}).join('\n'),/ignored non-dumpable outside nts: pid 42 non-dumpable/);
    writeFileSync(join(pid,'cgroup'),'0::/user.slice/nts-agent-private.service\n');
    assert.throws(()=>assertNoProcessUsers([root],{proc}),/unreadable tool process 42/);
    rmSync(join(pid,'cgroup'));assert.throws(()=>assertNoProcessUsers([root],{proc}),/keeps unreadable process/);
  }finally{chmodSync(join(pid,'fd'),0o700);}
});

test('typed unit execution properties preserve path and argument ownership',()=>{
  const root='/owned/tree',unit='owned.service';
  for(const property of ['ExecStartPre','ExecStart','ExecStartPost'] as const){
    for(const command of [{property,path:root+'/program',args:[]},{property,path:'/usr/bin/node',args:[root+'/argument with ; space']},
      {property,path:'/usr/bin/node',args:['--file='+root+'/config']},{property,path:'/usr/bin/node',args:['../tree/entry']}]){
      const reading:UnitTreeOwnership={unit,workingDirectory:'/owned/outside',rootDirectory:'',commands:[command]};
      assert.throws(()=>assertUnitTreeUnused([root],reading),/unit owned\.service owns ExecStart/);
    }
  }
  const command=['/usr/bin/node',['/outside/entry','quoted ; value'],false,0,0,0,0,0,0,0];
  const text=[{type:'s',data:'/outside'},{type:'s',data:''},...Array.from({length:3},()=>({type:'a(sasbttttuii)',data:[command]}))].map(row=>JSON.stringify(row)).join('\n');
  const reading=parseUnitTreeOwnership(unit,text);assert.deepEqual(reading.commands[0]!.args,command[1]);
  assert.doesNotThrow(()=>assertUnitTreeUnused([root],reading));
  assert.throws(()=>parseUnitTreeOwnership(unit,text.replace('a(sasbttttuii)','unknown')),/unreadable unit ExecStartPre/);
  assert.throws(()=>parseUnitTreeOwnership(unit,'{}'),/unreadable unit directories/);
  assert.throws(()=>assertUnitTreeUnused([root],{...reading,workingDirectory:root+'/cwd'}),/WorkingDirectory/);
  assert.throws(()=>assertUnitTreeUnused([root],{...reading,rootDirectory:root+'/root'}),/RootDirectory/);
  assert.doesNotThrow(()=>assertUnitTreeUnused([root],{...reading,workingDirectory:'~'}));
  assert.doesNotThrow(()=>assertUnitTreeUnused([root],{...reading,workingDirectory:'!/outside/absent'}));
  assert.throws(()=>assertUnitTreeUnused([root],{...reading,workingDirectory:'-/outside'}),/unresolved unit WorkingDirectory/);
  assert.throws(()=>assertUnitTreeUnused([root],{...reading,workingDirectory:'!!/outside'}),/unresolved unit WorkingDirectory/);
});

test('unreadable typed unit properties name the unit, property and rejected value',()=>{
  const unit='nts-full-check-count.service',properties=['ExecStartPre','ExecStart','ExecStartPost'] as const;
  const command=(path:string)=>[path,[path,'--shared','/outside/controller.lock'],false,0,0,0,0,0,0,0];
  for(const [index,property] of properties.entries()){
    const rows:{type:string;data:unknown}[]=[{type:'s',data:'/outside'},{type:'s',data:''},...properties.map(()=>({type:'a(sasbttttuii)',data:[command('/usr/bin/flock'),command('/usr/bin/node')]}))];
    const text=()=>rows.map(row=>JSON.stringify(row)).join('\n');
    const reading=parseUnitTreeOwnership(unit,text());
    assert.equal(reading.commands.length,6,'every command in every property is retained');
    assert.doesNotThrow(()=>assertUnitTreeUnused(['/owned/tree'],reading));
    for(const entry of [command('flock'),['/usr/bin/flock'],['/usr/bin/flock',[42],false,0,0,0,0,0,0,0]]){
      rows[index+2]={type:'a(sasbttttuii)',data:[entry]};
      assert.throws(()=>parseUnitTreeOwnership(unit,text()),error=>{
        assert.ok(error instanceof Error);
        for(const value of [unit,property,JSON.stringify(entry)])assert.ok(error.message.includes(value),error.message);
        return true;
      });
    }
    const lines=text().split('\n');lines[index+2]='{broken';
    assert.throws(()=>parseUnitTreeOwnership(unit,lines.join('\n')),error=>error instanceof Error&&[unit,property,'{broken'].every(value=>error.message.includes(value)));
  }
});

test('an activating start-pre unit owns its future executable before PID zero starts',async t=>{
  const f=fixture(t),tree=f.tree('1'),outside=join(f.s.dir,'outside');mkdirSync(outside);
  const entry=join(tree,'entry'),prelude=join(outside,'prelude.mjs'),ready=join(outside,'ready');
  writeFileSync(entry,'#!/bin/sh\nexit 0\n',{mode:0o755});
  writeFileSync(prelude,generatedJavaScript(`import {writeFileSync,watch} from 'node:fs';watch(${JSON.stringify(outside)},()=>{});writeFileSync(${JSON.stringify(ready)},'ready');`));
  const alias=join(outside,'entry-alias');symlinkSync(entry,alias);
  for(const executable of [entry,alias]){
    const unit='nts-agent-709-unit-entry-'+randomUUID()+'.service';
    const started=spawnTest('systemd-run',['--user','--collect','--quiet','--no-block','--unit='+unit,'--working-directory='+outside,
      '-p','LimitCORE=0','-p','Nice=19','-p','ExecStartPre='+process.execPath+' '+prelude,'--',executable],{env:f.s.env,encoding:'utf8'});
    assert.equal(started.status,0,started.stderr);
    try{
      await waitFor('owned pre-exec barrier',()=>existsSync(ready));
      const state=spawnTest('systemctl',['--user','show',unit,'--property=ActiveState,SubState,ExecMainPID'],{env:f.s.env,encoding:'utf8'});
      assert.equal(state.status,0,state.stderr);assert.match(state.stdout,/^ActiveState=activating$/m);
      assert.match(state.stdout,/^SubState=start-pre$/m);assert.match(state.stdout,/^ExecMainPID=0$/m);
      assert.throws(()=>assertNoUnitUsers([tree],[unit]),error=>error instanceof Error&&error.message.includes('unit '+unit+' owns ExecStart path '+executable));
      assert.ok(existsSync(entry));
    }finally{
      const stop=spawnTest('systemctl',['--user','stop',unit],{env:f.s.env,encoding:'utf8'});assert.equal(stop.status,0,stop.stderr);
      rmSync(ready,{force:true});
    }
  }
});

test('unit paths follow outside aliases and symlink before parent components',t=>{
  const f=fixture(t),tree=f.tree('1'),outside=join(f.s.dir,'outside');mkdirSync(outside);
  mkdirSync(join(tree,'nested'));writeFileSync(join(tree,'entry'),'input');symlinkSync(join(tree,'nested'),join(outside,'jump'));
  const reading:UnitTreeOwnership={unit:'alias.service',workingDirectory:outside,rootDirectory:'',commands:[]};
  assert.throws(()=>assertUnitTreeUnused([tree],{...reading,workingDirectory:join(outside,'jump')}),/owns WorkingDirectory.* -> /);
  assert.throws(()=>assertUnitTreeUnused([tree],{...reading,rootDirectory:join(outside,'jump')}),/owns RootDirectory.* -> /);
  for(const argument of [outside+'/jump/../entry','jump/../entry']){
    assert.throws(()=>assertUnitTreeUnused([tree],{...reading,commands:[{property:'ExecStart',path:process.execPath,args:[argument]}]}),/owns ExecStart argument.* -> /);
  }
  assert.throws(()=>assertUnitTreeUnused([tree],{...reading,commands:[{property:'ExecStart',path:process.execPath,args:[outside+'/jump/not-yet-created']}]}),/owns ExecStart argument.* -> /);
  symlinkSync(f.dir,join(outside,'pool-alias'));
  assert.throws(()=>assertUnitTreeUnused([tree],{...reading,rootDirectory:join(outside,'pool-alias')}),/owns RootDirectory.* -> /);
});

test('unit arguments with a name too long to exist walk up, and other errors still refuse',t=>{
  const f=fixture(t),tree=f.tree('1'),outside=join(f.s.dir,'outside');mkdirSync(outside);
  mkdirSync(join(tree,'nested'));symlinkSync(join(tree,'nested'),join(outside,'jump'));
  const long='x'.repeat(300),reading:UnitTreeOwnership={unit:'inline.service',workingDirectory:outside,rootDirectory:'',commands:[]};
  const argument=(value:string):UnitTreeOwnership=>({...reading,commands:[{property:'ExecStart',path:process.execPath,args:['-e',value]}]});
  // A `node -e` script is read as a relative path past NAME_MAX.
  for(const value of [long+';process.exit(0)',outside+'/'+long+'/entry',outside+'/missing/'+long])assert.doesNotThrow(()=>assertUnitTreeUnused([tree],argument(value)));
  assert.throws(()=>assertUnitTreeUnused([tree],argument(outside+'/jump/'+long)),/owns ExecStart argument.* -> /);
  assert.throws(()=>assertUnitTreeUnused([tree],argument('jump/'+long)),/owns ExecStart argument.* -> /);
  assert.throws(()=>assertUnitTreeUnused([tree],argument(tree+'/'+long)),/owns ExecStart argument/);
  symlinkSync('loop',join(outside,'loop'));
  assert.throws(()=>assertUnitTreeUnused([tree],argument(outside+'/loop/entry')),error=>error instanceof Error&&/unreadable unit inline\.service ExecStart argument/.test(error.message)&&(error.cause as NodeJS.ErrnoException).code==='ELOOP');
  mkdirSync(join(outside,'closed'));chmodSync(join(outside,'closed'),0);
  try{
    assert.throws(()=>assertUnitTreeUnused([tree],argument(outside+'/closed/entry')),error=>error instanceof Error&&/unreadable unit inline\.service ExecStart argument/.test(error.message)&&(error.cause as NodeJS.ErrnoException).code==='EACCES');
  }finally{chmodSync(join(outside,'closed'),0o700);}
});

test('a unit argument past PATH_MAX through existing components and a symlink into the tree refuses',t=>{
  const f=fixture(t),tree=f.tree('1'),outside=join(f.s.dir,'outside');mkdirSync(outside);mkdirSync(join(tree,'inner'));
  // Built relatively, so no single call needs a path past PATH_MAX.
  const name='d'.repeat(200),depth=25;
  const built=spawnTest('sh',['-c','cd "$1" && for i in $(seq '+depth+'); do mkdir "$2" && cd "$2" || exit 1; done && ln -s "$3" s','chain',outside,name,join(tree,'inner')],{env:f.s.env,encoding:'utf8'});
  try{
    assert.equal(built.status,0,built.stderr);
    const argument=outside+('/'+name).repeat(depth)+'/s/file';assert.ok(Buffer.byteLength(argument)>4096);
    const reading:UnitTreeOwnership={unit:'deep.service',workingDirectory:outside,rootDirectory:'',commands:[{property:'ExecStart',path:process.execPath,args:[argument]}]};
    assert.throws(()=>assertUnitTreeUnused([tree],reading),error=>error instanceof Error&&/unreadable unit deep\.service ExecStart argument/.test(error.message)&&(error.cause as NodeJS.ErrnoException).code==='ENAMETOOLONG');
    // A component past NAME_MAX after the deep prefix still cannot walk past it.
    assert.throws(()=>assertUnitTreeUnused([tree],{...reading,commands:[{property:'ExecStart',path:process.execPath,args:[argument+'/'+'x'.repeat(300)]}]}),/unreadable unit deep\.service ExecStart argument/);
  }finally{
    const removed=spawnTest('rm',['-rf','--',join(outside,name)],{env:f.s.env,encoding:'utf8'});assert.equal(removed.status,0,removed.stderr);
  }
});

for(const cacheTag of [true,false])test('build admission reclaims surplus proven profiles beside unknown siblings; cache tag '+cacheTag,t=>{
  const f=fixture(t),old=f.tree('1'),newer=f.tree('2'),newest=f.tree('3');
  for(const tree of [old,newer,newest]){
    f.output(tree,'nts-dev',8*GiB);f.output(tree,'clippy',GiB);
  }
  // Explicit order, independent of the machine's clock or filesystem times.
  for(const [index,tree] of [old,newer,newest].entries()){
    const saved=f.s.env.GIT_COMMITTER_DATE;f.s.env.GIT_COMMITTER_DATE='@'+(1000000000+index)+' +0000';
    try{f.s.git(['switch','-q','-c','clock-'+index],tree);f.s.git(['switch','-q','--detach','main'],tree);}finally{if(saved===undefined)delete f.s.env.GIT_COMMITTER_DATE;else f.s.env.GIT_COMMITTER_DATE=saved;}
  }
  const evidence=join(old,'target','unowned-scratch','evidence');mkdirSync(join(old,'target','unowned-scratch'));writeFileSync(evidence,'preserve this evidence');
  if(!cacheTag)rmSync(join(old,'target/CACHEDIR.TAG'));
  f.setFree(46*GiB);
  const root=join(f.s.dir,'builder');mkdirSync(root);writeFileSync(join(root,'Cargo.toml'),'[workspace]\n');
  const capacity=new DiskCapacity({env:f.s.env,host:f.host,pool:f.options.pool,reclamation:{services:[],ownership:f.options.ownership}});
  const release=capacity.beginBuild({root,target:join(root,'target')});
  try{
    assert.equal(existsSync(join(old,'target/nts-dev')),false);
    assert.ok(existsSync(join(newest,'target/nts-dev')));
    assert.equal(existsSync(join(newer,'target')),false,'pressure restores cold-build headroom while keeping one warm target');
    assert.equal(readFileSync(evidence,'utf8'),'preserve this evidence');
    assert.ok(capacity.snapshot(f.dir).availableBytes>=0);
    const log=readFileSync(join(f.dir,'.disk-reclaim.log'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.deepEqual(log.map(row=>row.root),[join(old,'target/clippy'),join(old,'target/nts-dev'),join(newer,'target')]);assert.ok(log.every(row=>row.kind==='free-build-output'));
  }finally{release();}
});

test('a disk refusal lists every retained warm target, unknown sibling and ownership guard',t=>{
  const f=fixture(t),trees=['1','2','3'].map(f.tree);
  for(const tree of trees){f.output(tree,'nts-dev');f.output(tree,'clippy',GiB);}
  const extra=join(trees[2]!,'target/unowned-scratch');mkdirSync(extra);writeFileSync(join(extra,'evidence'),'kept');
  f.setFree(40*GiB-1);
  const root=join(f.s.dir,'builder');mkdirSync(root);
  const capacity=new DiskCapacity({env:f.s.env,host:f.host,pool:f.options.pool,reclamation:{services:[],ownership:()=>{throw Error('unit protected-build.service owns WorkingDirectory');}}});
  assert.throws(()=>capacity.beginBuild({root,target:join(root,'target')}),error=>{
    assert.ok(error instanceof DiskBuildAdmissionError);
    assert.equal(error.disk.shortBytes,7*GiB+1);
    for(const tree of trees)assert.ok(error.message.includes(tree),error.message);
    assert.match(error.message,/one warm free target retained under pressure/);
    assert.match(error.message,/unowned-scratch: unrecognized target content; writer: unknown/);
    assert.match(error.message,/protected-build.service owns WorkingDirectory/);
    return true;
  });
  assert.equal(existsSync(capacity.stateFile),false,'denial creates no build claim');
});

for(const detached of [false,true])for(const guard of ['claim','marker','tracked','lock','unit'])test('granular profile deletion rechecks '+guard+' beside removal; detached '+detached,t=>{
  const f=fixture(t),trees=['1','2','3'].map(f.tree),old=trees[2]!;
  for(const tree of trees){f.output(tree);f.output(tree,'clippy',GiB);}
  const profile=join(old,'target/nts-dev');mkdirSync(join(old,'target/unowned-scratch'));
  if(detached){f.s.git(['switch','-q','-c','938'],old);writeWorkerPresence(old,'938','detached',10);}
  // Equal fixture recency retains trees 1 and 2. Tree 3 offers both profiles.
  let claimed=false;
  const lock=guard==='lock'?GateResource.tryAcquire(old+'.lock'):null;
  if(guard==='lock')assert.ok(lock);
  try{
    const report=reclaimDisk({...f.options,protectedRoots:()=>claimed?[{root:profile,target:profile}]:[],ownership:(_tree,root)=>{
      if(root!==profile)return;
      if(guard==='claim')claimed=true;
      if(guard==='marker')writeFileSync(join(profile,'.nts-complete.json'),'{broken');
      if(guard==='tracked'){f.s.git(['add','-f','target/nts-dev/built'],old);}
      if(guard==='unit')throw Error('unit profile-builder.service owns profile');
    }});
    assert.ok(existsSync(profile),JSON.stringify(report));
    const reason=report.kept.map(row=>row.reason).join('\n');
    assert.match(reason,guard==='claim'?/live lease/:guard==='marker'?/JSON/:guard==='tracked'?detached?/tracked target content/:/uncommitted changes/:guard==='lock'?/resource lock is held/:/profile-builder.service/);
  }finally{lock?.close();}
});

for(const detached of [false,true])test('unproved profiles and unknown siblings are retained without displacing compatible warm trees; detached '+detached,t=>{
  const f=fixture(t),a=f.tree('1'),b=f.tree('2'),unproved=f.tree('3');
  for(const tree of [a,b]){f.output(tree);f.output(tree,'clippy',GiB);}
  const profile=f.output(unproved);rmSync(join(profile,'.nts-complete.json'));rmSync(join(unproved,'target/CACHEDIR.TAG'));
  mkdirSync(join(unproved,'target/unowned-scratch'));
  if(detached){f.s.git(['switch','-q','-c','938'],unproved);writeWorkerPresence(unproved,'938','detached',10);}
  f.setFree(100*GiB);
  const report=reclaimDisk({...f.options,maintenance:{before:Infinity,keep:2}});
  assert.deepEqual(report.removed,[],JSON.stringify(report));
  assert.ok(report.kept.some(row=>detached?row.root===unproved&&row.reason.includes('branch remains owned'):row.root===profile&&row.reason.includes('neither Cargo cache identity nor a completion marker')),JSON.stringify(report));
  for(const tree of [a,b])assert.ok(report.kept.some(row=>row.root===join(tree,'target')&&row.reason==='two warm free targets retained'));
});

test('a tagless target offers debug only through obsolete-profile ownership',t=>{
  const f=fixture(t),tree=f.tree('1'),debug=f.output(tree,'debug',16*GiB);
  rmSync(join(tree,'target/CACHEDIR.TAG'));
  const report=reclaimDisk(f.options);
  assert.deepEqual(report.removed.map(row=>[row.root,row.kind]),[[debug,'obsolete-profile']],JSON.stringify(report));
  assert.equal(report.kept.some(row=>row.root===debug),false,'one report cannot both remove and retain the same debug profile');
});

for(const bytes of [GiB,16*GiB])test('slow deletion releases the pool lock before draining '+bytes+' bytes',t=>{
  const f=fixture(t),tree=f.tree('1'),profile=f.output(tree,'debug',bytes);mkdirSync(join(tree,'target/evidence'));
  let entered=0,now=0;
  const report=reclaimDisk({...f.options,host:{...f.host,now:()=>now},removePayload:(payload,kind,remove)=>{
    entered++;now+=bytes/GiB*60_000;assert.equal(kind,'obsolete-profile');assert.equal(existsSync(profile),false);
    const lock=acquire(join(f.dir,'.lock'));assert.ok(lock,'pool lock is available throughout the deletion barrier');
    try{
      assert.equal(f.host.disk(f.dir).freeBytes,44*GiB,'rename credits no bytes');
      assert.ok(existsSync(payload));
      const row=diskTrash(f.dir,f.host.wallNow())[0]!;
      assert.equal(row.allocatedBytes,bytes);assert.equal(row.kind,kind);
    }finally{lock.release();}
    const nested=reclaimDisk(f.options);assert.deepEqual(nested.removed,[],'a live drainer keeps its payload');
    remove();
  }});
  assert.equal(report.lockHeldMs,0,'supplied slow-delete minutes are excluded from measured lock hold');
  t.diagnostic(JSON.stringify({bytes,deleteMs:now,lockHeldMs:report.lockHeldMs}));
  assert.equal(entered,1);assert.equal(report.removed.length,1);assert.equal(report.after,44*GiB+bytes);
  assert.deepEqual(diskTrash(f.dir,f.host.wallNow()),[]);
});

test('interrupted partial deletion is resumed and accounted once, even after pressure ends',t=>{
  const f=fixture(t),tree=f.tree('1');f.output(tree,'debug',16*GiB);mkdirSync(join(tree,'target/evidence'));
  const interrupted=reclaimDisk({...f.options,removePayload:(payload,_kind)=>{
    rmSync(join(payload,'built'));throw Error('deliberate interrupted drain');
  }});
  assert.equal(interrupted.removed.length,0);assert.match(interrupted.kept.map(row=>row.reason).join('\n'),/interrupted drain/);
  assert.equal(f.host.disk(f.dir).freeBytes,44*GiB,'partial trash still occupies its supplied bytes');
  const entry=diskTrash(f.dir,f.host.wallNow())[0]!;
  const file=join(entry.path,'manifest.json'),row=JSON.parse(readFileSync(file,'utf8'));row.at=f.host.wallNow()-3_600_001;writeFileSync(file,JSON.stringify(row));
  f.setFree(60*GiB);const resumed=reclaimDisk(f.options);
  assert.equal(resumed.triggered,false);assert.equal(resumed.removed.length,1);
  assert.ok(resumed.kept.some(row=>row.root===entry.path&&row.reason.includes('stuck')));
  assert.deepEqual(diskTrash(f.dir,f.host.wallNow()),[]);
  const log=readFileSync(join(f.dir,'.disk-reclaim.log'),'utf8').trim().split('\n');assert.equal(log.length,1);
  assert.deepEqual(reclaimDisk(f.options).removed,[]);
});

test('unknown manifest kinds never gain a trash deletion grant',t=>{
  const f=fixture(t),tree=f.tree('1');f.output(tree,'debug',16*GiB);mkdirSync(join(tree,'target/evidence'));
  reclaimDisk({...f.options,removePayload:()=>{throw Error('leave payload');}});
  const entry=diskTrash(f.dir,f.host.wallNow())[0]!,file=join(entry.path,'manifest.json'),row=JSON.parse(readFileSync(file,'utf8'));
  row.removal.kind='user-data';writeFileSync(file,JSON.stringify(row));
  const report=reclaimDisk(f.options);
  assert.ok(existsSync(join(entry.path,'payload')));assert.deepEqual(report.removed,[]);
  assert.match(report.kept.map(row=>row.reason).join('\n'),/invalid disk trash manifest/);
});

test('a child that exits holding the kernel drainer lock leaves recoverable trash',t=>{
  const f=fixture(t),tree=f.tree('1');f.output(tree,'debug',16*GiB);mkdirSync(join(tree,'target/evidence'));
  reclaimDisk({...f.options,removePayload:()=>{throw Error('crash boundary');}});
  const entry=diskTrash(f.dir,f.host.wallNow())[0]!;
  const source=generatedJavaScript(`
import {GateResource} from ${JSON.stringify(new URL('./gate-resource.ts',import.meta.url).href)};
const owner=GateResource.tryAcquire(${JSON.stringify(join(entry.path,'.drain.lock'))});
if(!owner)throw Error('control did not acquire trash lock');
console.log('kernel drainer lock held');throw Error('deliberate drainer crash');`);
  const crashed=spawnTest(process.execPath,['--input-type=module','-e',source],{env:f.s.env,encoding:'utf8'});
  assert.equal(crashed.status,1,crashed.stderr);assert.match(crashed.stdout,/kernel drainer lock held/);assert.match(crashed.stderr,/deliberate drainer crash/);
  assert.equal(f.host.disk(f.dir).freeBytes,44*GiB);
  assert.equal(reclaimDisk(f.options).removed.length,1);
  assert.deepEqual(diskTrash(f.dir,f.host.wallNow()),[]);
});

test('a failed Git trash removal stays registered and never falls back to recursive removal',t=>{
  const f=fixture(t),tree=f.tree('1');
  const report=reclaimDisk({...f.options,removePayload:(payload,_kind,remove)=>{
    writeFileSync(join(payload,'unexpected.txt'),'retain this new data');remove();
  }});
  assert.equal(report.removed.length,0);assert.equal(existsSync(tree),false);
  const entry=diskTrash(f.dir,f.host.wallNow())[0]!,payload=join(entry.path,'payload');
  assert.equal(readFileSync(join(payload,'unexpected.txt'),'utf8'),'retain this new data');
  assert.ok(f.s.git(['worktree','list','--porcelain']).includes(payload));
  const resumed=reclaimDisk(f.options);assert.equal(resumed.removed.length,0);
  assert.equal(readFileSync(join(payload,'unexpected.txt'),'utf8'),'retain this new data');
});

test('recovery retires Git registration after a crash between payload removal and registry cleanup',t=>{
  const f=fixture(t);f.tree('1');
  reclaimDisk({...f.options,removePayload:(payload)=>{rmSync(payload,{recursive:true});throw Error('removed bytes before registry');}});
  const entry=diskTrash(f.dir,f.host.wallNow())[0]!,payload=join(entry.path,'payload');
  assert.equal(existsSync(payload),false);assert.ok(f.s.git(['worktree','list','--porcelain']).includes(payload));
  const report=reclaimDisk(f.options);assert.equal(report.removed.length,1,JSON.stringify(report));
  assert.equal(f.s.git(['worktree','list','--porcelain']).includes(payload),false);
  assert.deepEqual(diskTrash(f.dir,f.host.wallNow()),[]);
});

test('only empty UUID envelopes with unheld empty lock metadata are recovered without a manifest',t=>{
  const f=fixture(t),root=join(f.dir,DISK_TRASH);mkdirSync(root);
  const ids=[0,1,2,3,4].map(n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0'));
  for(const id of ids)mkdirSync(join(root,id));
  writeFileSync(join(root,ids[1]!,'.drain.lock'),'');
  writeFileSync(join(root,ids[2]!,'payload'),'unknown bytes');
  writeFileSync(join(root,ids[3]!,'.drain.lock'),'');
  const held=GateResource.tryAcquire(join(root,ids[3]!,'.drain.lock'));assert.ok(held);
  writeFileSync(join(root,ids[4]!,'manifest.json'),'{broken');
  try{
    reclaimDisk(f.options);
    assert.deepEqual(readdirSync(root).sort(),ids.slice(2));
    assert.equal(readFileSync(join(root,ids[2]!,'payload'),'utf8'),'unknown bytes');
  }finally{held.close();}
  reclaimDisk(f.options);assert.deepEqual(readdirSync(root).sort(),[ids[2],ids[4]]);
});

for(const published of [false,true])test('a listed trash envelope retired before locking is silent; published '+published,t=>{
  const f=fixture(t);
  let entry:string;
  if(published){
    const tree=f.tree('1');f.output(tree,'debug',16*GiB);mkdirSync(join(tree,'target/evidence'));
    reclaimDisk({...f.options,removePayload:()=>{throw Error('leave published envelope');}});
    entry=diskTrash(f.dir,f.host.wallNow())[0]!.path;
  }else{
    entry=join(f.dir,DISK_TRASH,'00000000-0000-0000-0000-000000000001');mkdirSync(entry,{recursive:true});
  }
  f.setFree(60*GiB);
  let retired=false;
  const report=reclaimDisk({...f.options,locked:<T>(body:()=>T)=>withLock(join(f.dir,'.lock'),()=>{
    if(!retired){retired=true;rmSync(entry,{recursive:true});}
    return body();
  })});
  assert.equal(retired,true,'retirement happens after the listing and before the first locked observation');
  assert.deepEqual(report.removed,[],'the retiring owner already completed this entry');
  assert.deepEqual(report.kept.filter(row=>!row.routine),[],'a stale listing produces no retention diagnostic');
  assert.equal(existsSync(entry),false);
});

test('a listed staging envelope gains its manifest and payload before locking without a stale diagnostic',t=>{
  const f=fixture(t),tree=f.tree('1');f.output(tree,'debug',16*GiB);mkdirSync(join(tree,'target/evidence'));
  reclaimDisk({...f.options,removePayload:()=>{throw Error('leave envelope for staging control');}});
  const entry=diskTrash(f.dir,f.host.wallNow())[0]!.path,file=join(entry,'manifest.json'),payload=join(entry,'payload');
  const manifest=readFileSync(file),saved=join(f.s.dir,'staging-payload');renameSync(payload,saved);rmSync(file);
  const owner=GateResource.tryAcquire(join(entry,'.drain.lock'));assert.ok(owner);
  f.setFree(60*GiB);
  let published=false;
  try{
    const report=reclaimDisk({...f.options,locked:<T>(body:()=>T)=>withLock(join(f.dir,'.lock'),()=>{
      if(!published){published=true;renameSync(saved,payload);writeFileSync(file,manifest);}
      return body();
    })});
    assert.equal(published,true,'publication happens after the listing and before the locked classification');
    assert.deepEqual(report.removed,[],'the live drainer retains its payload');
    assert.deepEqual(report.kept.filter(row=>!row.routine),[],'the published manifest replaces the stale missing-manifest observation');
    assert.ok(existsSync(payload));assert.deepEqual(readFileSync(file),manifest);
  }finally{owner.close();}
  assert.equal(reclaimDisk(f.options).removed.length,1,'recovery drains the payload after its owner releases');
});

test("reclamation offers exactly the shared classifier's obsolete profiles, which the count reads too",t=>{
  const f=fixture(t),tree=join(f.s.dir,'service');mkdirSync(tree);
  writeFileSync(join(tree,'Cargo.toml'),'[workspace]\n[profile.nts-dev]\ndebug=0\n');
  const target=join(tree,'target');
  f.output(tree);f.output(tree,'debug',4*GiB);const old=f.output(tree,'clippy',4*GiB);f.output(tree,'release',4*GiB);
  writeFileSync(join(old,'.nts-complete.json'),JSON.stringify({version:1,generation:'0'.repeat(64)}));
  const expected=[...targetProfiles(target,name=>buildGeneration(tree,name))].filter(row=>row.state==='obsolete').map(row=>row.root);
  assert.deepEqual(expected,[join(target,'debug'),old]);
  const report=reclaimDisk({...f.options,services:[{tree,target,service:true}]});
  assert.deepEqual(report.removed.map(row=>row.root).sort(),[...expected].sort(),JSON.stringify(report.kept));
  assert.ok(report.removed.every(row=>row.kind==='obsolete-profile'));
});

test('the classifier names a corrupt or future marker with its reader\'s own message, and never reads it as unknown',t=>{
  const f=fixture(t),tree=f.tree('1'),current=f.output(tree);
  const file=join(current,'.nts-complete.json');
  for(const [body,message] of [['{broken',/JSON/],[JSON.stringify({version:2,generation:'future'}),/unsupported future state version 2/],[JSON.stringify({version:1,generation:42}),/^invalid profile generation /]] as const){
    writeFileSync(file,body);
    assert.throws(()=>profileMarker(current,null),(error:unknown)=>error instanceof ProfileMarkerError&&error.file===file&&message.test(error.message));
    assert.throws(()=>[...targetProfiles(join(tree,'target'),()=>null)],ProfileMarkerError);
  }
});
