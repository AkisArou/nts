import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertProcessGroupIdentity,assertObservedGroupEmpty,processStat,readProcessStats,readProcessStat,type ProcessGroupObservations} from './process-group.ts';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ownMemory} from './test-memory.ts';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {testScratch} from './test-scratch.ts';
import {processActivity} from './active-process.ts';
import {fixtureEnvironment} from './test-environment.ts';

test('a spawn-owned group keeps its birth identity and tolerates its exited leader',()=>{
  const birth={group:71,session:71,started:190};
  assert.doesNotThrow(()=>assertProcessGroupIdentity(71,birth,{...birth}));
  assert.doesNotThrow(()=>assertProcessGroupIdentity(71,birth,undefined));
});

test('a reused PID, a changed group and a changed session independently refuse signalling',()=>{
  const birth={group:71,session:71,started:190};
  for(const current of [{...birth,started:191},{...birth,group:72},{...birth,session:72}])
    assert.throws(()=>assertProcessGroupIdentity(71,birth,current),/refusing to stop a changed command group/);
});

test('a failed boot observation remains inside acquisition cleanup and joins its own spawned child',async t=>{
  const stage=testScratch(t,'group-boot-failure');copyModuleClosure(['tooling/gate/process-group.ts'],stage);
  const file=join(stage,'tooling/gate/process-group.ts'),source=readFileSync(file,'utf8');
  const anchor=source.split('\n').find(line=>line.startsWith('const bootIdentity='));assert.ok(anchor);
  assert.equal(source.split(anchor).length,2);
  writeFileSync(file,source.replace(anchor,"const bootIdentity=()=>{throw Error('controlled boot observation failure');};"));
  const {ownedProcessGroup}:typeof import('./process-group.ts')=await import(pathToFileURL(file).href);
  const child=spawn(process.execPath,['--input-type=module','-e',`import {watch} from 'node:fs';watch(${JSON.stringify(stage)},()=>{});`],{detached:true,env:fixtureEnvironment(t),stdio:'ignore'});
  const closed=once(child,'close'),kill=child.kill.bind(child),signals:(NodeJS.Signals|number|undefined)[]=[];
  child.kill=signal=>{signals.push(signal);return kill(signal);};
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)kill('SIGKILL');await closed;});
  assert.throws(()=>ownedProcessGroup(child),/controlled boot observation failure/);
  assert.deepEqual(signals,['SIGKILL'],'the acquisition owner must clean its own child before throwing');
  assert.deepEqual(await closed,[null,'SIGKILL']);
});

const boot='11111111-1111-1111-1111-111111111111';
const birth={version:1,pid:71,started:190,boot};
function stat(pid:number,{group=71,session=71,started=190,state='S'}={}){
  const fields=Array<string>(20).fill('0');fields[0]=state;
  for(const [at,value] of [[1,1],[2,group],[3,session],[11,5],[12,7],[13,11],[14,13],[19,started]])fields[at!]=String(value);
  return `${pid} (a name with ) in it) ${fields.join(' ')}`;
}
function supplied(rows:ReadonlyMap<number,readonly (string|Error)[]>){
  const reads:number[]=[],counts=new Map<number,number>();
  const observations:ProcessGroupObservations={boot:()=>boot,pids:()=>rows.keys(),stat:pid=>{
    reads.push(pid);const at=counts.get(pid)??0;counts.set(pid,at+1);
    const values=rows.get(pid);assert.ok(values,'unexpected pid '+pid);
    const value=values[Math.min(at,values.length-1)];assert.notEqual(value,undefined);
    if(value instanceof Error)throw value;return value!;
  }};
  return {observations,reads};
}
const absent=(code='ENOENT')=>Object.assign(Error('controlled absent stat'),{code});

for(const short of ['', '72 (exiting) R', 'no comm delimiter'])for(const code of ['ENOENT','ESRCH']){
  test(`a malformed exit stat is rechecked after the scan and skipped only when gone: ${JSON.stringify(short)} ${code}`,()=>{
    const f=supplied(new Map([[72,[short,absent(code)]],[73,[stat(73,{group:81})]]]));
    assert.doesNotThrow(()=>assertObservedGroupEmpty(birth,f.observations));
    assert.deepEqual(f.reads,[72,73,72]);
    const single=supplied(new Map([[72,[short,absent(code)]]]));
    assert.equal(readProcessStat(72,single.observations.stat),undefined);assert.deepEqual(single.reads,[72,72]);
  });
}

test('persistent malformed live records fail with pid and both raw observations',()=>{
  const first=stat(72).replace(' 5 7 ',' bad 7 '),second=stat(72).replace(' 5 7 ',' worse 7 ');
  assert.notEqual(first,stat(72));
  for(const pair of [[first,second],['',''],['72 (short) R','72 (still short) R']]){
    const f=supplied(new Map([[72,pair],[73,[stat(73,{group:81})]]]));
    assert.throws(()=>assertObservedGroupEmpty(birth,f.observations),error=>{
      assert.ok(error instanceof Error);assert.match(error.message,/invalid process 72 stat after recheck/);
      for(const raw of pair)assert.ok(error.message.includes(JSON.stringify(raw)));return true;
    });
    assert.deepEqual(f.reads,[72,73,72]);
  }
});

for(const first of [undefined,'',stat(72).replace(' 5 7 ',' bad 7 ')]){
  test(`a usable live group member still blocks drain after ${first===undefined?'one read':'a malformed read'}`,()=>{
    const f=supplied(new Map([[72,first===undefined?[stat(72)]:[first,stat(72)]]]));
    assert.throws(()=>assertObservedGroupEmpty(birth,f.observations),/owned command group 71 has not drained: live member 72/);
    assert.deepEqual(f.reads,first===undefined?[72]:[72,72]);
  });
}

test('a recovered reused pid is assessed with its new group and start',()=>{
  for(const group of [71,81]){
    const f=supplied(new Map([[72,[stat(72).replace(' 5 7 ',' bad 7 '),stat(72,{group,started:191})]]]));
    if(group===71)assert.throws(()=>assertObservedGroupEmpty(birth,f.observations),/live member 72/);
    else assert.doesNotThrow(()=>assertObservedGroupEmpty(birth,f.observations));
    assert.deepEqual(f.reads,[72,72]);
  }
});

test('drain excludes dead, unrelated, older and other-boot processes',()=>{
  const f=supplied(new Map([[72,[stat(72,{state:'Z'})]],[73,[stat(73,{state:'X'})]],[74,[stat(74,{session:81})]],[75,[stat(75,{started:189})]]]));
  assert.doesNotThrow(()=>assertObservedGroupEmpty(birth,f.observations));
  assert.deepEqual(f.reads,[72,73,74,75]);
  assert.doesNotThrow(()=>assertObservedGroupEmpty({...birth,boot:'22222222-2222-2222-2222-222222222222'},{boot:()=>boot,pids:()=>{throw Error('must not scan');},stat:()=>{throw Error('must not read');}}));
});

test('unexpected stat read failures are named and never certify idle',()=>{
  for(const rows of [[Object.assign(Error('denied'),{code:'EACCES'})],['',Object.assign(Error('denied'),{code:'EPERM'})]]){
    const f=supplied(new Map([[72,rows]]));
    assert.throws(()=>assertObservedGroupEmpty(birth,f.observations),/cannot read process 72 stat.*denied/);
  }
});

test('the shared parser preserves activity shape and owned-process failures',()=>{
  const text=stat(72,{state:'R'}),{live,...activity}=processStat(text);
  assert.equal(live,true);assert.deepEqual(processActivity(text),activity);
  assert.deepEqual(activity,{parent:1,group:71,session:71,cpu:36,own:12,started:190,busy:true});
  for(const malformed of ['',stat(72).replace(' 190',' 1e3'),stat(72).replace(' S ',' ? ')]){
    assert.throws(()=>processStat(malformed),/invalid process activity/);
    assert.throws(()=>processActivity(malformed),/invalid process activity/);
  }
  const f=supplied(new Map([[72,['','']],[73,[stat(73)]]])),errors:number[]=[];
  const records=readProcessStats(f.observations.pids(),f.observations.stat,(pid,error)=>{errors.push(pid);assert.match(error.message,/invalid process 72/);});
  assert.deepEqual(errors,[72]);assert.deepEqual([...records.keys()],[73]);
});

test('lock and gate-root owners cannot reclaim a persistently malformed live pid',async t=>{
  const stage=testScratch(t,'shared-stat-owners');
  copyModuleClosure(['tooling/landing/lock.ts','tooling/gate/scopes/run-owner.ts','tooling/gate/disk-capacity.ts','tooling/gate/binary-pins.ts'],stage);
  const file=join(stage,'tooling/gate/process-group.ts'),source=readFileSync(file,'utf8');
  const anchor=source.split('\n').find(line=>line.startsWith('const liveStat:'));assert.ok(anchor);
  writeFileSync(file,source.replace(anchor,`const liveStat:StatReader=pid=>{if(pid===72)return '72 (malformed live) S';if(pid===73)throw Object.assign(Error('gone'),{code:'ESRCH'});if(pid===74)throw Object.assign(Error('controlled denied stat'),{code:'EACCES'});return String(pid)+${JSON.stringify(stat(71).slice(2))};};`));
  const runnerFile=join(stage,'tooling/gate/scopes/run-owner.ts'),runnerSource=readFileSync(runnerFile,'utf8');
  const runnerAnchor=runnerSource.split('\n').find(line=>line.startsWith('const boot ='));assert.ok(runnerAnchor);
  writeFileSync(runnerFile,runnerSource.replace(runnerAnchor,`const boot = () => ${JSON.stringify(boot)};`));
  const lockFile=join(stage,'tooling/landing/lock.ts'),lockSource=readFileSync(lockFile,'utf8');
  const bootLine=lockSource.split('\n').find(line=>line.includes('readFileSync(')&&line.includes('boot_id'));assert.ok(bootLine);
  writeFileSync(lockFile,lockSource.replace(bootLine,`    if(pid===75)throw Error('controlled boot observation failure');\n${bootLine}`));
  const {HostStateError}:typeof import('./host-state.ts')=await import(pathToFileURL(join(stage,'tooling/gate/host-state.ts')).href);
  const lock:typeof import('../landing/lock.ts')=await import(pathToFileURL(join(stage,'tooling/landing/lock.ts')).href);
  const {DiskCapacity}:typeof import('./disk-capacity.ts')=await import(pathToFileURL(join(stage,'tooling/gate/disk-capacity.ts')).href);
  const pins:typeof import('./binary-pins.ts')=await import(pathToFileURL(join(stage,'tooling/gate/binary-pins.ts')).href);

  for(const pid of [72,74,75]){
    const failure=(error:unknown)=>{
      assert.ok(error instanceof HostStateError);assert.equal(error.kind,'tooling-setup');
      assert.match(error.message,new RegExp('cannot observe process identity '+pid));
      assert.ok(error.cause instanceof Error);
      assert.match(String(error.cause),pid===72?/invalid process 72 stat after recheck/:pid===74?/controlled denied stat/:/controlled boot observation failure/);
      return true;
    };
    assert.throws(()=>lock.processIdentity(pid),failure);
    const held=join(stage,'held-'+pid),owner=`${boot} ${pid} 190\n`;
    writeFileSync(held,owner);
    for(const action of [()=>lock.holder(held),()=>lock.acquire(held)]){
      assert.throws(action,failure);assert.equal(readFileSync(held,'utf8'),owner);
    }
    const unpublished=join(stage,'unpublished-'+pid),candidate=unpublished+'.'+pid+'.'+boot;
    writeFileSync(candidate,'unpublished owner');assert.throws(()=>lock.acquire(unpublished),failure);
    assert.equal(readFileSync(candidate,'utf8'),'unpublished owner');assert.equal(existsSync(unpublished),false);

    const env=ownMemory(join(stage,'capacity-'+pid),{disk:{freeBytes:60*2**30,freeInodes:100}}),capacity=new DiskCapacity({env,pool:null});
    const target=join(stage,'claimed-'+pid),identity=`${boot} ${pid} 190`;
    const build={version:1,claims:[{id:'held',pid,identity,root:stage,target,outputs:['nts-dev']}]};
    const buildBytes=JSON.stringify(build);writeFileSync(capacity.stateFile,buildBytes);
    for(const action of [()=>capacity.buildSnapshot({root:stage,target}),()=>capacity.beginBuild({root:stage,target})]){
      assert.throws(action,failure);assert.equal(readFileSync(capacity.stateFile,'utf8'),buildBytes);
    }
    writeFileSync(capacity.stateFile,JSON.stringify({version:1,claims:[]}));
    const temporaryBytes=JSON.stringify({version:1,claims:[{id:'held',pid,identity,path:target,bytes:1}]});
    writeFileSync(capacity.temporaryStateFile,temporaryBytes);
    assert.throws(()=>capacity.tryTemporary(stage,1),failure);
    assert.equal(readFileSync(capacity.temporaryStateFile,'utf8'),temporaryBytes);

    const root=join(stage,'pins-'+pid),retained=join(root,'a'.repeat(64)),holder=join(retained,'holders',boot+'.json');
    mkdirSync(join(retained,'holders'),{recursive:true});writeFileSync(join(retained,'nts'),'held compiler');
    const holderBytes=JSON.stringify({version:1,run:stage,token:boot,pid,identity});writeFileSync(holder,holderBytes);
    for(let n=0;n<12;n++){
      const dir=join(root,String(n).padStart(64,'0'));mkdirSync(dir);writeFileSync(join(dir,'nts'),'old compiler');
    }
    const source=join(stage,'compiler-'+pid);writeFileSync(source,'new compiler');
    const pin=pins.pinBinaries({root,hash:createHash('sha256').update('new compiler').digest('hex'),run:stage,binaries:{nts:source},now:()=>0,wallNow:()=>0});
    try{
      assert.equal(readFileSync(holder,'utf8'),holderBytes);assert.equal(readFileSync(join(retained,'nts'),'utf8'),'held compiler');
      assert.ok(pins.binaryPinDiagnostics(root).warnings.some(line=>line.includes('process identity '+pid)));
      assert.ok(Array.from({length:12},(_,n)=>join(root,String(n).padStart(64,'0'))).some(dir=>!existsSync(dir)),'retention must still reclaim unheld controls');
    }finally{pin.release();}
  }
  assert.equal(lock.processIdentity(73),null);
  const {reapRunOwner}:typeof import('./scopes/run-owner.ts')=await import(pathToFileURL(runnerFile).href);
  const receipt=join(stage,'owner.json');let reaped=0;
  for(const pid of [72,73]){
    writeFileSync(receipt,JSON.stringify({version:1,nonce:boot,pid,start:'190',boot,slice:'nts-tooling-'+ 'a'.repeat(32)+'.slice'}));
    if(pid===72){assert.throws(()=>reapRunOwner(receipt,()=>{reaped++;}),/invalid process 72 stat after recheck/);assert.equal(reaped,0);}
    else{reapRunOwner(receipt,()=>{reaped++;});assert.equal(reaped,1);}
  }
});
