import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createWriteStream,existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {startArgs} from '../../agents/agents.ts';
import {gateEnvironment} from '../canonical-environment.ts';
import {copyModuleClosure} from '../module-closure-fixture.ts';
import {ownMemory} from '../test-memory.ts';
import {fixtureEnvironment} from '../test-environment.ts';
import {testScratch} from '../test-scratch.ts';
import {spawnTest,waitFor} from '../test-wait.ts';
import {generatedJavaScript} from '../generated-javascript.ts';
import {ownUnit} from './bound-slice.ts';

type Summary={verdict:string;interrupted:string|null;scope_cleanup:{state:string};
  diagnostics:{state:string;workersPressure:{observedAt:string;departedAt:string|null}};steps:{verdict:string}[]};

function departureFence(directory:string):string{return generatedJavaScript(`
if (!setupFailure) {
 const fs=await import('node:fs'),{durableRecord}=await import('./durable-record.ts'),directory=${JSON.stringify(directory)};
 await new Promise(resolve=>{
  const finish=()=>{if(fs.existsSync(directory+'/release')){watcher.close();process.off('SIGTERM',cancel);resolve();}};
  const cancel=()=>{durableRecord(directory+'/signal.json',{ownedRootDeparted:scopes.departed()});watcher.close();resolve();};
  const watcher=fs.watch(directory,finish);process.once('SIGTERM',cancel);
  durableRecord(directory+'/ready.json',{group:scopes.group,pressure:diagnostics.report().workersPressure});finish();
 });
}
`);}

for(const arm of ['normal','cancel'] as const)test(`an acquired runner root ${arm==='normal'?'closes green':'departs before named cancellation cleanup without becoming green'}`,async t=>{
  const own=testScratch(t,'runner-root-departure-'+arm),repo=join(own,'repo'),run=join(own,'run'),env=fixtureEnvironment(t);
  copyModuleClosure(['tooling/gate/run.mjs','tooling/gate/durable-record.ts'],repo);
  const entry=join(repo,'tooling/gate/run.mjs'),original=readFileSync(entry,'utf8');
  const marker='if (!setupFailure) {\n  try { await reserveMemory(); }';assert.equal(original.split(marker).length,2);
  // Pause only after the actual root and first pressure endpoint were acquired.
  // There is no active step, and cancellation retains the production signal and
  // summary owners. The normal arm releases the same barrier without a signal.
  const fence=departureFence(own);
  writeFileSync(entry,original.replace(marker,fence+'\n'+marker));
  const listed=spawnTest('sh',[fileURLToPath(new URL('../all.sh',import.meta.url)),'--list'],{cwd:repo,env,encoding:'utf8'});
  assert.equal(listed.status,0,listed.stderr);
  writeFileSync(join(repo,'tooling/gate/all.sh'),`#!/bin/sh
if [ "$1" = --list ]; then
cat <<'NAMES'
${listed.stdout.trim()}
NAMES
else exit 0; fi
`);
  const planned=gateEnvironment(env,{run,owned:{...ownMemory(join(own,'observations'),{pressure:{kind:'live'}}),
    NTS_GATE_STEPS:'old-paths',NTS_GATE_SLOTS:'1',CARGO_TARGET_DIR:join(own,'target')}});
  const name='root-departure-'+randomUUID(),unit='nts-agent-'+name+'.service',parent=ownUnit();assert.ok(parent);
  const command=['/usr/bin/env',...Object.entries(planned.env).filter(([,value])=>value!==undefined).map(([name,value])=>name+'='+value),process.execPath,entry];
  const args=startArgs(name,command,env,repo);args.splice(args.indexOf('--'),0,'--wait','--pipe','-p','PartOf='+parent);
  const output=createWriteStream(join(own,'runner.log')),child=spawn('systemd-run',args,{cwd:repo,env,stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(output,{end:false});child.stderr.pipe(output,{end:false});
  let result:{code:number|null;signal:NodeJS.Signals|null}|undefined;
  const closed=new Promise<NonNullable<typeof result>>((done,reject)=>{
    child.once('error',reject);output.once('error',reject);
    child.once('close',(code,signal)=>output.end(()=>{result={code,signal};done(result);}));
  });
  const stop=()=>{const answer=spawnTest('systemctl',['--user','stop',unit],{env,encoding:'utf8'});assert.equal(answer.status,0,answer.stderr);};
  t.after(async()=>{if(!result)stop();await closed;});
  try{
  await waitFor('the actual runner to acquire its worker endpoint before any step',()=>existsSync(join(own,'ready.json')),
    {stopped:()=>result?JSON.stringify(result):undefined});
  const ready=JSON.parse(readFileSync(join(own,'ready.json'),'utf8')) as {pressure:{departedAt:string|null}};
  assert.ok(ready.pressure);assert.equal(ready.pressure.departedAt,null);
  if(arm==='normal')writeFileSync(join(own,'release'),'release');else stop();
  const exit=await closed,summary=JSON.parse(readFileSync(join(run,'summary.json'),'utf8')) as Summary;
  assert.equal(summary.scope_cleanup.state,'complete');assert.equal(summary.diagnostics.state,'complete');
  if(arm==='normal'){
    assert.equal(exit.code,0);assert.equal(summary.verdict,'green');assert.equal(summary.interrupted,null);
    assert.equal(summary.diagnostics.workersPressure.departedAt,null);
  }else{
    const signal=JSON.parse(readFileSync(join(own,'signal.json'),'utf8')) as {ownedRootDeparted:boolean};
    assert.equal(signal.ownedRootDeparted,true);assert.equal(exit.code,143);assert.equal(summary.interrupted,'signal SIGTERM');
    assert.notEqual(summary.verdict,'green');assert.ok(summary.steps.every(step=>step.verdict!=='PASS'));
    assert.ok(summary.diagnostics.workersPressure.departedAt);
    assert.ok(summary.diagnostics.workersPressure.observedAt<=summary.diagnostics.workersPressure.departedAt);
  }
  t.diagnostic(JSON.stringify({arm,exit,verdict:summary.verdict,interrupted:summary.interrupted,cleanup:summary.scope_cleanup,
    diagnostics:summary.diagnostics.state,workersPressure:summary.diagnostics.workersPressure}));
  }finally{
    // Drain before testScratch/fixtureEnvironment's teardown hooks can remove
    // files still used by the runner or its resource reporters.
    try{if(!result)stop();}finally{await closed;}
  }
});

test('departure readiness and signal records stay private until payload output completes',async t=>{
 const own=testScratch(t,'departure-record-publication'),repo=join(own,'repo'),env=fixtureEnvironment(t);
 copyModuleClosure(['tooling/gate/durable-record.ts'],repo);
 const entry=join(repo,'tooling/gate/departure-publication.mjs');
 writeFileSync(entry,generatedJavaScript(`import * as fs from 'node:fs';
import {mock} from 'node:test';
let opened=0;
const put=(target,bytes,options)=>{
 const borrowed=typeof target==='number',fd=borrowed?target:fs.openSync(target,'w');
 try{
  process.stdout.write(JSON.stringify({opened:++opened})+'\\n');
  fs.readSync(0,Buffer.alloc(1),0,1,null);
  fs.writeFileSync(fd,bytes,options);
 }finally{if(!borrowed)fs.closeSync(fd);}
};
const facade={...fs.default,writeFileSync:put},exports={...fs,default:facade,writeFileSync:put};
if('module.exports' in exports)exports['module.exports']=facade;
mock.module('node:fs',{exports});
const setupFailure=false,scopes={group:'owned-group',departed:()=>true},diagnostics={report:()=>({workersPressure:{departedAt:null}})};
`)+departureFence(own));
 const name='departure-publication-'+randomUUID(),unit='nts-agent-'+name+'.service',parent=ownUnit();assert.ok(parent);
 const args=startArgs(name,[process.execPath,'--experimental-test-module-mocks',entry],env,repo);
 args.splice(args.indexOf('--'),0,'--wait','--pipe','-p','PartOf='+parent);
 const child=spawn('systemd-run',args,{cwd:repo,env,stdio:['pipe','pipe','pipe']});
 let output='',ended=false;const opened:number[]=[];
 child.stderr.on('data',bytes=>output+=String(bytes));
 createInterface({input:child.stdout}).on('line',line=>{opened.push((JSON.parse(line) as {opened:number}).opened);});
 const closed=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{
  child.once('error',reject);child.once('close',(code,signal)=>{ended=true;resolve({code,signal});});
 });
 const ctl=(verb:string)=>{const result=spawnTest('systemctl',['--user',verb,...(verb==='kill'?['--signal=SIGTERM']:[]),unit],{env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);};
 try{
  for(const [index,name]of ['ready.json','signal.json'].entries()){
   await waitFor('departure publisher opened '+name,()=>opened.length>index,{stopped:()=>ended?output||'publisher exited':undefined});
   assert.equal(opened[index],index+1);const target=join(own,name);
   assert.equal(existsSync(target),false,'the final departure record is absent while its payload is incomplete');
   const pending=readdirSync(own).filter(file=>file.startsWith(name+'.'));assert.equal(pending.length,1);
   assert.equal(readFileSync(join(own,pending[0]!)).length,0,'the producer is paused before any payload byte');
   child.stdin.write('x');
   await waitFor('complete departure publication '+name,()=>existsSync(target),{stopped:()=>ended?output||'publisher exited':undefined});
   const value=JSON.parse(readFileSync(target,'utf8'));
   assert.deepEqual(value,index===0?{group:'owned-group',pressure:{departedAt:null}}:{ownedRootDeparted:true});
   if(index===0)ctl('kill');
  }
  assert.deepEqual(await closed,{code:0,signal:null},output);
  assert.deepEqual(readdirSync(own).filter(file=>/^((ready|signal)\.json)\./.test(file)),[]);
 }finally{
  if(!ended){
   // Deliver EOF to the paused publisher before a synchronous unit-stop wait.
   await new Promise<void>(resolve=>child.stdin.end(resolve));
   if(!ended)ctl('stop');
  }
  await closed;
 }
});
