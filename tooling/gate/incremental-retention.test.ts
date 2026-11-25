import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,linkSync,mkdirSync,readFileSync,readdirSync,rmSync,utimesSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {testScratch} from './test-scratch.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {GateResource} from './gate-resource.ts';
import {CARGO_OWNER} from './cargo.ts';
import {waitFor} from './test-wait.ts';
import {CARGO_PROFILE_LOCKS,RETENTION_STATE,incrementalUsage,profileLocks,readRetentionState,retainIncremental,retainTarget,type RetentionOptions} from './incremental-retention.ts';

// Supplied clocks: a fixture's retention outcome never depends on the machine's time.
const host={now:()=>0,wallNow:()=>1_800_000_000_000};
const T0=1_700_000_000;

/** A cargo profile directory with its lock files and an incremental directory. */
function profile(t:TestContext,name='retention'):string{
  const dir=join(testScratch(t,name),'target','nts-dev');
  mkdirSync(join(dir,'incremental'),{recursive:true});mkdirSync(join(dir,'deps'));
  for(const lock of CARGO_PROFILE_LOCKS)writeFileSync(join(dir,lock),'');
  writeFileSync(join(dir,'deps','libkept-0123.rlib'),'artifact');
  return dir;
}
/** A session of crate `crate`, last written at T0+`at` seconds; `working` leaves it unfinalized. */
function session(dir:string,crate:string,at:number,id:string,{working=false,bytes='work product'}={}):string{
  const root=join(dir,'incremental',crate),name=`s-${id}-r${id}`,path=join(root,`${name}-${working?'working':'svh'+id}`);
  mkdirSync(path,{recursive:true});writeFileSync(join(path,'query-cache.bin'),bytes);writeFileSync(join(root,name+'.lock'),'');
  utimesSync(path,T0+at,T0+at);
  return path;
}
const crates=(dir:string)=>readdirSync(join(dir,'incremental')).sort();
const pass=(dir:string,options:Partial<RetentionOptions>={})=>retainIncremental(dir,{host,keepBuilds:2,...options});

test('a crate dir goes only once the last kept builds all left it untouched, and a pass that compiled nothing is no build',t=>{
  const dir=profile(t);
  session(dir,'stale-aaaa',10,'a1');session(dir,'kept-bbbb',10,'b1');
  assert.equal(pass(dir).generations,1);
  assert.equal(pass(dir).generations,1,'nothing newer: no new build');
  session(dir,'kept-bbbb',20,'b2');
  assert.equal(pass(dir).generations,2);
  assert.deepEqual(crates(dir),['kept-bbbb','stale-aaaa'],'fewer than keepBuilds+1 builds known: nothing evicted');
  session(dir,'kept-bbbb',30,'b3');
  const third=pass(dir);
  assert.equal(third.generations,3);
  assert.deepEqual(crates(dir),['kept-bbbb'],'untouched by the last two builds: evicted');
  assert.equal(third.removedDirs,1);
  assert.ok(existsSync(join(dir,'deps','libkept-0123.rlib')),'nothing outside incremental/ is touched');
  assert.deepEqual(readRetentionState(dir).marks,[(T0+10)*1000,(T0+20)*1000,(T0+30)*1000]);
});

test('a kept crate dir keeps only its newest finalized session, as rustc would at its next compile',t=>{
  const dir=profile(t),root=join(dir,'incremental','kept-cccc');
  const older=session(dir,'kept-cccc',10,'c1',{bytes:'x'.repeat(8192)}),newest=session(dir,'kept-cccc',20,'c2');
  const crashed=session(dir,'kept-cccc',30,'c3',{working:true});
  // rustc hard-links unchanged work products from the session it copied.
  linkSync(join(newest,'query-cache.bin'),join(older,'shared.o'));utimesSync(older,T0+10,T0+10);
  writeFileSync(join(dir,'incremental','not-a-crate'),'ignored');
  const outcome=pass(dir);
  assert.equal(outcome.removedSessions,2);
  assert.deepEqual(readdirSync(root).sort(),['s-c2-rc2-svhc2','s-c2-rc2.lock']);
  assert.ok(!existsSync(older)&&!existsSync(crashed));
  assert.equal(readFileSync(join(newest,'query-cache.bin'),'utf8'),'work product');
  assert.ok(existsSync(join(dir,'incremental','not-a-crate')));
  assert.deepEqual(incrementalUsage(dir).dirs,1);
});

test('control: a build holding the profile lock skips retention, and it removes nothing',t=>{
  const dir=profile(t);
  session(dir,'old-dddd',10,'d1');session(dir,'old-dddd',20,'d2');
  for(const lock of CARGO_PROFILE_LOCKS){
    const build=GateResource.tryAcquire(join(dir,lock))!;
    try{
      const outcome=pass(dir,{remove:path=>assert.fail('removed '+path+' while a build held '+lock)});
      assert.equal(outcome.state,'skipped');assert.match(outcome.reason!,new RegExp('a build holds .*'+lock.replace('.','\\.')));
      assert.equal(readRetentionState(dir).last?.state,'skipped');
      assert.equal(readRetentionState(dir).marks.length,0,'a skipped pass learns no build');
    }finally{build.close();}
  }
  assert.equal(pass(dir).removedSessions,1);
});

test('control: retention holds every cargo profile lock while it removes',t=>{
  const dir=profile(t);
  session(dir,'old-eeee',10,'e1');session(dir,'old-eeee',20,'e2');
  let removed=0;
  pass(dir,{remove:path=>{
    removed++;
    for(const lock of CARGO_PROFILE_LOCKS)assert.equal(GateResource.tryAcquire(join(dir,lock)),null,`${lock} free while removing ${path}`);
  }});
  assert.equal(removed,1);
  for(const lock of CARGO_PROFILE_LOCKS){const free=GateResource.tryAcquire(join(dir,lock));assert.ok(free,'released after the pass');free.close();}
});

test('control: a session whose rustc lock is held is kept, and so is its crate dir',t=>{
  const dir=profile(t);
  session(dir,'busy-ffff',10,'f1');session(dir,'other-gggg',20,'g1');pass(dir);
  session(dir,'other-gggg',30,'g2');pass(dir);
  const rustc=GateResource.tryAcquire(join(dir,'incremental','busy-ffff','s-f1-rf1.lock'))!;
  try{
    session(dir,'other-gggg',40,'g3');
    const outcome=pass(dir);
    assert.equal(outcome.generations,3);
    assert.ok(existsSync(join(dir,'incremental','busy-ffff','s-f1-rf1-svhf1')),'a held session keeps its stale crate dir');
    assert.equal(outcome.removedDirs,0);
  }finally{rustc.close();}
  session(dir,'other-gggg',50,'g4');
  assert.equal(pass(dir).removedDirs,1);
  assert.deepEqual(crates(dir),['other-gggg']);
});

test('a missing or corrupt state knows no builds and evicts nothing; a newer version is left untouched',t=>{
  const dir=profile(t);
  session(dir,'old-hhhh',10,'h1');
  for(const text of ['{','{"version":1,"marks":[3,2]}','{"marks":[1]}']){
    writeFileSync(join(dir,RETENTION_STATE),text);
    assert.deepEqual(readRetentionState(dir).marks,[]);
    const outcome=pass(dir);
    assert.equal(outcome.generations,1,'only what this pass saw');assert.equal(outcome.removedDirs,0);
  }
  writeFileSync(join(dir,RETENTION_STATE),'{"version":2,"marks":[]}');
  const logs:string[]=[];
  const [outcome]=retainTarget(join(dir,'..'),{host,log:line=>logs.push(line)});
  assert.equal(outcome!.state,'failed');assert.match(outcome!.reason!,/unsupported future state version 2/);
  assert.equal(readFileSync(join(dir,RETENTION_STATE),'utf8'),'{"version":2,"marks":[]}');
  assert.deepEqual(crates(dir),['old-hhhh']);
  assert.match(logs[0]!,/failed: .*the run's verdict stands$/);
});

test('control: retention never throws into its owner: a failed removal is a logged outcome',t=>{
  const dir=profile(t);
  session(dir,'old-iiii',10,'i1');session(dir,'old-iiii',20,'i2');
  const logs:string[]=[];
  const outcomes=retainTarget(join(dir,'..'),{host,log:line=>logs.push(line),remove:()=>{throw Error('fixture disk refused');}});
  assert.deepEqual(outcomes.map(row=>row.state),['failed','absent'],'nts-dev failed; clippy has no incremental directory');
  assert.match(logs[0]!,/nts-dev: failed: fixture disk refused; the run's verdict stands/);
  assert.equal(readRetentionState(dir).last?.state,'failed');
  for(const lock of CARGO_PROFILE_LOCKS){const free=GateResource.tryAcquire(join(dir,lock));assert.ok(free,'locks released after a failure');free.close();}
});

test('the pinned cargo makes the profile locks retention takes, holds them for a build, and waits while retention holds them',async t=>{
  const crate=testScratch(t,'retention-cargo'),env=fixtureEnvironment(t),started=join(crate,'started'),release=join(crate,'release');
  mkdirSync(join(crate,'src'));
  writeFileSync(join(crate,'Cargo.toml'),'[package]\nname="retention-fixture"\nversion="0.0.0"\nedition="2021"\n[profile.nts-dev]\ninherits="dev"\ndebug=0\nincremental=true\n');
  writeFileSync(join(crate,'src/main.rs'),'fn main() {}\n');
  // The build script announces itself and blocks opening a FIFO until the
  // test opens its other end: the build provably runs while retention looks.
  // Without the FIFO (the second build) it returns at once.
  assert.equal(spawnSync('mkfifo',[release]).status,0,'mkfifo');
  writeFileSync(join(crate,'build.rs'),`fn main() {\n  std::fs::write(${JSON.stringify(started)}, "").unwrap();\n  let release = std::path::Path::new(${JSON.stringify(release)});\n  if release.exists() { std::fs::read(release).unwrap(); }\n}\n`);
  const build=()=>{
    const child=spawn(process.execPath,[CARGO_OWNER,'build','--offline','--profile','nts-dev'],{cwd:crate,env:{...env,CARGO_TARGET_DIR:join(crate,'target')},stdio:['ignore','pipe','pipe']});
    let stderr='',exited:number|null|undefined;
    child.stderr.on('data',chunk=>{stderr+=String(chunk);});
    const done=once(child,'close').then(([code])=>{exited=code as number|null;return exited;});
    return {stderr:()=>stderr,exited:()=>exited,done};
  };
  const dir=join(crate,'target','nts-dev');
  const first=build();
  await waitFor('the build script to start',()=>existsSync(started),{stopped:()=>first.exited()!==undefined?`cargo exited: ${first.stderr()}`:undefined});
  const outcome=retainIncremental(dir,{host});
  assert.equal(outcome.state,'skipped',JSON.stringify(outcome));assert.match(outcome.reason!,/a build holds .*\.cargo-lock/);
  writeFileSync(release,'');rmSync(release);
  assert.equal(await first.done,0,first.stderr());
  for(const lock of CARGO_PROFILE_LOCKS)assert.ok(existsSync(join(dir,lock)),`cargo no longer makes ${lock}: re-verify retention's locks for this toolchain`);
  assert.ok(readdirSync(join(dir,'incremental')).length>0);

  const held=profileLocks(dir);
  assert.ok('held' in held,JSON.stringify(held));
  writeFileSync(join(crate,'src/main.rs'),'fn main() { println!("again"); }\n');
  const second=build();
  try{
    await waitFor('cargo to wait on the held profile lock',()=>second.stderr().includes('Blocking waiting for file lock'),{stopped:()=>second.exited()!==undefined?`cargo exited: ${second.stderr()}`:undefined});
    assert.equal(second.exited(),undefined);
  }finally{for(const lock of held.held)lock.close();}
  assert.equal(await second.done,0,second.stderr());
  // A build left it as cargo's: the next pass sees it and keeps what the build used.
  assert.equal(retainIncremental(dir,{host}).state,'retained');
});
