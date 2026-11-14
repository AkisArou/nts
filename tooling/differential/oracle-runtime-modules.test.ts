import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fixtureEnvironment} from '../gate/test-environment.ts';
import {compileRuntimeModules as compile,stripRuntimeSource} from './oracle-runtime-modules.ts';
import {runtimeAssets,runtimeModuleName,RUNTIME_MODULE_LIMIT} from './runtime-paths/main.ts';
import {spawnTest} from '../gate/test-wait.ts';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url),{API}=require('typescript/sync') as typeof import('typescript/sync'),ast=require('typescript/ast') as typeof import('typescript/ast');
function compileRuntimeModules(root:string,entry:string){
  const api=new API();try{return compile(root,entry,{api,ast});}finally{api.close();}
}
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

test('canonical relative imports preserve dotted filenames',t=>{
  const root=fixture(t,{'entry.ts':"export {value} from './.hidden.ts';",'.hidden.ts':'export const value:number=19;'});
  const graph=compileRuntimeModules(root,'entry.ts');
  assert.match(graph.modules.find(module=>module.name==='entry.mjs')!.text,/from "\.\/\.hidden\.mjs"/);
});

test('direct Node stripping and the sealed producer retain identical harness behavior',t=>{
  const source=readFileSync(new URL('./oracle-node-harness.ts',import.meta.url),'utf8');
  const root=fixture(t,{'oracle-node-harness.ts':source}),graph=compileRuntimeModules(root,'oracle-node-harness.ts');
  assert.deepEqual(graph.modules.map(row=>row.name),['oracle-node-harness.mjs']);
  for(const module of graph.modules)writeFileSync(join(root,module.name),module.text);
  const ask=(name:string,strip:boolean)=>{
    const script=`import * as runtime from ${JSON.stringify(pathToFileURL(join(root,name)).href)};
const root='/declared/source',directory=root+'/runtime/node/subject';
const texts=new Map([[directory+'/globals','# comment\\nabort\\nencoding\\n'],[directory+'/uses','sibling/iter\\nsibling\\n']]);
const host={fileExists:path=>texts.has(path),readFile:path=>texts.get(path)??null};
console.log(JSON.stringify({module:runtime.nodeModuleFiles(root,'subject'),globals:runtime.nodeGlobalGroups(directory,host),
global:runtime.nodeGlobalEntry(directory,'abort'),siblings:runtime.nodeSiblingModules(root,directory,host),paths:runtime.nodeHarnessPaths(root,'subject')}));`;
    return spawnTest(process.execPath,[...(strip?[]:['--no-experimental-strip-types']),'--input-type=module','-e',script],{encoding:'utf8',env:fixtureEnvironment(t)});
  };
  const direct=ask('oracle-node-harness.ts',true),sealed=ask('oracle-node-harness.mjs',false);
  for(const result of [direct,sealed])assert.equal(result.status,0,result.stdout+result.stderr);
  assert.deepEqual(JSON.parse(direct.stdout),JSON.parse(sealed.stdout));
  const value=JSON.parse(sealed.stdout);assert.deepEqual(value.globals,['abort','encoding']);assert.equal(value.siblings.length,2);
  writeFileSync(join(root,'oracle-node-harness.ts'),source+'\nexport enum NonErasable { Value=1 }\n');
  assert.throws(()=>compileRuntimeModules(root,'oracle-node-harness.ts'),/oracle runtime module: cannot strip oracle-node-harness\.ts:.*TypeScript enum is not supported/s);
  const refused=ask('oracle-node-harness.ts',true);assert.notEqual(refused.status,0);
  assert.match(refused.stderr,/oracle-node-harness\.ts/);assert.match(refused.stderr,/TypeScript enum is not supported/);
});
