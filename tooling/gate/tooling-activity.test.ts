import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {CommandActivitySampler,commandProcessIdentity} from './active-process.ts';
import {readToolingEntry} from './tooling-entry-activity.ts';
import {testScratch} from './test-scratch.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {spawnTest,waitFor} from './test-wait.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';

test('entry receipts bind the collector, file, nonce and birth',()=>{
  const receipt={version:1,nonce:'owned',file:'/entry.test.ts',pid:21,started:100,parent:11};
  assert.deepEqual(readToolingEntry(receipt,'owned','/entry.test.ts',11),receipt);
  for(const changed of [null,{}, {...receipt,version:2},{...receipt,nonce:'foreign'},{...receipt,file:'/other.test.ts'},
    {...receipt,parent:99},{...receipt,pid:0},{...receipt,started:NaN}])
    assert.throws(()=>readToolingEntry(changed,'owned','/entry.test.ts',11),/entry identity/);
});

test('rooted activity includes detached descendants without borrowing a sibling in the same session',()=>{
  const record=(parent:number,started:number,cpu=0,busy=false)=>({parent,started,cpu,own:cpu,busy,group:1,session:1});
  const rows=new Map([[11,record(1,100)],[12,record(11,101,7,true)],[21,record(1,200)],[22,record(21,201,3)]]);
  rows.get(12)!.session=12;rows.get(12)!.group=12;
  let scans=0;const sampler=new CommandActivitySampler((sessions,roots)=>{scans++;assert.equal(sessions.size,0);assert.deepEqual([...roots!],[11,21]);return rows;});
  const seen:{cpu:number;busy:boolean}[][]=[[],[]],errors:unknown[]=[];
  const canceled=[11,21].map((group,i)=>sampler.watch({group,started:i?200:100,parent:1,scope:'descendants',pollMs:5000,
    sample:(cpu,_own,busy)=>seen[i]!.push({cpu,busy}),broken:error=>errors.push(error)}));
  try{
    sampler.sample();rows.get(12)!.busy=false;rows.get(12)!.cpu=8;sampler.sample();
    assert.equal(scans,2);assert.deepEqual(seen,[[{cpu:7,busy:true},{cpu:8,busy:false}],[{cpu:3,busy:false},{cpu:3,busy:false}]]);
    rows.get(11)!.started++;sampler.sample();assert.match(String(errors[0]),/identity changed/);
    assert.equal(seen[0]!.length,2,'reused root cannot lend activity');
  }finally{for(const cancel of canceled)cancel();}
});

test('the rooted kernel observer sees a detached busy descendant of a waiting entry',async t=>{
  const root=testScratch(t,'tooling-rooted-activity'),ready=join(root,'ready'),release=join(root,'release');
  const worker=`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');while(!fs.existsSync(${JSON.stringify(release)})){};`;
  const entry=`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(worker)}],{detached:true,stdio:'inherit'});child.on('close',code=>process.exitCode=code);`;
  const child=spawn(process.execPath,['-e',entry],{env:fixtureEnvironment(t),stdio:'ignore'});
  const done=new Promise<void>(resolve=>child.once('close',()=>resolve()));
  const identity=commandProcessIdentity(child.pid!)!;let busy=false;const sampler=new CommandActivitySampler();
  const cancel=sampler.watch({group:child.pid!,started:identity.started,parent:process.pid,scope:'descendants',pollMs:5000,
    sample:(_cpu,_own,seen,processOwn)=>{busy ||= seen&&processOwn.pid!==child.pid;},broken:error=>{throw error;}});
  try{await waitFor('the detached child to announce readiness',()=>existsSync(ready));
    await waitFor('the shared observer to attribute descendant CPU and busy state',()=>{sampler.sample();return busy;});
  }finally{writeFileSync(release,'release');await done;cancel();}
  assert.equal(child.exitCode,0);
});

test('silent busy and CPU progress survive virtual five-minute boundaries while a truly idle file holds by name',t=>{
  const root=testScratch(t,'tooling-liveness'),runner=new URL('./tooling-runner.ts',import.meta.url).href;
  for(const idle of [false,true]){
    const directory=join(root,String(idle));mkdirSync(directory);const file=join(directory,'silent.test.mjs'),ready=join(directory,'ready'),release=join(directory,'release');
    writeFileSync(file,`import{test}from'node:test';import{writeFileSync,existsSync}from'node:fs';test('silent body',()=>{writeFileSync(${JSON.stringify(ready)},'ready');${idle?"Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);":`while(!existsSync(${JSON.stringify(release)})){}`}});`);
    const probe=join(directory,'probe.mjs');writeFileSync(probe,`
import{runTooling}from ${JSON.stringify(runner)};import{waitFor}from ${JSON.stringify(new URL('./test-wait.ts',import.meta.url).href)};
import{existsSync,writeFileSync}from'node:fs';import{PassThrough}from'node:stream';
let now=0,sample;const tasks=[],output=new PassThrough();output.resume();
const running=runTooling([${JSON.stringify(file)}],{output,resultEnv:{},instrument:{now:()=>now,frequency:100,
 watchActivity(file,seen){sample=seen;return()=>{};},sampleActivity:()=>{},
 scheduleIdle(callback,milliseconds){const task={callback,cancelled:false};tasks.push(task);return()=>task.cancelled=true;}}});
await waitFor('the silent body to start',()=>existsSync(${JSON.stringify(ready)})&&sample!==undefined);
now=300001;sample({cpu:0,own:0,busy:${!idle},processOwn:{pid:1,cpu:0}});
${idle?'':`now=600002;sample({cpu:1,own:1,busy:false,processOwn:{pid:1,cpu:1}});
now=900003;sample({cpu:1,own:1,busy:true,processOwn:{pid:1,cpu:1}});writeFileSync(${JSON.stringify(release)},'release');`}
const result=await running;console.log(JSON.stringify({now,...result}));
`);
    const result=spawnTest(process.execPath,[probe],{env:fixtureEnvironment(t),encoding:'utf8'},'supplied tooling liveness bridge');
    assert.equal(result.status,0,result.stdout+result.stderr);const value=JSON.parse(result.stdout.trim());
    assert.equal(value.status,idle?2:0,result.stderr);assert.equal(value.completedFailures,0);assert.equal(value.now,idle?300001:900003);
    if(idle){assert.ok(result.stderr.includes(file),result.stderr);assert.match(result.stderr,/no output, process-group CPU activity or busy thread for 300000 ms/);}
  }
});

test('an absent bootstrap receipt is a named instrument through the actual collector',t=>{
  const root=testScratch(t,'tooling-missing-entry'),staged=join(root,'staged');
  copyModuleClosure(['tooling/gate/tooling-runner.ts'],staged);
  const preload=join(staged,'tooling/gate/tooling-entry-activity.ts'),source=readFileSync(preload,'utf8');
  const anchor='durableRecord(receiptPath(activity,file),';
  assert.equal(source.split(anchor).length,2,'one actual receipt publication boundary');
  writeFileSync(preload,source.replace(anchor,'if(false)durableRecord(receiptPath(activity,file),'));
  const file=join(root,'missing.test.mjs');
  writeFileSync(file,"import{test}from'node:test';test('missing receipt',()=>new Promise(()=>{}));\n");
  const script=`import{runScopedTooling}from ${JSON.stringify(pathToFileURL(join(staged,'tooling/gate/tooling-runner.ts')).href)};
import{PassThrough}from'node:stream';const output=new PassThrough();output.resume();
try{await runScopedTooling([${JSON.stringify(file)}],{fixture:true,idleMs:1000,output});throw Error('missing observation was accepted');}
catch(error){console.log(JSON.stringify({kind:error.kind,message:error.message}));}`;
  const actual=spawnTest(process.execPath,['--input-type=module','-e',script],{env:fixtureEnvironment(t),encoding:'utf8'},'missing collector receipt refusal');
  assert.equal(actual.status,0,actual.stderr);const observed=JSON.parse(actual.stdout.trim());
  assert.equal(observed.kind,'tooling-setup');assert.match(observed.message,/without a completed report/);
  // The collector's stderr is in the observed output stream, not an inferred
  // application assertion or a manufactured zero-CPU hung observation.
});
