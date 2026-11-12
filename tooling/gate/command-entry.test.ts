import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {testScratch} from './test-scratch.ts';
import {testEnvironment} from './test-environment.ts';

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
