import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test,type TestContext} from 'node:test';
import {randomUUID} from 'node:crypto';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {gateEnvironment} from './canonical-environment.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {testScratch} from './test-scratch.ts';
import {waitFor} from './test-wait.ts';
import {ownMemory} from './test-memory.ts';
import {reserve,readLedger,type Reservation} from './memory-ledger.ts';
import {caseMemoryKey,caseHistoryFile,readCaseHistory,writeCaseHistory,historyFile,writeCostHistory} from './step-scheduling.ts';
import {toolingSliceArgs} from './tooling-slice.ts';
import {oracleWorkspaceFixture} from '../differential/oracle-workspace-fixture.ts';
import {generatedJavaScript} from './generated-javascript.ts';
import {durableRecord} from './durable-record.ts';

const GiB=2**30;
const source=new URL('./',import.meta.url);

function start(t:TestContext,root:string,env:NodeJS.ProcessEnv,entry:string,args:string[]=[]){
  const unit='nts-test-tooling-files-'+randomUUID();
  const child=spawn('systemd-run',['--user','--collect','--wait','--pipe','--quiet','--unit='+unit,...toolingSliceArgs(env,'agent'),
    '-p','Nice=19','-p','CPUWeight=20','-p','CPUAffinity=0-3 6-31','-p','LimitCORE=0','-p','RuntimeMaxSec=300',
    '--working-directory='+root,...Object.entries(env).filter((row):row is [string,string]=>row[1]!==undefined).map(([key,value])=>'--setenv='+key+'='+value),
    process.execPath,entry,...args],{env:fixtureEnvironment(t),stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',part=>output+=part);child.stderr.on('data',part=>output+=part);
  const closed=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  t.after(async()=>{spawnSync('systemctl',['--user','stop',unit],{env:fixtureEnvironment(t),stdio:'ignore'});await closed;});
  return {closed,output:()=>output,stopped:()=>child.exitCode!==null||child.signalCode!==null?output||'tooling fixture exited':undefined};
}

for(const scenario of ['ordinary','full','oversized'] as const)test(`real tooling files ${scenario==='full'?'wait on full supplied memory then enter':scenario==='oversized'?'refuse a head lease beyond the pool budget by name':'enter beside two ordinary agent jobs'}`,async t=>{
  const full=scenario==='full',oversized=scenario==='oversized';
  const own=testScratch(t,'tooling-file-wiring'),root=join(own,'repo'),run=join(own,'run'),target=join(own,'target'),gate=join(root,'tooling/gate');
  copyModuleClosure(['tooling/gate/run.mjs','tooling/gate/tooling-runner.ts','tooling/gate/test-wait.ts'],root);
  oracleWorkspaceFixture(t,root);
  const listed=spawnSync('sh',[new URL('./all.sh',source).pathname,'--list'],{env:fixtureEnvironment(t),encoding:'utf8'});
  assert.equal(listed.status,0,listed.stderr);
  const independent=full||oversized?undefined:{root:join(own,'nested-repo'),run:join(own,'nested-run'),target:join(own,'nested-target'),marker:join(own,'nested-marker.json'),memory:ownMemory(join(own,'nested-memory'))};
  if(independent){
    copyModuleClosure(['tooling/gate/run.mjs'],independent.root);oracleWorkspaceFixture(t,independent.root);
    mkdirSync(join(independent.target,'release'),{recursive:true});writeFileSync(join(independent.target,'release/nts'),'#!/bin/sh\nexit 0\n',{mode:0o755});
    const observe=`const fs=require('node:fs');if(process.env.NTS_MEMORY_LEDGER!==${JSON.stringify(independent.memory.NTS_MEMORY_LEDGER)})throw Error('nested runner escaped its supplied ledger');fs.writeFileSync(${JSON.stringify(independent.marker)},JSON.stringify({ledger:process.env.NTS_MEMORY_LEDGER,reservation:process.env.NTS_MEMORY_RESERVATION}));`;
    writeFileSync(join(independent.root,'tooling/gate/nested-marker.mjs'),generatedJavaScript(observe.replace("const fs=require('node:fs');","import fs from 'node:fs';")));
    writeFileSync(join(independent.root,'tooling/gate/all.sh'),`#!/bin/sh\nif [ "$1" = --list ]; then\ncat <<'NAMES'\n${listed.stdout.trim()}\nNAMES\nelse\nnode tooling/gate/nested-marker.mjs\nfi\n`);
  }
  const paths=['tooling/first.test.mjs','tooling/second.test.mjs'];
  // Explicit live kernel wiring; admission still uses the complete supplied
  // fixture below. The production owner alone reads the child scope's group.
  const observeCgroup='import{hostObservations}from '+JSON.stringify(join(gate,'host-observations.ts'))+';process.stdout.write(hostObservations({}).ownCgroup());';
  const nestedControl=independent?`const own=${JSON.stringify(independent)};
const before=readLedger(process.env.NTS_MEMORY_LEDGER).admitted.map(row=>row.id).sort();
const env=gateEnvironment(process.env,{run:own.run,oracleRoot:own.root,owned:{...own.memory,CARGO_TARGET_DIR:own.target}}).env;
if(env.NTS_MEMORY_LEDGER===process.env.NTS_MEMORY_LEDGER||env.NTS_MEMORY_RESERVATION)throw Error('nested runner inherited the outer file reservation');
const unit='nts-test-file-nested-'+randomUUID();t.after(()=>spawnSync('systemctl',['--user','stop',unit],{stdio:'ignore'}));
const child=spawnSync('systemd-run',['--user','--collect','--wait','--pipe','--quiet','--unit='+unit,...toolingSliceArgs(process.env,'agent'),'-p','Nice=19','-p','CPUWeight=20','-p','RuntimeMaxSec=120','-p','LimitCORE=0','--working-directory='+own.root,...Object.entries(env).filter(([,value])=>value!==undefined).map(([key,value])=>'--setenv='+key+'='+value),process.execPath,own.root+'/tooling/gate/run.mjs','format'],{encoding:'utf8'});
if(child.status!==0)throw Error(child.stdout+child.stderr);
const observed=JSON.parse(readFileSync(own.marker,'utf8'));
if(observed.ledger!==own.memory.NTS_MEMORY_LEDGER||!observed.reservation)throw Error('nested runner did not reserve in its private ledger');
if(readLedger(own.memory.NTS_MEMORY_LEDGER).admitted.length)throw Error('nested runner left a private reservation');
if(JSON.stringify(readLedger(process.env.NTS_MEMORY_LEDGER).admitted.map(row=>row.id).sort())!==JSON.stringify(before))throw Error('nested runner reserved in the outer ledger');`:'';
  for(const [index,path] of paths.entries())writeFileSync(join(root,path),generatedJavaScript(`import{test}from'node:test';import{existsSync,readFileSync,writeFileSync}from'node:fs';import{spawn,spawnSync}from'node:child_process';import{randomUUID}from'node:crypto';
import{toolingSliceArgs}from ${JSON.stringify(join(gate,'tooling-slice.ts'))};
import{readLimits}from ${JSON.stringify(join(gate,'scopes/memory-limits.ts'))};import{inResidentWorker}from ${JSON.stringify(join(root,'tooling/census/worker-memory.ts'))};
import{hostObservations}from ${JSON.stringify(join(gate,'host-observations.ts'))};import{waitFor}from ${JSON.stringify(join(gate,'test-wait.ts'))};
import{gateEnvironment}from ${JSON.stringify(join(gate,'canonical-environment.ts'))};import{readLedger}from ${JSON.stringify(join(gate,'memory-ledger.ts'))};
test('file ${index}',async t=>{if(inResidentWorker()||process.env.NTS_CENSUS_POOL_WORKER)throw Error('a tooling entry inherited census worker policy');
if(${index}===0&&!existsSync(${JSON.stringify(join(own,'entered-1'))}))throw Error('the measured costly file was not dispatched first');
const nested=spawnSync('systemd-run',['--user','--scope','--collect','--quiet','--unit=nts-test-file-descendant-'+randomUUID(),...toolingSliceArgs(process.env,'agent'),process.execPath,'--input-type=module','-e',${JSON.stringify(observeCgroup)}],{encoding:'utf8'});
const marker='/'+process.env.NTS_TOOLING_SLICE,at=nested.stdout.indexOf(marker+'/');if(nested.status!==0||at<0)throw Error('fixture scope escaped its file: '+nested.stdout+nested.stderr);
const bound=readLimits(nested.stdout.slice(0,at+marker.length)).max;if(!Number.isSafeInteger(bound)||bound<1||bound>6*2**30)throw Error('the file has no finite kernel bound');
const worker=process.env.NTS_TOOLING_SLICE.replace(/-r[a-z0-9]{8}[.]slice$/,'.slice'),aggregate=worker.replace(/-w[a-z0-9]+[.]slice$/,'.slice');
const aggregateMarker='/'+aggregate,aggregateAt=nested.stdout.indexOf(aggregateMarker+'/');
if(aggregateAt<0||readLimits(nested.stdout.slice(0,aggregateAt+aggregateMarker.length)).max!==Infinity)throw Error('the pool retained a static whole-suite cap instead of its step boundary');
const aggregateGroup=nested.stdout.slice(0,aggregateAt+aggregateMarker.length),stepGroup=aggregateGroup.slice(0,aggregateGroup.lastIndexOf('/'));
if(!Number.isSafeInteger(readLimits(stepGroup).max)||readLimits(stepGroup).max<1)throw Error('the aggregate escaped its dynamic step worker bound');
${index===1?nestedControl:''}
if(${index}===1){
const live=hostObservations({}),fileGroup=nested.stdout.slice(0,at+marker.length),workerGroup=fileGroup.slice(0,fileGroup.lastIndexOf('/'));
const fileBefore=live.cgroupCharge(fileGroup),workerBefore=live.cgroupCharge(workerGroup),unit='nts-test-file-charge-'+randomUUID();
const child=spawn('systemd-run',['--user','--scope','--collect','--quiet','--unit='+unit,...toolingSliceArgs(process.env,'agent'),'python3','-c',"import sys; held=bytearray(64*1024**2); print('READY',flush=True); sys.stdin.readline()"],{stdio:['pipe','pipe','pipe']});
t.after(()=>spawnSync('systemctl',['--user','stop',unit+'.scope'],{stdio:'ignore'}));
let ready=false,ended;child.stdout.on('data',part=>{if(String(part).includes('READY'))ready=true;});
const closed=new Promise(resolve=>child.once('close',code=>{ended='charge child exited '+code;resolve(code);}));
await waitFor('the fixture unit has allocated its memory',()=>ready,{stopped:()=>ended});
if(live.cgroupCharge(fileGroup)-fileBefore<32*2**20||live.cgroupCharge(workerGroup)-workerBefore<32*2**20)throw Error('fixture memory was not charged inside its file and leased worker');
child.stdin.end('done');if(await closed!==0)throw Error('charge fixture failed');
}
writeFileSync(${JSON.stringify(join(own,'entered-'+index))},nested.stdout);});`));
  const ready=join(own,'ready'),go=join(own,'go'),driver=join(gate,'fixture-driver.mjs');
  writeFileSync(driver,generatedJavaScript(`import{existsSync,watch,writeFileSync}from'node:fs';import{spawn}from'node:child_process';
writeFileSync(${JSON.stringify(ready)},'ready');
await new Promise(resolve=>{const check=()=>{if(existsSync(${JSON.stringify(go)})){watcher.close();resolve();}};const watcher=watch(${JSON.stringify(own)},check);check();});
const child=spawn(process.execPath,[${JSON.stringify(join(gate,'tooling-runner.ts'))},...${JSON.stringify(paths.map(path=>join(root,path)))}],{stdio:'inherit'});
process.exitCode=await new Promise(resolve=>child.once('close',code=>resolve(code??2)));`));
  writeFileSync(join(gate,'all.sh'),`#!/bin/sh\nif [ "$1" = --list ]; then\ncat <<'NAMES'\n${listed.stdout.trim()}\nNAMES\nelse\nexec node ${JSON.stringify(driver)}\nfi\n`);
  const memoryDir=join(own,'memory'),reading={totalKiB:31*2**20,availableKiB:20*2**20,
    resident:{kind:'fixed' as const,defaultBytes:128*2**20},scopePeak:{kind:'fixed' as const,bytes:128*2**20,resettable:true}};
  const memory=ownMemory(memoryDir,reading),holders:Reservation[]=[];
  // One supplied execution worker makes ordering observable without a host
  // timing assumption or a production parallelism override.
  const observations=JSON.parse(readFileSync(memory.NTS_HOST_OBSERVATIONS,'utf8'));
  observations.width={logical:1,available:1};durableRecord(memory.NTS_HOST_OBSERVATIONS,observations);
  mkdirSync(memory.NTS_GATE_COSTS_DIR,{recursive:true});
  durableRecord(join(memory.NTS_GATE_COSTS_DIR,'tooling-files.json'),Object.fromEntries(paths.map((path,index)=>[path,index+1])));
  t.after(async()=>{for(const holder of holders)holder.release();await Promise.all(holders.map(holder=>holder.closed));});
  for(const what of ['ordinary one','ordinary two'])holders.push(await reserve({bytes:4*GiB,priority:'agent',what},{env:memory,used:()=>0,report:()=>{}}));
  assert.equal(writeCostHistory(historyFile(memory),{steps:[{name:'tooling',memory:{unit:'step',peak:16*GiB}}],jobs:[]}),undefined);
  assert.equal(writeCaseHistory(caseHistoryFile('tooling',memory,root),paths.map((path,index)=>({key:caseMemoryKey({step:'tooling',backend:'node',path}),peak:oversized&&index===1?64*GiB:2.5*GiB}))),undefined);
  mkdirSync(join(target,'release'),{recursive:true});writeFileSync(join(target,'release/nts'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  const planned=gateEnvironment(fixtureEnvironment(t),{run,oracleRoot:root,owned:{...memory,CARGO_TARGET_DIR:target}});
  const child=start(t,root,planned.env,join(gate,'run.mjs'),['tooling']);
  await waitFor('the elastic tooling payload to start',()=>existsSync(ready),{stopped:child.stopped});
  if(full)ownMemory(memoryDir,{...reading,availableKiB:2*2**20});
  writeFileSync(go,'go');
  if(full){
    await waitFor('the runner to queue per-file memory growth',()=>readLedger(memory.NTS_MEMORY_LEDGER).waiting.some(row=>row.grows!==null),{stopped:child.stopped});
    assert.ok(paths.every((_,index)=>!existsSync(join(own,'entered-'+index))),'no file starts before its memory grant');
    ownMemory(memoryDir,reading);
  }
  const code=await child.closed;
  if(oversized){
    assert.notEqual(code,0,child.output());
    assert.match(child.output(),/second[.]test[.]mjs.*cannot fit the run's maximum reservation/);
    assert.ok(paths.every((_,index)=>!existsSync(join(own,'entered-'+index))),'an impossible head starts no file');
    assert.equal(readLedger(memory.NTS_MEMORY_LEDGER).admitted.length,2,'the refused runner returned its reservation');
    return;
  }
  assert.equal(code,0,child.output());
  assert.ok(paths.every((_,index)=>existsSync(join(own,'entered-'+index))),child.output());
  const summary=JSON.parse(readFileSync(join(run,'summary.json'),'utf8')) as {steps:{elastic?:boolean;verdict:string}[]};
  assert.equal(summary.steps[0]?.elastic,true);assert.equal(summary.steps[0]?.verdict,'PASS');
  const history=readCaseHistory(caseHistoryFile('tooling',memory,root));
  for(const path of paths)assert.equal(history.get(caseMemoryKey({step:'tooling',backend:'node',path}))?.at(-1),128*2**20,'each lease retained its final scope peak');
  const costs=JSON.parse(readFileSync(join(memory.NTS_GATE_COSTS_DIR,'tooling-files.json'),'utf8')) as Record<string,number>;
  assert.deepEqual(Object.keys(costs).sort(),[...paths].sort());assert.ok(paths.every(path=>costs[path]!>0),'each completed entry published its scheduling cost');
  assert.equal(readLedger(memory.NTS_MEMORY_LEDGER).admitted.length,2,'the runner drained its reservation, leaving only the ordinary jobs');
});

test('one resident controller executes successive tooling entries in fresh child processes',async t=>{
  const own=testScratch(t,'tooling-file-reuse'),root=join(own,'repo');
  copyModuleClosure(['tooling/gate/tooling-file-worker.ts'],root);
  const paths=['a','b'].map(name=>join(own,name+'.test.mjs'));
  for(const [index,path] of paths.entries())writeFileSync(path,generatedJavaScript(`import{test}from'node:test';import{readFileSync}from'node:fs';import{spawnSync}from'node:child_process';import{randomUUID}from'node:crypto';
import{durableRecord}from ${JSON.stringify(join(root,'tooling/gate/durable-record.ts'))};import{toolingSliceArgs}from ${JSON.stringify(join(root,'tooling/gate/tooling-slice.ts'))};
import{compileSync,memoryRun}from ${JSON.stringify(join(root,'tooling/census/worker-memory.ts'))};
test('isolated entry',t=>{if(globalThis.toolingEntrySeen)throw Error('reused test process');globalThis.toolingEntrySeen=true;
${index===0?`const unit='nts-test-file-leftover-'+randomUUID();const child=spawnSync('systemd-run',['--user','--collect','--quiet','--unit='+unit,...toolingSliceArgs(process.env,'agent'),'-p','RuntimeMaxSec=120','-p','LimitCORE=0','/usr/bin/sleep','infinity'],{encoding:'utf8'});if(child.status!==0)throw Error(child.stderr);`:
`const previous=JSON.parse(readFileSync(${JSON.stringify(paths[0]+'.receipt')},'utf8'));const active=spawnSync('systemctl',['--user','is-active',previous.unit],{encoding:'utf8'});if(active.stdout.trim()==='active')throw Error('preceding file did not drain its fixture service');const unit='';`}
${index===0?`const result=compileSync({memoryCapKb:64*1024},'python3',['-c','held=bytearray(128*1024**2); print(len(held))'],{encoding:'utf8'});if(!result.memoryKilled)throw Error('the helper skipped its private budget');t.after(async()=>{const run=memoryRun();run.close();await run.closed;});`:''}
durableRecord(${JSON.stringify(path+'.receipt')},{worker:process.env.NTS_TOOLING_SLICE.replace(/-r[a-z0-9]{8}[.]slice$/,'.slice'),child:process.pid,slice:process.env.NTS_TOOLING_SLICE,unit});});`));
  const worker=join(root,'tooling/gate/tooling-file-worker.ts'),helper=join(own,'reuse.mjs');
  writeFileSync(helper,generatedJavaScript(`import{MemoryRun,workerCapBytes}from ${JSON.stringify(new URL('../census/worker-memory.ts',source).href)};
import{runMemoryWorkers}from ${JSON.stringify(new URL('../census/worker-pool.ts',source).href)};
import{runAsCommand}from ${JSON.stringify(new URL('../differential/command-entry/main.ts',source).href)};
runAsCommand(import.meta.url,async()=>{const rows=[];await runMemoryWorkers({paths:${JSON.stringify(paths)},jobs:1,memory:new MemoryRun(),workerBytes:workerCapBytes(),token:async()=>()=>{},
args:()=>[${JSON.stringify(worker)},JSON.stringify({files:${JSON.stringify(paths)},complete:${JSON.stringify(join(own,'complete.json'))},nonce:'reuse'})],onRow:row=>rows.push(row)});
if(rows.length!==2||rows.some(row=>row.bucket!=='tooling'||row.result.status!==0))throw Error(JSON.stringify(rows));});`));
  const planned=gateEnvironment(fixtureEnvironment(t),{run:join(own,'environment'),owned:ownMemory(join(own,'memory'))});
  const child=start(t,own,planned.env,helper);
  assert.equal(await child.closed,0,child.output());
  const [a,b]=paths.map(path=>JSON.parse(readFileSync(path+'.receipt','utf8')) as {worker:string;child:number;slice:string});
  assert.equal(a!.worker,b!.worker);assert.notEqual(a!.child,b!.child);assert.notEqual(a!.slice,b!.slice);
});

test('a file reads its final registered cap after the startup handoff',async t=>{
  const own=testScratch(t,'tooling-cap-handoff'),root=join(own,'repo'),marker=join(own,'controller-started');
  copyModuleClosure(['tooling/gate/tooling-file-worker.ts'],root);
  const worker=join(root,'tooling/gate/tooling-file-worker.ts'),before=readFileSync(worker,'utf8');
  const anchor='const bootstrapMemoryMax=readLimits(process.env.NTS_CENSUS_WORKER_GROUP!).max;';
  assert.ok(before.includes(anchor));
  writeFileSync(worker,before.replace(anchor,anchor+`\n(await import('node:fs')).writeFileSync(${JSON.stringify(marker)},'ready');`));
  const entry=join(own,'cap.test.mjs');
  writeFileSync(entry,generatedJavaScript(`import{test}from'node:test';import{hostObservations}from ${JSON.stringify(join(root,'tooling/gate/host-observations.ts'))};import{readLimits}from ${JSON.stringify(join(root,'tooling/gate/scopes/memory-limits.ts'))};
  test('final file cap',()=>{const group=hostObservations({}).ownCgroup();if(readLimits(group).max!==512*2**20)throw Error('file cached its startup cap');});`));
  const helper=join(own,'handoff.mjs');
  writeFileSync(helper,generatedJavaScript(`import{spawnSync}from'node:child_process';import{existsSync}from'node:fs';
import{MemoryRun}from ${JSON.stringify(new URL('../census/worker-memory.ts',source).href)};import{runMemoryWorkers}from ${JSON.stringify(new URL('../census/worker-pool.ts',source).href)};import{runAsCommand}from ${JSON.stringify(new URL('../differential/command-entry/main.ts',source).href)};
runAsCommand(import.meta.url,async()=>{const memory=new MemoryRun({budgetBytes:1024*2**20}),make=memory.worker.bind(memory),property=(unit,bytes)=>{const r=spawnSync('systemctl',['--user','set-property','--runtime',unit,'MemoryMax='+bytes],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);};
memory.worker=(...args)=>{const worker=make(...args),ready=worker.ready.bind(worker);property(worker.slice,256*2**20);let raised=false;
worker.ready=scope=>{if(!ready(scope)||!existsSync(${JSON.stringify(marker)}))return false;if(!raised){property(worker.slice,512*2**20);property(scope.unit,512*2**20);raised=true;}return true;};return worker;};
const rows=[];await runMemoryWorkers({paths:[${JSON.stringify(entry)}],jobs:1,memory,workerBytes:512*2**20,token:async()=>()=>{},args:()=>[${JSON.stringify(worker)},JSON.stringify({files:[${JSON.stringify(entry)}],complete:${JSON.stringify(join(own,'complete.json'))},nonce:'handoff'})],onRow:row=>rows.push(row)});
if(rows.length!==1||rows[0].result?.status!==0)throw Error(JSON.stringify(rows));});`));
  const planned=gateEnvironment(fixtureEnvironment(t),{run:join(own,'environment'),owned:ownMemory(join(own,'memory'))});
  const child=start(t,own,planned.env,helper);assert.equal(await child.closed,0,child.output());
  assert.match(child.output(),/"bootstrapBoundBytes":268435456,"fileBoundBytes":536870912/);
});

test('a runaway tooling file loses only its named budget result beside completed neighbours',async t=>{
  const own=testScratch(t,'tooling-file-runaway'),root=join(own,'repo');
  copyModuleClosure(['tooling/gate/tooling-file-worker.ts'],root);
  const paths=['before','runaway','after'].map(name=>join(own,name+'.test.mjs'));
  for(const [index,path]of paths.entries())writeFileSync(path,generatedJavaScript(`import{test}from'node:test';import{spawnSync}from'node:child_process';
  test('entry ${index}',()=>{${index===1?"const r=spawnSync('python3',['-c','held=bytearray(512*1024**2); print(len(held))']);if(r.status!==0)throw Error('runaway child stopped');":''}});`));
  const worker=join(root,'tooling/gate/tooling-file-worker.ts'),helper=join(own,'runaway.mjs');
  writeFileSync(helper,generatedJavaScript(`import{MemoryRun}from ${JSON.stringify(new URL('../census/worker-memory.ts',source).href)};import{runMemoryWorkers}from ${JSON.stringify(new URL('../census/worker-pool.ts',source).href)};import{runAsCommand}from ${JSON.stringify(new URL('../differential/command-entry/main.ts',source).href)};
runAsCommand(import.meta.url,async()=>{const rows=[];let incident;try{await runMemoryWorkers({paths:${JSON.stringify(paths)},jobs:1,memory:new MemoryRun({budgetBytes:1024*2**20}),workerBytes:256*2**20,token:async()=>()=>{},args:()=>[${JSON.stringify(worker)},JSON.stringify({files:${JSON.stringify(paths)},complete:${JSON.stringify(join(own,'complete.json'))},nonce:'runaway'})],onRow:row=>rows.push(row)});}catch(error){incident=error;}
if(rows.length!==3||rows[0].result?.status!==0||rows[2].result?.status!==0||rows[1].path!==${JSON.stringify(paths[1])}||(rows[1].bucket!=='memory-cap'&&!String(incident).includes('exceeded its own')))throw Error(JSON.stringify({rows,incident:String(incident)}));process.stdout.write('named runaway retained both neighbours\\n');});`));
  const planned=gateEnvironment(fixtureEnvironment(t),{run:join(own,'environment'),owned:ownMemory(join(own,'memory'))});
  const child=start(t,own,planned.env,helper);assert.equal(await child.closed,0,child.output());assert.match(child.output(),/named runaway retained both neighbours/);
});

test('a resident controller crash retains completed neighbours and stays an instrument failure',async t=>{
  const own=testScratch(t,'tooling-controller-loss'),root=join(own,'repo');
  copyModuleClosure(['tooling/gate/tooling-file-worker.ts'],root);
  const paths=['before','lost','after'].map(name=>join(own,name+'.test.mjs'));
  for(const path of paths)writeFileSync(path,generatedJavaScript("import{test}from'node:test';test('survivor',()=>{});"));
  const worker=join(root,'tooling/gate/tooling-file-worker.ts'),original=readFileSync(worker,'utf8');
  const anchor="    const directory=mkdtempSync(join(dirname(request.complete),'file-'))";
  assert.ok(original.includes(anchor));writeFileSync(worker,original.replace(anchor,`    if(path===${JSON.stringify(paths[1])})process.exit(19);\n`+anchor));
  const helper=join(own,'loss.mjs');
  writeFileSync(helper,generatedJavaScript(`import{MemoryRun}from ${JSON.stringify(new URL('../census/worker-memory.ts',source).href)};import{runMemoryWorkers}from ${JSON.stringify(new URL('../census/worker-pool.ts',source).href)};import{runAsCommand}from ${JSON.stringify(new URL('../differential/command-entry/main.ts',source).href)};
runAsCommand(import.meta.url,async()=>{const rows=[];let incident;try{await runMemoryWorkers({paths:${JSON.stringify(paths)},jobs:1,memory:new MemoryRun({budgetBytes:1024*2**20}),workerBytes:512*2**20,token:async()=>()=>{},args:()=>[${JSON.stringify(worker)},JSON.stringify({files:${JSON.stringify(paths)},complete:${JSON.stringify(join(own,'complete.json'))},nonce:'loss'})],onRow:row=>rows.push(row)});}catch(error){incident=error;}
if(rows.length!==2||rows.some(row=>row.result?.status!==0)||rows[0].path!==${JSON.stringify(paths[0])}||rows[1].path!==${JSON.stringify(paths[2])}||!String(incident).includes('lost ${paths[1]}'))throw Error(JSON.stringify({rows,incident:String(incident)}));process.stdout.write('controller loss preserved completed neighbours\\n');});`));
  const planned=gateEnvironment(fixtureEnvironment(t),{run:join(own,'environment'),owned:ownMemory(join(own,'memory'))});
  const child=start(t,own,planned.env,helper);assert.equal(await child.closed,0,child.output());assert.match(child.output(),/controller loss preserved completed neighbours/);
});
