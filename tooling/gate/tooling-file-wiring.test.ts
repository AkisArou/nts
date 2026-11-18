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

for(const full of [false,true])test(`real tooling files ${full?'wait on full supplied memory then enter':'enter beside two ordinary agent jobs'}`,async t=>{
  const own=testScratch(t,'tooling-file-wiring'),root=join(own,'repo'),run=join(own,'run'),target=join(own,'target'),gate=join(root,'tooling/gate');
  copyModuleClosure(['tooling/gate/run.mjs','tooling/gate/tooling-runner.ts'],root);
  oracleWorkspaceFixture(t,root);
  const listed=spawnSync('sh',[new URL('./all.sh',source).pathname,'--list'],{env:fixtureEnvironment(t),encoding:'utf8'});
  assert.equal(listed.status,0,listed.stderr);
  const independent=full?undefined:{root:join(own,'nested-repo'),run:join(own,'nested-run'),target:join(own,'nested-target'),marker:join(own,'nested-marker.json'),memory:ownMemory(join(own,'nested-memory'))};
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
  for(const [index,path] of paths.entries())writeFileSync(join(root,path),generatedJavaScript(`import{test}from'node:test';import{existsSync,readFileSync,writeFileSync}from'node:fs';import{spawnSync}from'node:child_process';import{randomUUID}from'node:crypto';
import{toolingSliceArgs}from ${JSON.stringify(join(gate,'tooling-slice.ts'))};
import{readLimits}from ${JSON.stringify(join(gate,'scopes/memory-limits.ts'))};import{inResidentWorker}from ${JSON.stringify(join(root,'tooling/census/worker-memory.ts'))};
import{gateEnvironment}from ${JSON.stringify(join(gate,'canonical-environment.ts'))};import{readLedger}from ${JSON.stringify(join(gate,'memory-ledger.ts'))};
test('file ${index}',t=>{if(inResidentWorker()||process.env.NTS_CENSUS_POOL_WORKER)throw Error('a tooling entry inherited census worker policy');
if(${index}===0&&!existsSync(${JSON.stringify(join(own,'entered-1'))}))throw Error('the measured costly file was not dispatched first');
const nested=spawnSync('systemd-run',['--user','--scope','--collect','--quiet','--unit=nts-test-file-descendant-'+randomUUID(),...toolingSliceArgs(process.env,'agent'),process.execPath,'--input-type=module','-e',${JSON.stringify(observeCgroup)}],{encoding:'utf8'});
const marker='/'+process.env.NTS_TOOLING_SLICE,at=nested.stdout.indexOf(marker+'/');if(nested.status!==0||at<0)throw Error('fixture scope escaped its file: '+nested.stdout+nested.stderr);
const bound=readLimits(nested.stdout.slice(0,at+marker.length)).max;if(!Number.isSafeInteger(bound)||bound<1||bound>6*2**30)throw Error('the file has no finite kernel bound');
const worker=process.env.NTS_TOOLING_SLICE.replace(/-r[a-z0-9]{8}[.]slice$/,'.slice'),aggregate=worker.replace(/-w[a-z0-9]+[.]slice$/,'.slice');
const aggregateMarker='/'+aggregate,aggregateAt=nested.stdout.indexOf(aggregateMarker+'/');
if(aggregateAt<0||readLimits(nested.stdout.slice(0,aggregateAt+aggregateMarker.length)).max!==Infinity)throw Error('the pool retained a static whole-suite cap instead of its step boundary');
${index===1?nestedControl:''}
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
  assert.equal(writeCaseHistory(caseHistoryFile('tooling',memory,root),paths.map(path=>({key:caseMemoryKey({step:'tooling',backend:'node',path}),peak:2.5*GiB}))),undefined);
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
  assert.equal(await child.closed,0,child.output());
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
test('isolated entry',()=>{if(globalThis.toolingEntrySeen)throw Error('reused test process');globalThis.toolingEntrySeen=true;
${index===0?`const unit='nts-test-file-leftover-'+randomUUID();const child=spawnSync('systemd-run',['--user','--collect','--quiet','--unit='+unit,...toolingSliceArgs(process.env,'agent'),'-p','RuntimeMaxSec=120','-p','LimitCORE=0','/usr/bin/sleep','infinity'],{encoding:'utf8'});if(child.status!==0)throw Error(child.stderr);`:
`const previous=JSON.parse(readFileSync(${JSON.stringify(paths[0]+'.receipt')},'utf8'));const active=spawnSync('systemctl',['--user','is-active',previous.unit],{encoding:'utf8'});if(active.stdout.trim()==='active')throw Error('preceding file did not drain its fixture service');const unit='';`}
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
