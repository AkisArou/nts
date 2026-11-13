import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {testScratch} from './test-scratch.ts';
import {testEnvironment} from './test-environment.ts';
import {CommandLifetime,COMMAND_CLOSE_MS} from '../differential/command-entry/main.ts';
import {waitFor} from './test-wait.ts';

const helper=new URL('../differential/command-entry/main.ts',import.meta.url).href;
function run(file:string){return spawnSync(process.execPath,[file],{env:testEnvironment(),encoding:'utf8'});}

test('the shared entry accepts sync and async statuses and preserves a command-owned status',t=>{
 const root=testScratch(t,'command-entry-status');
 for(const [name,body] of [['sync','return 7;'],['async','await Promise.resolve(); return 7;'],['owned','process.exitCode=7;']] as const){
  const file=join(root,name+'.mjs');
  writeFileSync(file,`import {runAsCommand} from ${JSON.stringify(helper)};runAsCommand(import.meta.url,${name==='async'?'async ':''}()=>{process.stdout.write('ran');${body}});`);
  const result=run(file);assert.equal(result.status,7,result.stderr);assert.equal(result.stdout,'ran');assert.equal(result.stderr,'');
 }
});

test('the shared entry reports synchronous throws and rejected commands once with exit one',t=>{
 const root=testScratch(t,'command-entry-error');
 for(const async of [false,true]){
  const file=join(root,'error-'+async+'.mjs');
  writeFileSync(file,`import {runAsCommand} from ${JSON.stringify(helper)};runAsCommand(import.meta.url,${async?'async ':''}()=>{throw Error('command failed');});`);
  const result=run(file);assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr.match(/Error: command failed/g)?.length,1);
 }
});

test('an unsettled command fails at event-loop drain with the top-level-await exit code',t=>{
 const root=testScratch(t,'command-entry-unsettled'),file=join(root,'unsettled.mjs'),control=join(root,'top-level.mjs');
 writeFileSync(control,'await new Promise(()=>{});');
 writeFileSync(file,`import {runAsCommand} from ${JSON.stringify(helper)};runAsCommand(import.meta.url,()=>new Promise(()=>{}));`);
 const original=run(control),result=run(file);
 assert.equal(original.status,13,original.stderr);assert.equal(result.status,original.status,result.stderr);
 assert.equal(result.stdout,'');assert.match(result.stderr,/INSTRUMENT: command entry .*unsettled\.mjs: main did not settle before the event loop drained/);
});

test('a command settled by a beforeExit listener completes like top-level await',t=>{
 const root=testScratch(t,'command-entry-drain-completion'),file=join(root,'completion.mjs'),control=join(root,'top-level.mjs');
 const body="await new Promise(resolve=>process.once('beforeExit',resolve));";
 writeFileSync(control,body);
 writeFileSync(file,`import {runAsCommand} from ${JSON.stringify(helper)};runAsCommand(import.meta.url,async()=>{${body}});`);
 for(const path of [control,file]){const result=run(path);assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');}
});

test('an imported command remains synchronous and does not run its body; symlink entry semantics are explicit',t=>{
 const root=testScratch(t,'command-entry-import'),subject=join(root,'subject.mjs'),loader=join(root,'loader.cjs'),alias=join(root,'alias.mjs');
 const source=(realpath:boolean)=>`import {runAsCommand} from ${JSON.stringify(helper)};runAsCommand(import.meta.url,async()=>{process.stdout.write('ran');return 7;},{realpath:${realpath}});`;
 writeFileSync(subject,source(false));writeFileSync(loader,`require(${JSON.stringify(subject)});process.stdout.write('imported');`);symlinkSync(subject,alias);
 const imported=run(loader);assert.equal(imported.status,0,imported.stderr);assert.equal(imported.stdout,'imported');
 assert.equal(run(alias).stdout,'','ordinary commands retain their exact entry path');
 writeFileSync(subject,source(true));const followed=run(alias);assert.equal(followed.status,7,followed.stderr);assert.equal(followed.stdout,'ran');
});

test('the four oracle command libraries can be required synchronously',t=>{
 const root=testScratch(t,'oracle-command-import'),loader=join(root,'loader.cjs');
 const modules=['../differential/oracle-emit.ts','../differential/oracle-dependencies.ts','../differential/oracle-resolution.ts','../inputs/dependency-inputs.ts'].map(path=>new URL(path,import.meta.url).pathname);
 writeFileSync(loader,modules.map(path=>`require(${JSON.stringify(path)});`).join('\n')+`process.stdout.write('imported');`);
 const result=run(loader);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'imported');
});

function lifetimeFixture(){
 const reports:string[]=[],exits:number[]=[];let fire=()=>{},arms=0,cancelled=0;
 const lifetime=new CommandLifetime({report:line=>reports.push(line),exit:code=>exits.push(code),arm:(callback,ms)=>{
  assert.equal(ms,COMMAND_CLOSE_MS);arms++;fire=callback;return()=>{cancelled++;};
 }});
 return {lifetime,reports,exits,fire:()=>fire(),get arms(){return arms;},get cancelled(){return cancelled;}};
}

test('one signal drain stops acquisition before retiring the worker and closing its broker',async()=>{
 const f=lifetimeFixture(),events:string[]=[];let open=true;
 f.lifetime.register('broker',{cancel:()=>events.push('stop accepting'),close:()=>{
  assert.ok(events.includes('retired'));open=false;events.push('broker closed');
 }});
 f.lifetime.register('worker',{cancel:()=>events.push('stop worker'),close:async()=>{
  assert.deepEqual(events,['stop accepting','stop worker']);
  await Promise.resolve();assert.equal(open,true,'the final retirement still has its reply transport');events.push('retired');
 }});
 const closed=f.lifetime.close(143,{kind:'signal',signal:'SIGTERM'});
 assert.equal(f.lifetime.close(0),closed);assert.equal(f.lifetime.close(130,{kind:'signal',signal:'SIGINT'}),closed);
 assert.equal(await closed,143);assert.deepEqual(events,['stop accepting','stop worker','retired','broker closed']);
 assert.equal(f.arms,1);assert.equal(f.cancelled,1);assert.deepEqual(f.reports,[]);
});

test('a closer registered during cancellation joins the same terminal drain',async()=>{
 const f=lifetimeFixture(),events:string[]=[];
 f.lifetime.register('outer',{cancel:()=>{
  f.lifetime.register('late worker',{cancel:()=>events.push('late stopped'),close:()=>{events.push('late closed');}});
 },close:()=>{events.push('outer closed');}});
 assert.equal(await f.lifetime.close(129,{kind:'signal',signal:'SIGHUP'}),129);
 assert.deepEqual(events,['late stopped','late closed','outer closed']);assert.equal(f.arms,1);
 assert.throws(()=>f.lifetime.register('too late',{close(){}}),/resource acquired after shutdown: too late/);
});

test('cleanup failures retain their names and do not erase an original command failure',async()=>{
 const f=lifetimeFixture();
 f.lifetime.register('broker',{close(){throw Error('broker failure');}});
 f.lifetime.register('worker',{cancel(){throw Error('cancel failure');},close(){throw Error('worker failure');}});
 assert.equal(await f.lifetime.close(7,{kind:'failure'}),7);
 assert.equal(f.reports.length,3);
 assert.match(f.reports[0]!,/worker cancellation: Error: cancel failure/);
 assert.match(f.reports[1]!,/worker: Error: worker failure/);assert.match(f.reports[2]!,/broker: Error: broker failure/);
});

test('a wedged closer spends one total bound and names the resources left',async()=>{
 const f=lifetimeFixture();
 f.lifetime.register('broker',{close(){assert.fail('a wedged worker has not retired');}});
 f.lifetime.register('worker',{close:()=>new Promise(()=>{})});
 const closed=f.lifetime.close(0);f.fire();assert.equal(await closed,2);
 assert.deepEqual(f.exits,[2]);assert.match(f.reports[0]!,/did not finish within 300000 ms; remaining: broker, worker/);
 assert.equal(f.lifetime.close(0),closed);f.fire();assert.deepEqual(f.exits,[2]);assert.equal(f.arms,1);
});

test('normal and rejected command bodies await their named closers',t=>{
 const root=testScratch(t,'command-close-return');
 for(const failed of [false,true]){
  const file=join(root,String(failed)+'.mjs');
  writeFileSync(file,`import {runAsCommand,registerCommandCloser} from ${JSON.stringify(helper)};
runAsCommand(import.meta.url,()=>{registerCommandCloser('owned',{close:async()=>{await Promise.resolve();process.stdout.write('closed');${failed?"throw Error('cleanup failed');":''}}});${failed?"throw Error('body failed');":"process.stdout.write('body;');return 7;"}});`);
  const result=run(file);assert.equal(result.status,failed?1:7,result.stderr);
  assert.equal(result.stdout,failed?'closed':'body;closed');
  if(failed){assert.match(result.stderr,/Error: body failed/);assert.match(result.stderr,/command cleanup owned: Error: cleanup failed/);}
 }
});

test('an unsettled main drains its unref resource and decides exit13 only at actual exit',t=>{
 const root=testScratch(t,'command-pending-resource');
 for(const settled of [false,true]){
  const file=join(root,String(settled)+'.mjs');
  writeFileSync(file,`import {runAsCommand,registerCommandCloser} from ${JSON.stringify(helper)};
runAsCommand(import.meta.url,async()=>{
 registerCommandCloser('unref resource',{close:async()=>{await Promise.resolve();process.stdout.write('closed');}});
 ${settled?"await new Promise(resolve=>process.once('beforeExit',resolve));return 7;":"await new Promise(()=>{});"}
});`);
  const result=run(file);assert.equal(result.stdout,'closed');assert.equal(result.status,settled?7:13,result.stderr);
  if(settled)assert.equal(result.stderr,'');else assert.match(result.stderr,/main did not settle before the event loop drained/);
 }
});

test('a real SIGTERM keeps the broker alive for its worker retirement and exits 143',async t=>{
 const root=testScratch(t,'command-signal-retirement'),file=join(root,'subject.mjs'),ready=join(root,'ready.json'),done=join(root,'done.json');
 writeFileSync(file,`import assert from 'node:assert/strict';import {createServer,connect} from 'node:net';import {once} from 'node:events';
import {durableRecord} from ${JSON.stringify(new URL('./durable-record.ts',import.meta.url).href)};
import {runAsCommand,registerCommandCloser} from ${JSON.stringify(helper)};
runAsCommand(import.meta.url,async()=>{
 let accepting=true,retired=false;let cancel;const stop=new Promise(resolve=>{cancel=resolve;});
 const server=createServer(socket=>{socket.on('data',bytes=>{assert.equal(bytes.toString(),'retire');socket.end('retired');});});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 registerCommandCloser('broker',{cancel:()=>{accepting=false;},close:async()=>{assert.equal(retired,true);server.close();await once(server,'close');}});
 const peer=connect(server.address().port,'127.0.0.1');await once(peer,'connect');
 registerCommandCloser('worker',{cancel:()=>cancel(),close:async()=>{
  assert.equal(accepting,false);peer.write('retire');assert.equal((await once(peer,'data'))[0].toString(),'retired');await once(peer,'close');retired=true;durableRecord(${JSON.stringify(done)},{retired});
 }});
 durableRecord(${JSON.stringify(ready)},{ready:true});await stop;
});`);
 const unit='nts-command-retirement-'+randomUUID();
 t.after(()=>spawnSync('systemctl',['--user','stop',unit],{env:testEnvironment(),stdio:'ignore'}));
 const child=spawn('systemd-run',['--user','--wait','--pipe','--collect','--unit='+unit,'-p','LimitCORE=0','--','taskset','-c','0-3,6-31',process.execPath,file],{env:testEnvironment(),stdio:['ignore','pipe','pipe']});
 let output='',ended=false;child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
 const closed=new Promise<number|null>((resolve,reject)=>{child.once('error',error=>{ended=true;reject(error);});child.once('close',code=>{ended=true;resolve(code);});});
 await waitFor('the retirement command to be ready',()=>existsSync(ready),{stopped:()=>ended?'subject ended: '+output:undefined});
 const sent=spawnSync('systemctl',['--user','kill','--signal=SIGTERM',unit],{env:testEnvironment(),encoding:'utf8'});assert.equal(sent.status,0,sent.stderr);
 assert.equal(await closed,143,output);assert.deepEqual(JSON.parse(readFileSync(done,'utf8')),{retired:true});
});
