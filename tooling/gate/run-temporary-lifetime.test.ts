import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {chmodSync,closeSync,constants,existsSync,lstatSync,mkdirSync,openSync,readFileSync,renameSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureRunTemporary,createRunOracleImage} from './run-temporary.ts';
import {adoptPreparedRunTemporary,closeRunTemporary,ownRunTemporary} from './run-temporary-lifetime.ts';
import {gateEnvironment} from './canonical-environment.ts';
import {hostEnvironment} from './host-environment.ts';
import {contentCacheEnvironment,FIXTURE_ENVIRONMENT} from './cache-environment.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {gateFixtureMemory,writeGateFixtureScript} from './fixed-members-fixture.ts';
import {treeProcessFixture} from '../landing/tree-users-fixture.ts';
import {hostObservations} from './host-observations.ts';
import {ownMemory} from './test-memory.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {systemdEnvironment} from './environment.ts';
import {durableRecord} from './durable-record.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {testScratch} from './test-scratch.ts';
import {spawnTest,waitFor} from './test-wait.ts';

function fixture(t:Parameters<typeof testScratch>[0]){
  const home=testScratch(t,'temporary-lifetime'),run=join(home,'.cache/runs/test');
  const temporary=captureRunTemporary(run,undefined,home),s=lstatSync(run),token=temporary.creation!.token,file=join(run,'temporary-owner-'+token+'.json');
  const r={version:1,token,run,temporary,parent:{path:run,dev:s.dev,ino:s.ino,uid:s.uid},owner:'00000000-0000-0000-0000-000000000000 1 1',unit:'fixture.service',invocation:'a'.repeat(32),backstop:`nts-tmp${token.replaceAll('-','')}.service`};
  writeFileSync(join(temporary.path,'.nts-run-token'),token);durableRecord(file,r);
  const env=fixtureEnvironment(t,ownMemory(join(home,'observations'),{allocated:{kind:'fixed',defaultBytes:8192}})),host=hostObservations(env),log:string[]=[];
  const close=(green=false,options:Parameters<typeof closeRunTemporary>[5]={})=>closeRunTemporary(file,token,home,green,host,{log:line=>log.push(line),...options});
  return {home,run,temporary,token,file,r,env,host,log,close};
}
test('explicit adoption binds the whole prepared root by identity regardless of its contents',t=>{
  for(const setup of [false,true]){
    const home=testScratch(t,'prepared-temporary'),run=join(home,'.cache/run'),path=join(run,'tmp');
    mkdirSync(path,{recursive:true});if(setup){
      mkdirSync(join(path,'oracle-resolution'));writeFileSync(join(path,'oracle-resolution/setup'),'resolved');
      writeFileSync(join(path,'compiler-scratch'),'compiler');symlinkSync(home,join(path,'setup-alias'));
    }
    const prior=captureRunTemporary(run,undefined,home);assert.equal(prior.creation,undefined);
    const adopted=adoptPreparedRunTemporary(prior,run,home),parent=lstatSync(run);
    assert.equal(adopted.dev,prior.dev);assert.equal(adopted.ino,prior.ino);
    assert.equal(adopted.creation!.parentDev,parent.dev);assert.equal(adopted.creation!.parentIno,parent.ino);
    assert.match(adopted.creation!.token,/^[a-f0-9-]{36}$/);
    if(setup)assert.equal(readFileSync(join(path,'compiler-scratch'),'utf8'),'compiler');
  }
});
test('prepared adoption refuses root aliases, foreign uid identities, wrong parents and existing receipts by name',t=>{
  for(const change of ['alias','foreign-uid','wrong-parent','wrong-run','replaced','receipt'] as const){
    const home=testScratch(t,'invalid-prepared-temporary'),run=join(home,'.cache/run'),path=join(run,'tmp');
    mkdirSync(path,{recursive:true});const prior=captureRunTemporary(run,undefined,home);
    const receipt=join(run,'temporary-owner-'+randomUUID()+'.json');
    if(change==='alias'||change==='replaced'){renameSync(path,path+'-original');if(change==='alias')symlinkSync(path+'-original',path);else mkdirSync(path);}
    if(change==='receipt')writeFileSync(receipt,'existing authority');
    const handed=change==='foreign-uid'?{...prior,uid:prior.uid+1}:change==='wrong-parent'?{...prior,parent:home}:prior;
    const expected={
      alias:'run temporary directory was replaced: '+path,
      'foreign-uid':'run temporary directory was replaced: '+path,
      'wrong-parent':'run temporary directory was replaced: '+path,
      'wrong-run':'prepared run temporary path differs from its run: '+path,
      replaced:'run temporary directory was replaced: '+path,
      receipt:'prepared run temporary already has a lifetime receipt: '+receipt,
    }[change];
    assert.throws(()=>adoptPreparedRunTemporary(handed,change==='wrong-run'?run+'-other':run,home),{message:expected});
    assert.equal(existsSync(path),true);
    if(change==='receipt')assert.equal(readFileSync(receipt,'utf8'),'existing authority');
  }
});
test('a candidate runner adopts the current service prepared tmp, runs a step and closes its lifetime',t=>{
  const scope=testScratch(t,'queued-temporary'),base=fixtureEnvironment(t);
  const caches={...contentCacheEnvironment(base),[FIXTURE_ENVIRONMENT]:base[FIXTURE_ENVIRONMENT]};
  // Always exercise a nested test harness, including in the focused route.
  // The old service's launcher carries host tools and owned grants, without
  // inheriting the harness's run, dependency image or execution policy.
  const parent=gateEnvironment({...base,HOME:scope},{run:join(scope,'.cache/harness'),owned:{...caches,...ownMemory(join(scope,'harness-observations'))}});
  const home=join(parent.temporary.path,'creator'),root=join(home,'repo'),gate=join(root,'tooling/gate'),run=join(home,'.cache/runs/queued');
  mkdirSync(home,{recursive:true});
  copyModuleClosure(['tooling/gate/run.mjs'],root);
  const source=fileURLToPath(new URL('./',import.meta.url));
  const listed=spawnTest('sh',[join(source,'all.sh'),'--list'],{encoding:'utf8'});assert.equal(listed.status,0,listed.stderr);
  writeGateFixtureScript(join(gate,'all.sh'),`#!/bin/sh\nif [ "$1" = --list ]; then\ncat <<'NAMES'\n${listed.stdout.trim()}\nNAMES\nelse\n  printf ran > "$NTS_GATE_RUN_DIR/step-ran"\n  printf '%s' "$NTS_GATE_ENV_CONTEXT" > "$NTS_GATE_RUN_DIR/observed-context.json"\nfi\n`);
  // Main's pre-lifetime creator makes tmp before candidate environment setup.
  // Keep that actual on-disk preparation: no creation record or lifetime token.
  mkdirSync(join(run,'tmp'),{recursive:true});
  mkdirSync(join(run,'tmp/oracle-resolution'),{mode:0o700});writeFileSync(join(run,'tmp/oracle-resolution/setup'),'setup');
  writeFileSync(join(run,'tmp/compiler-scratch'),'compiler');
  const sentinel=join(home,'outside-sentinel');writeFileSync(sentinel,'keep');symlinkSync(sentinel,join(run,'tmp/setup-alias'));
  const launcher:NodeJS.ProcessEnv={...hostEnvironment(parent.env),...caches,HOME:home};
  assert.equal(launcher.NTS_GATE_ENV_CONTEXT,undefined);
  const planned=gateEnvironment(launcher,{run,owned:{...caches,NTS_GATE_STEPS:'rustfmt',CARGO_TARGET_DIR:join(root,'target'),...gateFixtureMemory(join(home,'observations'),root)}});
  assert.equal(planned.temporary.creation,undefined);
  assert.deepEqual(Object.keys(JSON.parse(planned.env.NTS_GATE_ENV_CONTEXT!).temporary).sort(),['dev','ino','parent','path','uid']);
  durableRecord(join(home,'environment.json'),planned.env);
  const unit=`nts-841-prepared-${randomUUID()}.service`;
  t.after(()=>{spawnTest('systemctl',['--user','stop',unit],{encoding:'utf8'});});
  const actual=spawnTest('systemd-run',['--user','--collect','--wait','--pipe',`--unit=${unit}`,'-p','Nice=19','-p','CPUWeight=20','-p','LimitCORE=0','-p','RuntimeMaxSec=240',...systemdEnvironment(),
    'taskset','-c','0-3,6-31',process.execPath,fileURLToPath(new URL('./run-temporary-lifetime-fixture.ts',import.meta.url)),home,'prepared-runner',join(home,'unused-ready')],{encoding:'utf8'});
  assert.equal(actual.status,0,actual.stdout+actual.stderr);assert.equal(readFileSync(join(run,'step-ran'),'utf8'),'ran');
  const summary=JSON.parse(readFileSync(join(run,'summary.json'),'utf8'));
  assert.equal(summary.verdict,'green');assert.equal(summary.steps[0].verdict,'PASS');assert.equal(summary.temporary.state,'removed after green');
  assert.equal(existsSync(join(run,'tmp')),false);assert.match(readFileSync(join(run,'temporary.log'),'utf8'),/adopted pre-lifetime launcher temporary/);
  assert.equal(readFileSync(sentinel,'utf8'),'keep','disposal never follows an adopted entry link');
  const observed=JSON.parse(readFileSync(join(run,'observed-context.json'),'utf8'));
  assert.ok(observed.temporary.creation,'steps receive the adopted lifetime authority');
  const receipt=JSON.parse(readFileSync(join(run,'temporary-owner-'+observed.temporary.creation.token+'.json'),'utf8'));
  assert.ok(receipt.closed);assert.deepEqual(receipt.temporary.creation,observed.temporary.creation);
});
test('a drained green removes tmp and logs run id and allocated bytes once',t=>{
  const f=fixture(t);writeFileSync(join(f.temporary.path,'input.ts'),'input');
  const result=f.close(true);assert.equal(result.state,'removed after green');assert.equal(result.bytes,8192);assert.equal(existsSync(f.temporary.path),false);
  assert.deepEqual(f.close(true),result);assert.equal(f.log.filter(line=>line.startsWith('gate tmp: removed ')).length,1);
  assert.match(f.log.at(-1)!,new RegExp('run='+f.run+' .*bytes='+result.bytes));
});
for(const green of [true,false])test(`mode-000 diagnostics cannot block ${green?'green':'red'} disposal`,t=>{
  const f=fixture(t),directory=join(f.temporary.path,'unreadable'),file=join(f.temporary.path,'stderr.txt');
  mkdirSync(directory);writeFileSync(join(directory,'input.ts'),'inaccessible');chmodSync(directory,0);
  writeFileSync(file,'inaccessible stderr');chmodSync(file,0);
  let measured=false;
  const host={...f.host,allocatedBytes:(path:string)=>{
    assert.equal(path,f.temporary.path);assert.equal(lstatSync(directory).mode&0o700,0o700,'normalize before measuring');
    measured=true;return f.host.allocatedBytes(path);
  }};
  const result=closeRunTemporary(f.file,f.token,f.home,green,host,{log:line=>f.log.push(line)});
  assert.equal(measured,true);assert.equal(result.bytes,8192);assert.equal(existsSync(f.temporary.path),false);
  if(!green){
    const manifest=JSON.parse(readFileSync(join(result.diagnostics!.path,'manifest.json'),'utf8'));
    assert.equal(manifest.skipped.length,2);assert.ok(f.log.some(line=>line.includes('diagnostic skipped:')&&line.includes('EACCES')));
  }
});
test('a red step reference resolves after close ahead of unreferenced scratch at the file cap',t=>{
  const f=fixture(t),filler=join(f.temporary.path,'conformance262'),artifact=join(f.temporary.path,'nts-blockers owned');
  mkdirSync(filler);for(let i=0;i<4096;i++)writeFileSync(join(filler,String(i)),'scratch');
  mkdirSync(artifact);writeFileSync(join(artifact,'child.stderr'),'failing child');
  writeFileSync(join(f.run,'blockers.log'),'padding'.repeat(9361)+`\n  kept ${artifact}\n  full result at ${artifact}/child.stderr\n`);
  const result=f.close(),manifest=JSON.parse(readFileSync(join(result.diagnostics!.path,'manifest.json'),'utf8'));
  const reference=manifest.references.find((row:{original:string})=>row.original===artifact);
  assert.equal(reference.state,'retained');assert.deepEqual(reference.logs,['blockers.log']);
  assert.equal(readFileSync(join(reference.retained,'child.stderr'),'utf8'),'failing child');
  assert.equal(result.diagnostics!.files,4096);assert.equal(result.diagnostics!.capped,true);
  assert.match(readFileSync(join(f.run,'blockers.log'),'utf8'),/kept /,'original log evidence remains intact');
  assert.ok(f.log.some(line=>line.includes('diagnostic references:')&&line.includes('manifest.json')));
});
test('a red retains bounded diagnostic paths and excludes dependency images and links',t=>{
  const f=fixture(t),root=f.temporary.path;
  for(const name of ['input.ts','stderr.txt','reproducer.c','core.fixture'])writeFileSync(join(root,name),name);
  mkdirSync(join(root,'oracle-dependencies'));const image=createRunOracleImage(f.temporary,f.home,join(root,'oracle-dependencies/tree'));
  writeFileSync(join(image,'payload'),'large rebuildable input');writeFileSync(join(root,'oracle-dependencies/stderr'),'capture failure');
  symlinkSync('/etc/passwd',join(root,'outside'));
  const result=f.close(),kept=result.diagnostics!;
  assert.equal(existsSync(root),false);assert.equal(kept.files,5);assert.equal(kept.capped,false);
  for(const name of ['input.ts','stderr.txt','reproducer.c','core.fixture'])assert.equal(readFileSync(join(kept.path,'files',name),'utf8'),name);
  assert.equal(existsSync(join(kept.path,'files/outside')),false);assert.equal(existsSync(join(kept.path,'files/oracle-dependencies/tree')),false);
  assert.equal(readFileSync(join(kept.path,'files/oracle-dependencies/stderr'),'utf8'),'capture failure');
  assert.equal(JSON.parse(readFileSync(join(kept.path,'manifest.json'),'utf8')).original_root,root);
});
test('one diagnostic filesystem barrier precedes the manifest, receipt and publication',t=>{
  const f=fixture(t);mkdirSync(join(f.temporary.path,'nested'));
  writeFileSync(join(f.temporary.path,'nested/input.ts'),'failing input');
  writeFileSync(join(f.temporary.path,'stderr.txt'),'complete stderr');
  let barriers=0,prepared=false;
  const kept=f.close(false,{probe:request=>{
    barriers++;
    assert.equal(request.command,'sync');assert.deepEqual(request.args.slice(0,2),['-f','--']);
    assert.equal(request.args.length,3);const stage=request.args[2]!;
    assert.equal(readFileSync(join(stage,'files/nested/input.ts'),'utf8'),'failing input');
    assert.equal(readFileSync(join(stage,'files/stderr.txt'),'utf8'),'complete stderr');
    assert.equal(existsSync(join(stage,'manifest.json')),false);
    assert.equal(JSON.parse(readFileSync(f.file,'utf8')).diagnostics,undefined);
    return infrastructureProbe(request);
  },checkpoint:(phase,directory)=>{
    if(phase!=='prepared')return;
    prepared=true;assert.equal(barriers,1);
    assert.equal(JSON.parse(readFileSync(f.file,'utf8')).diagnostics.stage,directory);
    assert.equal(JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8')).files,2);
  }}).diagnostics!;
  assert.equal(barriers,1);assert.equal(prepared,true);assert.equal(kept.files,2);
  assert.equal(readFileSync(join(kept.path,'files/nested/input.ts'),'utf8'),'failing input');
  assert.equal(existsSync(f.temporary.path),false);
});
test('a failed diagnostic filesystem barrier preserves the original tmp for retry',t=>{
  const f=fixture(t);writeFileSync(join(f.temporary.path,'stderr.txt'),'original stderr');
  let stage='';
  assert.throws(()=>f.close(false,{probe:request=>{
    stage=request.args[2]!;throw Error('fixture diagnostic flush failed');
  }}),/fixture diagnostic flush failed/);
  assert.equal(readFileSync(join(f.temporary.path,'stderr.txt'),'utf8'),'original stderr');
  assert.equal(readFileSync(join(stage,'files/stderr.txt'),'utf8'),'original stderr');
  assert.equal(existsSync(join(stage,'manifest.json')),false);
  assert.equal(JSON.parse(readFileSync(f.file,'utf8')).diagnostics,undefined);
  assert.equal(existsSync(join(f.run,'diagnostics-'+f.token)),false);assert.deepEqual(f.log,[]);
  const kept=f.close().diagnostics!;
  assert.equal(readFileSync(join(kept.path,'files/stderr.txt'),'utf8'),'original stderr');
  assert.equal(kept.files,1);assert.equal(existsSync(f.temporary.path),false);
});
test('the diagnostic byte and file caps are explicit and logged',t=>{
  for(const options of [{capBytes:3,capFiles:10},{capBytes:100,capFiles:1}]){
    const f=fixture(t);writeFileSync(join(f.temporary.path,'a.txt'),'one');writeFileSync(join(f.temporary.path,'b.txt'),'two');
    const result=f.close(false,options),d=result.diagnostics!;
    assert.equal(d.capped,true);assert.ok(d.bytes<=options.capBytes);assert.ok(d.files<=options.capFiles);assert.ok(f.log.some(line=>line.includes('diagnostic cap hit')));
    assert.equal(existsSync(f.temporary.path),false);
  }
});
test('diagnostic retention preserves non-UTF8 names as filesystem bytes',t=>{
  const f=fixture(t),name=Buffer.from([0x61,0xff]),source=Buffer.concat([Buffer.from(f.temporary.path+'/'),name]);
  writeFileSync(source,'diagnostic');const kept=f.close().diagnostics!;
  assert.equal(readFileSync(Buffer.concat([Buffer.from(kept.path+'/files/'),name]),'utf8'),'diagnostic');assert.equal(existsSync(f.temporary.path),false);
});
test('a retained manifest.json cannot collide with retention metadata',t=>{
  const f=fixture(t);writeFileSync(join(f.temporary.path,'manifest.json'),'original diagnostic');
  const kept=f.close().diagnostics!;
  assert.equal(readFileSync(join(kept.path,'files/manifest.json'),'utf8'),'original diagnostic');
  assert.equal(JSON.parse(readFileSync(join(kept.path,'manifest.json'),'utf8')).original_root,f.temporary.path);
});
test('interrupted diagnostic publication resumes without retaining tmp',t=>{
  for(const cut of ['copying','prepared','published'] as const){
    const f=fixture(t);writeFileSync(join(f.temporary.path,'stderr.txt'),'complete diagnostic');
    assert.throws(()=>f.close(false,{checkpoint:(phase,directory)=>{
      if(phase!==cut)return;
      if(phase==='copying')writeFileSync(join(directory,'files/stderr.txt'),'partial');
      throw Error('interrupted diagnostic publication');
    }}),/interrupted diagnostic publication/);
    assert.equal(readFileSync(join(f.temporary.path,'stderr.txt'),'utf8'),'complete diagnostic');
    const kept=f.close().diagnostics!;
    assert.equal(readFileSync(join(kept.path,'files/stderr.txt'),'utf8'),'complete diagnostic');
    assert.equal(kept.files,1);assert.equal(existsSync(f.temporary.path),false);
  }
});
test('replaced or future diagnostic publications keep the original tmp',t=>{
  for(const change of ['staged','published','future'] as const){
    const f=fixture(t);writeFileSync(join(f.temporary.path,'stderr.txt'),'original');
    assert.throws(()=>f.close(false,{checkpoint:(phase)=>{if(phase===(change==='published'?'published':'prepared'))throw Error('interrupt');}}),/interrupt/);
    const receipt=JSON.parse(readFileSync(f.file,'utf8'));
    if(change==='future'){receipt.diagnostics.version=999;durableRecord(f.file,receipt);}
    else{const path=change==='staged'?receipt.diagnostics.stage:receipt.diagnostics.result.path;renameSync(path,path+'-original');mkdirSync(path);}
    assert.throws(()=>f.close(),/publication|version|ENOENT/);
    assert.equal(readFileSync(join(f.temporary.path,'stderr.txt'),'utf8'),'original');assert.equal(f.log.length,0);
  }
});
test('tmp, parent, token, alias and future receipt mismatches remove nothing',t=>{
  for(const change of ['tmp','parent','token','alias','future','creation','closed'] as const){
    const f=fixture(t);writeFileSync(join(f.temporary.path,'keep'),'untouched');
    if(change==='tmp'){renameSync(f.temporary.path,f.temporary.path+'-original');mkdirSync(f.temporary.path);}
    if(change==='parent'){f.r.parent.ino++;durableRecord(f.file,f.r);}
    if(change==='token')writeFileSync(join(f.temporary.path,'.nts-run-token'),'wrong');
    if(change==='alias'){renameSync(f.temporary.path,f.temporary.path+'-original');symlinkSync(f.temporary.path+'-original',f.temporary.path);}
    if(change==='future')durableRecord(f.file,{...f.r,version:999});
    if(change==='creation')durableRecord(f.file,{...f.r,temporary:{...f.temporary,creation:{...f.temporary.creation!,token:randomUUID()}}});
    if(change==='closed')durableRecord(f.file,{...f.r,closed:null});
    assert.throws(()=>f.close(),/identity|replaced|token|version/);assert.equal(existsSync(f.temporary.path),true);assert.equal(f.log.length,0);
  }
});
test('a live unit holder and a substituted backstop cannot authorize removal',t=>{
  const f=fixture(t);
  assert.throws(()=>f.close(false,{units:[{unit:'holder.service',workingDirectory:f.temporary.path,rootDirectory:'',commands:[]}]}),/owns/);
  assert.throws(()=>f.close(false,{backstop:true}),/unit mismatch/);assert.equal(existsSync(f.temporary.path),true);
  mkdirSync(join(f.run,'peer'));writeFileSync(join(f.run,'peer/keep'),'untouched');
  assert.throws(()=>closeRunTemporary(f.file,randomUUID(),f.home,false,f.host,{units:[]}),/token/);
  assert.equal(readFileSync(join(f.run,'peer/keep'),'utf8'),'untouched');
});
test('a holder appearing during byte measurement still refuses removal',t=>{
  const f=fixture(t);let appeared=false;
  const host={...f.host,allocatedBytes:()=>{appeared=true;return 8192;},unitUsers:()=>appeared?
    {kind:'fixed' as const,units:[{unit:'late-holder.service',workingDirectory:f.temporary.path,rootDirectory:'',commands:[]}]}:f.host.unitUsers()};
  assert.throws(()=>closeRunTemporary(f.file,f.token,f.home,true,host,{log:line=>f.log.push(line)}),/late-holder.service owns/);
  assert.equal(existsSync(f.temporary.path),true);assert.deepEqual(f.log,[]);
});
test('the closer consumes its owned unit observation and refuses a missing view',t=>{
  const f=fixture(t);
  ownMemory(join(f.home,'observations'),{unitUsers:{kind:'fixed',units:[{unit:'owned.service',workingDirectory:f.temporary.path,rootDirectory:'',commands:[]}]}});
  assert.throws(()=>f.close(),/owned.service owns/);assert.equal(existsSync(f.temporary.path),true);
  const packet=JSON.parse(readFileSync(f.env.NTS_HOST_OBSERVATIONS!,'utf8'));delete packet.unitUsers;durableRecord(f.env.NTS_HOST_OBSERVATIONS!,packet);
  assert.throws(()=>f.close(),/host observation unitUsers/);assert.equal(existsSync(f.temporary.path),true);
  ownMemory(join(f.home,'observations'),{unitUsers:{kind:'fixed',units:[]}});
  f.close(true);assert.equal(existsSync(f.temporary.path),false);
});
test('malformed process birth cannot authorize cleanup',t=>{
  for(const owner of ['', 'boot 1 1', '00000000-0000-0000-0000-000000000000 0 1',
    '00000000-0000-0000-0000-000000000000 9007199254740992 1', '00000000-0000-0000-0000-000000000000 1 0']){
    const f=fixture(t);durableRecord(f.file,{...f.r,owner});
    assert.throws(()=>f.close(),/identity|birth|owner/);assert.equal(existsSync(f.temporary.path),true);assert.deepEqual(f.log,[]);
  }
});
test('live process users and unregistered historical scratch remain untouched',t=>{
  const f=fixture(t),processes=treeProcessFixture(t);
  symlinkSync(join(f.temporary.path,'input.ts'),join(processes.task,'fd/3'));
  const memory=ownMemory(join(f.home,'held-observations'),{processUsers:{kind:'proc',root:processes.proc}});
  assert.throws(()=>closeRunTemporary(f.file,f.token,f.home,false,hostObservations(memory),{units:[]}),/process 42 owns fd/);
  const oldRun=join(f.home,'.cache/historical');mkdirSync(join(oldRun,'tmp'),{recursive:true});writeFileSync(join(oldRun,'tmp/keep'),'old bytes');
  const old=captureRunTemporary(oldRun,undefined,f.home);
  assert.throws(()=>ownRunTemporary(old,f.env,f.host),/not created for this lifetime/);
  assert.equal(readFileSync(join(old.path,'keep'),'utf8'),'old bytes');
});
for(const mode of ['green','red','signal','forced','force-copy'] as const)test(`the real unit's ${mode} exit removes tmp and preserves red diagnostics`,async t=>{
  // Kernel wiring control: the allocated-byte view is explicitly live, while
  // holders and every admission observation still belong to this fixture.
  const home=testScratch(t,'temporary-unit'),env=fixtureEnvironment(t,ownMemory(join(home,'observations'),{allocated:{kind:'live'}})),ready=join(home,'ready.json');
  durableRecord(join(home,'environment.json'),env);
  if(mode==='force-copy'){
    assert.equal(spawnTest('mkfifo',[join(home,'pause')],{env,encoding:'utf8'}).status,0);
    const pause=openSync(join(home,'pause'),constants.O_RDWR|constants.O_NONBLOCK);t.after(()=>closeSync(pause));
  }
  const unit=`nts-841-tmp-${randomUUID()}.service`;
  t.after(()=>{spawnTest('systemctl',['--user','stop',unit],{encoding:'utf8',env});});
  const start=spawnTest('systemd-run',['--user','--collect',`--unit=${unit}`,'-p','Nice=19','-p','CPUWeight=20','-p','LimitCORE=0','-p','RuntimeMaxSec=240',
    ...(['forced','force-copy'].includes(mode)?['-p','KillSignal=SIGKILL']:[]),...systemdEnvironment(env),process.execPath,
    fileURLToPath(new URL('./run-temporary-lifetime-fixture.ts',import.meta.url)),home,mode,ready],{encoding:'utf8',env});
  assert.equal(start.status,0,start.stderr);
  await waitFor('temporary owner readiness',()=>existsSync(ready));
  const row=JSON.parse(readFileSync(ready,'utf8')) as {run:string;receipt:string};
  if(['signal','forced','force-copy'].includes(mode)){
    const backstop=JSON.parse(readFileSync(row.receipt,'utf8')).backstop as string;
    const armed=spawnTest('systemctl',['--user','show',backstop,'--property=ActiveState','--value'],{encoding:'utf8',env});
    assert.equal(armed.stdout.trim(),'active','the cleanup unit must finish activation before payload readiness');
    const stopped=spawnTest('systemctl',['--user','stop',unit],{encoding:'utf8',env});assert.equal(stopped.status,0,stopped.stderr);
  }
  await waitFor('authenticated temporary disposal',()=>Boolean(JSON.parse(readFileSync(row.receipt,'utf8')).closed));
  const backstop=JSON.parse(readFileSync(row.receipt,'utf8')).backstop as string;
  for(const name of [unit,backstop])await waitFor('unit completion '+name,()=>{const state=spawnTest('systemctl',['--user','show',name,'--property=ActiveState','--value'],{encoding:'utf8',env});return /^(inactive|failed)\s*$/.test(state.stdout);});
  const closed=JSON.parse(readFileSync(row.receipt,'utf8')).closed;
  assert.equal(existsSync(join(row.run,'tmp')),false);assert.ok(closed.bytes>0);
  if(mode==='green')assert.equal(closed.diagnostics,undefined);
  else {
    assert.equal(readFileSync(join(closed.diagnostics.path,'files/stderr.txt'),'utf8'),'controlled stderr');
    assert.ok(readFileSync(join(row.run,'temporary.log'),'utf8').includes('diagnostic skipped:'),'mode-000 directory was logged and disposal continued');
  }
});
