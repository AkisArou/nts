import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {CommandActivitySampler,commandProcessIdentity} from './active-process.ts';
import {ownedToolingSpawn,ToolingEntryActivity} from './tooling-entry-activity.ts';
import {ChildProcess} from 'node:child_process';
import {tracingChannel} from 'node:diagnostics_channel';
import {testScratch} from './test-scratch.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {spawnTest,waitFor} from './test-wait.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {pathToFileURL} from 'node:url';

test('spawn observations bind the actual Node entry and child test environment',()=>{
  const child=new ChildProcess(),files=new Set(['/entry.test.ts']);
  const options={file:process.execPath,args:[process.execPath,'/entry.test.ts'],envPairs:['NODE_TEST_CONTEXT=child-v8']};
  assert.deepEqual(ownedToolingSpawn({process:child,options},files),{file:'/entry.test.ts',child});
  for(const value of [null,{}, {process:{},options},{process:child,options:{...options,file:'/other-node'}},
    {process:child,options:{...options,args:[process.execPath,'/foreign.test.ts']}},{process:child,options:{...options,envPairs:[]}}])
    assert.equal(ownedToolingSpawn(value,files),undefined);
  for(const argv of [['--eval','helper()'],['-ehelper()'],['--print','helper()'],['-phelper()'],['helper.mjs'],
    ['--run','build'],['--import'],['--title'],['--inspect-port'],['--max-old-space-size'],['--','helper.mjs']])
    assert.equal(ownedToolingSpawn({process:child,options:{...options,args:[process.execPath,...argv,'/entry.test.ts']}},files),undefined,JSON.stringify(argv));
  for(const argv of [[],['--'],['--import','file:///owned/preload.mjs'],['--expose-gc','--import=file:///owned/preload.mjs'],['--no-warnings','--title=entry'],
    ['--test-concurrency=0','--test-timeout=0','--import','file:///owned/preload.mjs']])
    assert.ok(ownedToolingSpawn({process:child,options:{...options,args:[process.execPath,...argv,'/entry.test.ts']}},files),JSON.stringify(argv));
});

test('closing the activity owner removes its exact channel subscription',()=>{
  const channel=tracingChannel('child_process.spawn').start,before=channel.hasSubscribers;
  let starts=0;const owner=new ToolingEntryActivity(new Set(['/owned.test.ts']),()=>starts++,error=>{throw error;});
  assert.equal(channel.hasSubscribers,true);owner.close();owner.close();assert.equal(channel.hasSubscribers,before);
  channel.publish({process:new ChildProcess(),options:{file:process.execPath,args:[process.execPath,'/owned.test.ts'],envPairs:['NODE_TEST_CONTEXT=child-v8']}});
  assert.equal(starts,0,'the closed owner cannot acquire a later matching child');
});

test('actual spawn acquisition precedes a synchronous first body and any reporter output',async t=>{
  const root=testScratch(t,'tooling-first-body'),file=join(root,'first.test.mjs'),ready=join(root,'ready');
  writeFileSync(file,`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(ready)},'body');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);`);
  let started=0,observedPid=0,output='';const owner=new ToolingEntryActivity(new Set([file]),()=>started++,error=>{throw error;});
  const cancel=owner.watch(file,sample=>{observedPid=sample.processOwn.pid;},error=>{throw error;});
  const child=spawn(process.execPath,[file],{env:fixtureEnvironment(t,{NODE_TEST_CONTEXT:'child-v8'}),stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',bytes=>output+=bytes);const closed=new Promise<void>(done=>child.once('close',()=>done()));
  try{await waitFor('the synchronous first body to enter',()=>existsSync(ready),{stopped:()=>child.exitCode!==null?'child exited':undefined});
    assert.equal(started,2,'actual launch and actual spawn are observed');assert.equal(observedPid,child.pid);assert.equal(output,'');
  }finally{child.kill();await closed;cancel();owner.close();}
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

test('missing spawn identity stays separate from completed product failures',t=>{
  for(const scenario of ['idle','pass','fail']){
    const completed=scenario!=='idle',failed=scenario==='fail';
    const root=testScratch(t,'tooling-missing-entry'),staged=join(root,'staged'),frame=join(root,'instrument.json');
    const ready=join(root,'ready'),release=join(root,'release'),clockReceipt=join(root,'clock.json');
    copyModuleClosure(['tooling/gate/tooling-runner.ts'],staged);
    const owner=join(staged,'tooling/gate/tooling-entry-activity.ts'),source=readFileSync(owner,'utf8'),anchor='this.identities.set(file,';
    assert.equal(source.split(anchor).length,2,'one actual spawn identity boundary');
    writeFileSync(owner,source.replace(anchor,'if(false)this.identities.set(file,'));
    const file=join(root,'missing.test.mjs');
    writeFileSync(file,completed?`import{test}from'node:test';import{watch,writeFileSync,existsSync}from'node:fs';
test('completed without identity',()=>new Promise((resolve,reject)=>{
  const finish=()=>{if(existsSync(${JSON.stringify(release)})){watcher.close();${failed?"reject(Error('definite identity assertion'));":"resolve();"}}};
  const watcher=watch(${JSON.stringify(root)},finish);writeFileSync(${JSON.stringify(ready)},'ready');finish();
}));\n`:
      `import{test}from'node:test';import{createServer}from'node:net';import{writeFileSync}from'node:fs';
test('missing identity',()=>new Promise(()=>createServer().listen(0,'127.0.0.1',()=>writeFileSync(${JSON.stringify(ready)},'ready'))));\n`);
    // Supply only the actual collector's clock/timer effects. Its native
    // activity owner and terminal identity verification remain exercised.
    const collector=join(staged,'tooling/gate/tooling-runner.ts');
    let worker=readFileSync(collector,'utf8');
    const clockAnchor='now:()=>performance.now(),scheduleIdle:(callback,milliseconds)=>{const timer=setTimeout(callback,milliseconds);return()=>clearTimeout(timer);},';
    const entryAnchor='export async function runTooling(';
    const runAnchor="const result=await runTooling(request.files,{idleMs:request.idleMs,execArgv:[...(request.execArgv??[]),'--import',bootstrap],resultEnv});";
    for(const actual of [clockAnchor,entryAnchor,runAnchor])assert.equal(worker.split(actual).length,2,'one collector fixture boundary: '+actual);
    worker=worker.replace(entryAnchor,`let suppliedNow=0,armed=0,delivered=0;
const suppliedTimers=new Set<{callback:()=>void;cancelled:boolean}>();
${entryAnchor}`).replace(clockAnchor,`now:()=>suppliedNow,scheduleIdle:callback=>{
      const task={callback,cancelled:false};suppliedTimers.add(task);armed++;
      return()=>{task.cancelled=true;suppliedTimers.delete(task);};
    },`).replace(runAnchor,`const {watch,existsSync}=await import('node:fs');
      let readyObserved=false,watcherClosed=false;
      const advance=()=>{
        if(readyObserved||!existsSync(${JSON.stringify(ready)}))return;
        readyObserved=true;suppliedNow=TOOLING_IDLE_GUARD_MS+1;
        ${completed?`writeFileSync(${JSON.stringify(release)},'release');`:`const task=[...suppliedTimers].find(task=>!task.cancelled);
        if(!task)throw Error('ready missing-entry fixture has no armed idle timer');
        delivered++;task.callback();`}
      };
      const watcher=watch(${JSON.stringify(root)},advance);
      const closeWatcher=()=>{if(!watcherClosed){watcher.close();watcherClosed=true;}};
      const unregisterFixture=registerCommandCloser('supplied missing-entry clock watcher',{close:closeWatcher});
      let result;
      try{advance();${runAnchor.replace('const result=','result=')}}
      finally{
        closeWatcher();unregisterFixture();
        writeFileSync(${JSON.stringify(clockReceipt)},JSON.stringify({readyObserved,now:suppliedNow,armed,delivered,pending:suppliedTimers.size,watcherClosed}));
      }`);
    writeFileSync(collector,worker);
    const script=`import{runScopedTooling}from ${JSON.stringify(pathToFileURL(collector).href)};
import{PassThrough}from'node:stream';let transcript='';const output=new PassThrough();output.on('data',bytes=>transcript+=bytes);
try{const report=await runScopedTooling([${JSON.stringify(file)}],{fixture:true,output});console.log(JSON.stringify({report,transcript}));}
catch(error){console.log(JSON.stringify({kind:error.kind,message:error.message,transcript}));}`;
    const actual=spawnTest(process.execPath,['--input-type=module','-e',script],{env:fixtureEnvironment(t,{NTS_GATE_STEP:'tooling',NTS_GATE_STEP_ATTEMPT:'missing',NTS_GATE_STEP_RESULT:frame}),encoding:'utf8'},'missing collector spawn result');
    assert.equal(actual.status,0,actual.stderr);const observed=JSON.parse(actual.stdout.trim());
    const supplied=JSON.parse(readFileSync(clockReceipt,'utf8'));
    assert.equal(supplied.readyObserved,true);assert.equal(supplied.now,300001);
    assert.ok(supplied.armed>0,'actual collector arms the supplied idle timer');
    assert.equal(supplied.delivered,completed?0:1);assert.equal(supplied.pending,0);assert.equal(supplied.watcherClosed,true);
    assert.match(observed.transcript,/missing tooling spawn\/activity observation/);assert.doesNotMatch(observed.transcript,/NOT RUN \(hung\)/);
    assert.match(observed.transcript,completed?/at completion/:/at its idle bound/);
    if(failed){
      assert.equal(observed.report.status,1);assert.equal(observed.report.completedFailures,1);
      assert.equal(observed.report.observationFailure.kind,'tooling-setup');
      assert.match(observed.report.observationFailure.reason,/at completion/);
      assert.match(observed.transcript,/definite identity assertion/);assert.equal(existsSync(frame),false,'no INSTRUMENT frame replaces the completed product FAIL');
    }else{
      assert.equal(observed.kind,'tooling-setup');assert.match(observed.message,/without a completed report/);
      assert.equal(JSON.parse(readFileSync(frame,'utf8')).verdict,'INSTRUMENT');
    }
  }
});
