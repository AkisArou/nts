import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createWriteStream,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startArgs} from '../../agents/agents.ts';
import {gateEnvironment} from '../canonical-environment.ts';
import {copyModuleClosure} from '../module-closure-fixture.ts';
import {ownMemory} from '../test-memory.ts';
import {fixtureEnvironment} from '../test-environment.ts';
import {testScratch} from '../test-scratch.ts';
import {spawnTest,waitFor} from '../test-wait.ts';
import {ownUnit} from './bound-slice.ts';

type Summary={verdict:string;interrupted:string|null;scope_cleanup:{state:string};
  diagnostics:{state:string;workersPressure:{observedAt:string;departedAt:string|null}};steps:{verdict:string}[]};

for(const arm of ['normal','cancel'] as const)test(`an acquired runner root ${arm==='normal'?'closes green':'departs before named cancellation cleanup without becoming green'}`,async t=>{
  const own=testScratch(t,'runner-root-departure-'+arm),repo=join(own,'repo'),run=join(own,'run'),env=fixtureEnvironment(t);
  copyModuleClosure(['tooling/gate/run.mjs'],repo);
  const entry=join(repo,'tooling/gate/run.mjs'),original=readFileSync(entry,'utf8');
  const marker='if (!setupFailure) {\n  try { await reserveMemory(); }';assert.equal(original.split(marker).length,2);
  // Pause only after the actual root and first pressure endpoint were acquired.
  // There is no active step, and cancellation retains the production signal and
  // summary owners. The normal arm releases the same barrier without a signal.
  const fence=`
if (!setupFailure) {
 const fs=await import('node:fs'),directory=${JSON.stringify(own)};
 await new Promise(resolve=>{
  const finish=()=>{if(fs.existsSync(directory+'/release')){watcher.close();process.off('SIGTERM',cancel);resolve();}};
  const cancel=()=>{fs.writeFileSync(directory+'/signal.json',JSON.stringify({ownedRootDeparted:scopes.departed()}));watcher.close();resolve();};
  const watcher=fs.watch(directory,finish);process.once('SIGTERM',cancel);
  fs.writeFileSync(directory+'/ready.json',JSON.stringify({group:scopes.group,pressure:diagnostics.report().workersPressure}));finish();
 });
}
`;
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
});
