import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fixtureEnvironment} from '../gate/test-environment.ts';
import {compileRuntimeModules,stripRuntimeSource} from './oracle-runtime-modules.ts';
import {runtimeAssets,runtimeModuleName,RUNTIME_MODULE_LIMIT} from './runtime-paths/main.ts';

function fixture(t:{after(callback:()=>void):void},files:Record<string,string>){
  const root=mkdtempSync(join(tmpdir(),'runtime-modules-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const [name,text] of Object.entries(files)){const file=join(root,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);}
  return root;
}
test('emitted graphs follow nested imports, re-exports and literal import after stripping',t=>{
  const root=fixture(t,{
    'entry.ts':"import /* keep */ {value} from './nested/export.ts'; const unused=\"./not-an-import.ts\"; console.log(value, (await import('./nested/leaf.ts')).other,unused);\n",
    'nested/export.ts':"export {value} from './leaf.ts'; export type {Never} from './missing.ts';\n",
    'nested/leaf.ts':'export const value:number=19,other=23;\n',
  });
  const graph=compileRuntimeModules(root,'entry.ts');
  assert.deepEqual(graph.modules.map(module=>module.name),['entry.mjs','nested/export.mjs','nested/leaf.mjs']);
  const output=join(root,'output');
  for(const module of graph.modules){const file=join(output,module.name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,module.text);}
  assert.match(readFileSync(join(output,'entry.mjs'),'utf8'),/import \/\* keep \*\//);
  const run=spawnSync(process.execPath,['--no-experimental-strip-types',join(output,graph.entry)],{encoding:'utf8',env:fixtureEnvironment(t)});
  assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19 23 ./not-an-import.ts\n');
  writeFileSync(join(root,'nested/leaf.ts'),'export const value:number=29,other=31;\n');
  const next=compileRuntimeModules(root,'entry.ts');
  assert.notEqual(next.modules.find(module=>module.name==='nested/leaf.mjs')!.sourceSha256,graph.modules.find(module=>module.name==='nested/leaf.mjs')!.sourceSha256,'a publication never reuses stale source bytes');
});

test('runtime closure refuses computed, external, aliased, escaping and unsupported module reach',t=>{
  const root=fixture(t,{'entry.ts':'','leaf.ts':'export const value=19;','outside.ts':'export const value=23;'});
  const sources=["import(name);","import 'external-package';","import './nested/../leaf.ts';","import '../outside.ts';","import './leaf.ts?query';","import './alias.ts';","import './legacy.cjs';"];
  symlinkSync(join(root,'leaf.ts'),join(root,'alias.ts'));writeFileSync(join(root,'legacy.cjs'),'module.exports=19;');
  for(const source of sources){writeFileSync(join(root,'entry.ts'),source);assert.throws(()=>compileRuntimeModules(root,'entry.ts'),/oracle runtime module:/,source);}
});

test('canonical module manifests cannot change their entry or escape the published directory',()=>{
  const hash='a'.repeat(64);
  assert.equal(runtimeAssets({'nested/main.mjs':hash},['nested/main.mjs']),true);
  for(const name of ['/main.mjs','../main.mjs','nested/../main.mjs','nested//main.mjs','./main.mjs','nested\\main.mjs','main.mjs?x','main.mjs#x','%2e%2e/main.mjs']){
    assert.equal(runtimeModuleName(name),false,name);assert.equal(runtimeAssets({[name]:hash},[]),false,name);
  }
  assert.equal(runtimeAssets({'main.mjs':hash},['required.mjs']),false);
  assert.equal(runtimeAssets({'main.mjs':'wrong'},['main.mjs']),false);
});

test('the pinned child bootstrap is exactly its reviewed JavaScript source',()=>{
  const record=JSON.parse(readFileSync(new URL('./oracle-toolchain.json',import.meta.url),'utf8'));
  const argument=record.execution.args[record.execution.args.indexOf('--import')+1];
  assert.equal(decodeURIComponent(argument.slice('data:text/javascript,'.length)),stripRuntimeSource(readFileSync(new URL('./oracle-child-bootstrap.ts',import.meta.url),'utf8'))+'\nawait startOracleChild();\n');
});

test('the producer refuses an over-limit graph before publishing any modules',t=>{
  const files:Record<string,string>={};
  for(let index=0;index<=RUNTIME_MODULE_LIMIT;index++)files['module-'+index+'.ts']=index===RUNTIME_MODULE_LIMIT?'export const value=19;':"export * from './module-"+(index+1)+".ts';";
  const root=fixture(t,files);
  assert.throws(()=>compileRuntimeModules(root,'module-0.ts'),/oracle runtime module: module limit 128 exceeded/);
});
