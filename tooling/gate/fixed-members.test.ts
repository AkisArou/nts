import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync,renameSync,writeFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {fixedMembersProbe} from './fixed-members-probe.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {testScratch} from './test-scratch.ts';
import {spawnTest,waitFor} from './test-wait.ts';
import {toolingSliceArgs} from './tooling-slice.ts';
import {declareFixedMembers,fixedMembersUnitCommand} from './test-cgroup-members.ts';
import {ownMemory} from './test-memory.ts';
import {CgroupDeparted,HostObservationError,hostObservations} from './host-observations.ts';
import {generatedJavaScript} from './generated-javascript.ts';
import {GateScopes} from './scopes/step-scope.ts';
import {entryUsage,type LedgerEntry} from './memory-ledger.ts';

test('a named unit declares only its logical entry PID and exec preserves its exit status',t=>{
  const root=testScratch(t,'fixed-unit-entry'),unit='nts-847-members-entry-'+randomUUID();
  const env=fixtureEnvironment(t,ownMemory(join(root,'memory')));
  t.after(()=>{spawnTest('systemctl',['--user','stop',unit],{env,encoding:'utf8'});});
  const code=generatedJavaScript(`import{hostObservations}from ${JSON.stringify(new URL('./host-observations.ts',import.meta.url).href)};console.log(JSON.stringify({pid:process.pid,group:hostObservations({}).ownCgroup()}));process.exitCode=7;`);
  const child=spawnTest('systemd-run',['--user',...toolingSliceArgs(env,'agent'),'--unit='+unit,'--collect','--wait','--pipe','--quiet',
    '-p','Nice=19','-p','CPUWeight=20','-p','LimitCORE=0','-p','CPUAffinity=0-3 6-31','-p','RuntimeMaxSec=120s',
    ...Object.entries(env).filter((row):row is [string,string]=>row[1]!==undefined).map(([name,value])=>'--setenv='+name+'='+value),
    ...fixedMembersUnitCommand([process.execPath,'--input-type=module','-e',code])],{env,encoding:'utf8'});
  assert.equal(child.status,7,child.stdout+child.stderr);
  const result=JSON.parse(child.stdout) as {pid:number;group:string};
  assert.deepEqual(hostObservations(env).cgroupMembers(result.group),[result.pid]);
  assert.throws(()=>hostObservations(env).cgroupMembers('/unlisted'),/resident.members has no cgroup/);
});

test('the default acquired owner needs declared membership and its 100 MiB charge is counted once',t=>{
  const root=testScratch(t,'fixed-default-owner'),unit='nts-847-fixed-owner-'+randomUUID();
  const env=fixtureEnvironment(t);
  t.after(()=>{spawnTest('systemctl',['--user','stop',unit],{encoding:'utf8'});});
  const code=fixedMembersProbe(fileURLToPath(new URL('../..',import.meta.url)),join(root,'observations'));
  const child=spawnTest('systemd-run',['--user',...toolingSliceArgs(env,'agent'),'--unit='+unit,'--collect','--wait','--pipe','--quiet',
    '-p','Nice=19','-p','CPUWeight=20','-p','LimitCORE=0','-p','CPUAffinity=0-3 6-31','-p','RuntimeMaxSec=120s',
    ...Object.entries(env).filter((row):row is [string,string]=>row[1]!==undefined).map(([name,value])=>'--setenv='+name+'='+value),
    process.execPath,'--input-type=module','-e',code],{env,encoding:'utf8'});
  assert.equal(child.status,0,child.stdout+child.stderr);
  const result=JSON.parse(child.stdout) as {missing:{error?:string};declared:number};
  assert.match(result.missing.error??'',/HostObservationError: host observation resident.members has no cgroup/);
  assert.equal(result.declared,100*2**20,'the owner is inside its declared cgroup charge, not charged a second time as an outside tree process');
});

test('concurrent declarations retain all groups and PIDs without overwriting the reading',async t=>{
  const root=testScratch(t,'members-concurrent'),memory=ownMemory(root),env=fixtureEnvironment(t,memory);
  const children=Array.from({length:8},(_,index)=>{
    const code=generatedJavaScript(`import{declareFixedMembers}from ${JSON.stringify(new URL('./test-cgroup-members.ts',import.meta.url).href)};
import{setImmediate}from'node:timers/promises';
await new Promise(resolve=>{process.stdin.once('data',resolve);process.stdout.write('ready\\n');});
for(let n=0;n<20;n++){declareFixedMembers(process.env,'/g'+(${index}%2),[1000000+${index}*20+n]);await setImmediate();}`);
    const child=spawn(process.execPath,['--input-type=module','-e',code],{env,stdio:['pipe','pipe','pipe']});
    let output='',ready=false;child.stdout.on('data',part=>{output+=part;ready=output.includes('ready\n');});child.stderr.on('data',part=>{output+=part;});
    return {child,done:once(child,'close'),ready:()=>ready,output:()=>output};
  });
  t.after(async()=>{for(const {child}of children)if(!child.stdin.writableEnded&&!child.stdin.destroyed)child.stdin.end('go');await Promise.allSettled(children.map(row=>row.done));});
  await waitFor('all declaration writers',()=>children.every(row=>row.ready()),{stopped:()=>children.find(row=>row.child.exitCode!==null)?.output()});
  for(const {child}of children)child.stdin.end('go');
  for(let index=0;index<40;index++){ownMemory(root,{availableKiB:30000000+index});await setImmediate();}
  for(const row of children)assert.deepEqual(await row.done,[0,null],row.output());
  const host=hostObservations(env);
  for(let group=0;group<2;group++){
    const expected=Array.from({length:8},(_,index)=>index).filter(index=>index%2===group).flatMap(index=>Array.from({length:20},(_,n)=>1000000+index*20+n));
    assert.deepEqual(host.cgroupMembers('/g'+group).sort((a,b)=>a-b),expected);
  }
  assert.equal(host.memory().availableBytes,30000039*1024);
});

test('malformed actor records fail by name and only an explicit empty row means empty',t=>{
  const root=testScratch(t,'members-invalid'),env=ownMemory(root),host=hostObservations(env);
  declareFixedMembers(env,'/empty',[]);assert.deepEqual(host.cgroupMembers('/empty'),[]);
  assert.throws(()=>host.cgroupMembers('/missing'),/resident.members has no cgroup/);
  writeFileSync(join(root,'members','malformed.json'),'{"version":1,"group":"/bad","members":[-1]}');
  assert.throws(()=>host.cgroupMembers('/empty'),error=>error instanceof HostObservationError&&error.message.includes('resident.members declaration'));
});

test('an exact creation receipt binds logical actors and closes as departed for new samplers',t=>{
  const root=testScratch(t,'members-receipt'),receipt=join(root,'target/gate-scope-owner.json'),bytes=100*2**20;
  const memory=ownMemory(join(root,'memory'),{memberScopes:[receipt],resident:{kind:'fixed',defaultBytes:bytes}});
  const env=fixtureEnvironment(t,{...memory,NTS_GATE_RUN_DIR:join(root,'run')}),host=hostObservations(env);
  const scopes=new GateScopes(env,{rank:'agent',ownerFile:receipt});t.after(()=>scopes.close());
  const withheld=receipt+'.unpublished';
  renameSync(receipt,withheld);
  try{
    const ref=host.acquireCgroup(scopes.group);
    assert.throws(()=>host.cgroupMembers(ref.path,ref.inode),/resident.members has no cgroup/);
  }
  finally{renameSync(withheld,receipt);}
  const ref=host.acquireCgroup(scopes.group);
  assert.deepEqual(host.cgroupMembers(ref.path,ref.inode),[]);
  declareFixedMembers(env,ref.path+'/logical-step',[process.pid]);
  assert.deepEqual(host.cgroupMembers(ref.path,ref.inode),[process.pid]);
  const entry={owner:{pid:process.pid},measure:{tree:true,cgroup:ref}} as LedgerEntry;
  assert.equal(entryUsage(entry,{env}),bytes,'logical actors inside the charge are not counted twice');
  const child=scopes.step({max:128*2**20}),childRef=host.acquireCgroup(child.group);
  assert.throws(()=>host.cgroupMembers(childRef.path,childRef.inode),/resident.members has no cgroup/);
  assert.throws(()=>host.cgroupMembers(ref.path,'wrong-inode'),error=>error instanceof HostObservationError&&!(error instanceof CgroupDeparted));
  const original=JSON.parse(readFileSync(receipt,'utf8'));
  for(const field of ['device','inode'] as const){
    const other=join(root,'wrong-'+field+'.json');writeFileSync(other,JSON.stringify({...original,scope:{...original.scope,[field]:String(BigInt(original.scope[field])+1n)}}));
    const wrong=hostObservations(ownMemory(join(root,'wrong-'+field),{memberScopes:[other]}));
    assert.throws(()=>wrong.cgroupMembers(ref.path,ref.inode),error=>error instanceof HostObservationError&&!(error instanceof CgroupDeparted));
  }
  scopes.close();
  for(const sampler of [host,hostObservations(env)]){
    assert.throws(()=>sampler.cgroupMembers(ref.path,'wrong-inode'),error=>error instanceof HostObservationError&&!(error instanceof CgroupDeparted));
    assert.throws(()=>sampler.cgroupMembers(ref.path,ref.inode),CgroupDeparted);
    assert.throws(()=>sampler.cgroupCharge(ref.path,ref.inode),CgroupDeparted);
    assert.throws(()=>sampler.cgroupMemoryPeak(ref.path,ref.inode),CgroupDeparted);
  }
});

test('acquisition retains a receipt identity even when its first sample follows close',t=>{
  const root=testScratch(t,'members-acquired-receipt'),receipt=join(root,'target/gate-scope-owner.json');
  const memory=ownMemory(join(root,'memory'),{memberScopes:[receipt]});
  const env=fixtureEnvironment(t,{...memory,NTS_GATE_RUN_DIR:join(root,'run')});
  const scopes=new GateScopes(env,{rank:'agent',ownerFile:receipt});t.after(()=>scopes.close());
  const ref=hostObservations(env).acquireCgroup(scopes.group);
  scopes.close();
  assert.throws(()=>hostObservations(env).cgroupMembers(ref.path,ref.inode),CgroupDeparted);
});


test('future-version and malformed creation receipts refuse every memory observation by name without waiting',{timeout:10_000},t=>{
  const root=testScratch(t,'members-invalid-receipt'),receipt=join(root,'target/gate-scope-owner.json');
  const memory=ownMemory(join(root,'memory'),{memberScopes:[receipt]});
  const env=fixtureEnvironment(t,{...memory,NTS_GATE_RUN_DIR:join(root,'run')});
  const scopes=new GateScopes(env,{rank:'agent',ownerFile:receipt});
  const original=readFileSync(receipt,'utf8');
  try{
    const host=hostObservations(env),ref=host.acquireCgroup(scopes.group);
    for(const [name,text,reason,cause]of [
      ['future version',JSON.stringify({...JSON.parse(original),version:2}),/creation receipt is invalid:.*future state version 2/,'FutureStateVersionError'],
      ['malformed','{',/creation receipt is unreadable:.*SyntaxError/,'SyntaxError'],
    ] as const){
      writeFileSync(receipt,text);
      for(const sampler of [host,hostObservations(env)]){
        for(const [observation,read]of [
          ['members',()=>sampler.cgroupMembers(ref.path,ref.inode)],
          ['charge',()=>sampler.cgroupCharge(ref.path,ref.inode)],
          ['peak',()=>sampler.cgroupMemoryPeak(ref.path,ref.inode)],
        ] as const){
          assert.throws(read,error=>error instanceof HostObservationError&&!(error instanceof CgroupDeparted)
            &&reason.test(error.message)&&error.cause instanceof Error&&error.cause.name===cause,name+' '+observation);
        }
      }
    }
  }finally{writeFileSync(receipt,original);scopes.close();}
});
