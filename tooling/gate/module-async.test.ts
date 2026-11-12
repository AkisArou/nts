import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {newTestScratch} from './test-scratch.ts';
import {auditModuleAsync,topLevelAwaits,inspectModuleAsync} from './module-async.ts';

test('top-level await is syntax, including false branches and for-await, never nested async work',()=>{
  assert.equal(topLevelAwaits('sample.ts',`if(false) await 0;
for await(const x of []) {}
async function main(){await 0;}
const f=async()=>await 0;
class C{async m(){await 0;}}`).length,2);
  assert.deepEqual(topLevelAwaits('control.ts','async function main(){await 0;} void main(); // await 0'),[]);
});
for(const binding of ["import{Worker as Thread}from'node:worker_threads';", "const{Worker:Thread}=require('node:worker_threads');", "import * as threads from 'node:worker_threads';", "const threads=require('node:worker_threads');"]){
 test('Worker module closure follows '+binding,t=>{
  const root=newTestScratch('worker-module-closure');t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'tooling'));
  const worker=(binding.startsWith('import *')||binding.startsWith('const threads='))?'threads.Worker':'Thread';
  writeFileSync(join(root,'tooling/owner.ts'),binding+`const ENTRY=new URL('./worker.ts',import.meta.url);new ${worker}(ENTRY);`);
  writeFileSync(join(root,'tooling/worker.ts'),`import './helper.ts';`);
  writeFileSync(join(root,'tooling/helper.ts'),'if(false) await 0;');
  const bad=auditModuleAsync(root);assert.deepEqual(bad.entries,['tooling/worker.ts']);assert.match(bad.problems.join('\n'),/helper.ts:1: top-level await/);
  writeFileSync(join(root,'tooling/helper.ts'),'async function main(){await 0;} void main();');
  assert.deepEqual(auditModuleAsync(root).problems,[]);
  writeFileSync(join(root,'tooling/owner.ts'),binding+`new ${worker}(process.argv[2]);`);
  assert.match(auditModuleAsync(root).problems.join('\n'),/Worker entry must be an owned module-relative URL/);
 });
}

test('the existing host parser can lend its root and keep only detached module facts',()=>{
 const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync'),api=new API();
 const source="import {Worker} from 'node:worker_threads'; new Worker(new URL('./job.ts',import.meta.url)); if(false) await 0;";
 const lease=api.createSourceFile('tooling/owner.ts',source);
 let facts;
 try{facts=inspectModuleAsync('/fixture','tooling/owner.ts',source,lease.sourceFile);}finally{lease.dispose();api.close();}
 assert.deepEqual(JSON.parse(JSON.stringify(facts)),{entries:['tooling/job.ts'],imports:[],problems:[],awaits:[1]});
});

for(const statement of ["import './helper.ts';","export * from './helper.ts';","const x=await import('./helper.ts');","const x=require('./helper.ts');","import x=require('./helper.ts');"]){
 test('imported modules are synchronous through '+statement,t=>{
  const root=newTestScratch('import-module-closure');t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'tooling'));
  writeFileSync(join(root,'tooling/entry.ts'),statement);
  writeFileSync(join(root,'tooling/helper.ts'),'if(false) await 0;');
  writeFileSync(join(root,'tooling/command.ts'),'await 0;');
  const bad=auditModuleAsync(root);
  assert.match(bad.problems.join('\n'),/helper.ts:1: top-level await in an imported tooling module/);
  assert.ok(!bad.problems.some(problem=>problem.includes('entry.ts')||problem.includes('command.ts')),'pure entry scripts may await');
  writeFileSync(join(root,'tooling/helper.ts'),'async function main(){await 0;} if(import.meta.main) void main();');
  assert.deepEqual(auditModuleAsync(root).problems,[]);
 });
}

test('path-looking fixture data does not make a command an imported module',t=>{
 const root=newTestScratch('import-module-data');t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'tooling'));
 writeFileSync(join(root,'tooling/entry.ts'),`const fixture="import './command.ts';";`);
 writeFileSync(join(root,'tooling/command.ts'),'await 0;');
 assert.deepEqual(auditModuleAsync(root).problems,[]);
});
