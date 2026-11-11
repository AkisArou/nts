import {fixtureEnvironment} from "../gate/test-environment.ts";
// The Node oracle's emission and preparation (oracle-emit.ts): standalone
// emission, generated child bootstrap bytes, prepared Node routes, snapshot
// boundaries and aggregate owners. Shared helpers are in
// oracle-emit-fixture.ts.
import * as oracleOwner from './oracle-emit.ts';
import assert from "node:assert/strict";
import {activeCommand} from "../gate/active-command.ts";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {chmodSync,appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {test} from "node:test";
import {pathToFileURL} from "node:url";
import {OracleWorker,TypeScriptDiagnosticError,REPOSITORY,verifyToolchain,oracleLoaderReady,oracleRuntimeFile} from "./oracle-emit.ts";
import {type HostObservation} from './oracle-filesystem.ts';
import {toolchain,oracleExecution,prepareOracle,workspace,execute,prepare} from './oracle-emit-fixture.ts';

test('standalone project emission retains owner graphs and module formats without a Program',async t=>{
  for(const format of ['esnext','module','commonjs'] as const)await t.test(format,async()=>{
    const root=workspace(t,{
      'src/main.ts':format==='commonjs'?'console.log(19);\n':"import {value} from './value.js';console.log(value);\n",
      'src/value.ts':'export const value:number=19;\n',
      'package.json':JSON.stringify(format==='commonjs'?{}:{type:'module'}),
    },format==='esnext'?{}:{module:'NodeNext',moduleResolution:'NodeNext'});
    const worker=new OracleWorker(join(root,'producer'),toolchain);
    try{
      const owner=await worker.prepareTranspiled({entry:join(root,'src/main.ts'),project:join(root,'tsconfig.json'),directory:join(root,'fast')});
      const execution=oracleExecution(owner),actual=execute(root,execution);
      assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'19\n');
      assert.deepEqual(oracleLoaderReady(execution),{ready:true});
      assert.deepEqual(oracleOwner.finishOracleSnapshot(execution),{ready:true});
      const stored=JSON.parse(readFileSync(owner.manifest,'utf8'));
      assert.equal(stored.groups.length,1);
      assert.equal(Object.keys(stored.sources).length,format==='commonjs'?1:2);
      const proof=JSON.parse(readFileSync(join(dirname(owner.manifest),'program/transpile-result.json'),'utf8'));
      assert.equal(proof.producer,'transpileModule');
      assert.equal(proof.proof.sourceEdges.length,format==='commonjs'?1:2);
      assert.equal(proof.proof.beforeDiagnostics,undefined,'standalone emission never invents a checking certificate');
      assert.equal(existsSync(join(dirname(owner.manifest),'program/program-request.json')),false);
      const reference=await worker.prepare({entry:join(root,'src/main.ts'),project:join(root,'tsconfig.json'),directory:join(root,'checked')});
      const checked=JSON.parse(readFileSync(reference.manifest,'utf8'));
      for(const [source,output] of Object.entries(stored.sources) as [string,string][]){
        assert.equal(readFileSync(join(dirname(owner.manifest),output),'utf8'),readFileSync(join(dirname(reference.manifest),checked.sources[source]),'utf8'),'standalone bytes match the owner Program for '+source);
      }
    }finally{worker.close();}
  });
});

test('standalone project emission refuses a type-directed const enum by name',async t=>{
  const root=workspace(t,{'src/main.ts':'const enum Value { Answer=19 };console.log(Value.Answer);\n'});
  const worker=new OracleWorker(join(root,'producer'),toolchain);
  try{
    await assert.rejects(worker.prepareTranspiled({entry:join(root,'src/main.ts'),project:join(root,'tsconfig.json'),directory:join(root,'fast')}),/requires type-directed const-enum emission/);
  }finally{worker.close();}
});

test('standalone emission visits only the selected import closure in each owner',async t=>{
  const root=workspace(t,{
    'src/main.ts':"import {value} from './nested/value.ts';console.log(value);\n",
    'src/late.ts':'export const late:number=19;\n',
    'src/unrelated.ts':'const enum Unrelated { Value=23 };export const unused=Unrelated.Value;\n',
    'src/nested/tsconfig.json':JSON.stringify({compilerOptions:{target:'ESNext',module:'ESNext',moduleResolution:'Bundler',rootDir:'.',rewriteRelativeImportExtensions:true},include:['*.ts']}),
    'src/nested/value.ts':"import {late} from '../late.ts';export const value:number=late;\n",
    'src/nested/unrelated.ts':'const enum Unrelated { Value=29 };export const unused=Unrelated.Value;\n',
  });
  const worker=new OracleWorker(join(root,'producer'),toolchain);
  try{
    const owner=await worker.prepareTranspiled({entry:join(root,'src/main.ts'),project:join(root,'tsconfig.json'),directory:join(root,'fast')});
    const stored=JSON.parse(readFileSync(owner.manifest,'utf8'));
    assert.deepEqual(Object.keys(stored.sources).sort(),['src/late.ts','src/main.ts','src/nested/value.ts'].map(file=>join(root,file)).sort());
    for(const directory of ['program','owner-1']){
      const proof=JSON.parse(readFileSync(join(dirname(owner.manifest),directory,'transpile-result.json'),'utf8')) as {inventory:{path:string}[]};
      assert.equal(proof.inventory.some(file=>file.path.endsWith('/unrelated.ts')),false);
    }
    assert.equal(stored.observations.some((fact:HostObservation)=>fact.kind==='file'&&fact.path.endsWith('/unrelated.ts')),false);
    const execution=oracleExecution(owner),actual=execute(root,execution);
    assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'19\n');
    assert.deepEqual(oracleLoaderReady(execution),{ready:true});
    assert.deepEqual(oracleOwner.finishOracleSnapshot(execution),{ready:true});
  }finally{worker.close();}
});

test('standalone emission retains type facts without publishing erased imports',async t=>{
  const root=workspace(t,{
    'src/main.ts':"import type {Value} from './types.ts'; const x:Value={value:19};console.log(x.value);\n",
    'src/types.ts':'export interface Value {value:number}\n',
    'src/ambient.d.ts':'declare const enum Ambient { Value=23 }\n',
  });
  const worker=new OracleWorker(join(root,'producer'),toolchain);
  try{
    const owner=await worker.prepareTranspiled({entry:join(root,'src/main.ts'),project:join(root,'tsconfig.json'),directory:join(root,'fast')});
    const stored=JSON.parse(readFileSync(owner.manifest,'utf8'));
    assert.equal(stored.sources[join(root,'src/types.ts')],undefined);
    assert.equal(stored.observations.some((fact:HostObservation)=>fact.kind==='file'&&fact.path===join(root,'src/types.ts')),true);
    const execution=oracleExecution(owner),actual=execute(root,execution);
    assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'19\n');
    assert.deepEqual(oracleLoaderReady(execution),{ready:true});assert.deepEqual(oracleOwner.finishOracleSnapshot(execution),{ready:true});
  }finally{worker.close();}
});

test('a standalone producer emits the ordinary entry declared by an explicit project',async t=>{
  const root=workspace(t,{'src/main.ts':'console.log(19);\n'});
  mkdirSync(join(root,'selected'));
  const project=join(root,'selected/tsconfig.json');
  writeFileSync(project,JSON.stringify({compilerOptions:{module:'ESNext',target:'ESNext',rootDir:'../src'},files:['../src/main.ts']}));
  const worker=new OracleWorker(join(root,'producer'),toolchain);
  try{
    const owner=await worker.prepareTranspiled({entry:join(root,'src/main.ts'),project,directory:join(root,'fast')});
    const execution=oracleExecution(owner),actual=execute(root,execution);
    assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'19\n');
    assert.deepEqual(oracleLoaderReady(execution),{ready:true});assert.deepEqual(oracleOwner.finishOracleSnapshot(execution),{ready:true});
  }finally{worker.close();}
});

test('a standalone producer captures a rewritten literal missing-module request',async t=>{
  const root=workspace(t,{'src/main.ts':"export async function run(){try{await import('./missing.ts');}catch(error){return error&&typeof error==='object'&&'code' in error?error.code:'other';}}\nconsole.log(await run());\n"});
  const worker=new OracleWorker(join(root,'producer'),toolchain);
  try{
    const owner=await worker.prepareTranspiled({entry:join(root,'src/main.ts'),project:join(root,'tsconfig.json'),directory:join(root,'fast')});
    const execution=oracleExecution(owner),actual=execute(root,execution);
    assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'ERR_MODULE_NOT_FOUND\n');
    assert.deepEqual(oracleLoaderReady(execution),{ready:true});assert.deepEqual(oracleOwner.finishOracleSnapshot(execution),{ready:true});
  }finally{worker.close();}
});

test('a TypeScript import of an emitted mjs sibling has a complete owned domain',async t=>{
  for(const typed of [false,true])await t.test(typed?'TypeScript owner output':'JavaScript sibling',async()=>{
    const root=workspace(t,{
      'src/main.ts':"import {value} from './value.mjs';console.log(value);\n",
      'src/value.mjs':typed?'export const value=23;\n':'export const value=19;\n',
      ...(typed?{'src/value.mts':'export const value:number=19;\n'}:{}),
    },typed?{}:{allowJs:true,checkJs:false});
    const prepared=await prepare(root),actual=execute(root,prepared);
    assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'19\n');
    assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
    assert.deepEqual(oracleOwner.finishOracleSnapshot(prepared),{ready:true});
  });
});

test('an unused captured module with a nonlocal file URL does not abort preparation',async t=>{
  for(const mode of ['builtin-unused','foreign-unused','foreign-used'] as const)await t.test(mode,async()=>{
    const foreign=mode!=='builtin-unused',used=mode==='foreign-used';
    const body=used?`try{await import('./unused.mjs');}catch(error){console.log(JSON.stringify({name:error.name,properties:Object.fromEntries(Object.getOwnPropertyNames(error).filter(key=>key!=='stack').map(key=>[key,error[key]]))}));}\n`:'console.log(19);\n';
    const root=workspace(t,{'app/main.mjs':body,
      'app/unused.mjs':foreign?'import "file://hmm.js";\n':'import "node:path";\n'});
    const entry=join(root,'app/main.mjs'),prepared=await prepareOracle({entry,project:null,
      runtimeRoots:[join(root,'app')],directory:join(root,'prepared'),toolchain});
    const file=oracleRuntimeFile(prepared,entry),reference=spawnSync(process.execPath,[file],{env:fixtureEnvironment(t),cwd:root,encoding:'utf8'});
    const actual=spawnSync(process.execPath,[...prepared.args,file],
      {cwd:root,env:{...fixtureEnvironment(t),...prepared.env},encoding:'utf8'});
    assert.equal(reference.status,0,reference.stderr);
    assert.equal(actual.status,reference.status,actual.stderr);assert.equal(actual.stdout,reference.stdout);assert.equal(actual.stderr,reference.stderr);
    if(used)assert.match(actual.stdout,/ERR_INVALID_FILE_URL_HOST/);else assert.equal(actual.stdout,'19\n');
    assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
    assert.deepEqual(oracleOwner.finishOracleSnapshot(prepared),{ready:true});
  });
});

test('generated child bootstrap bytes are checked before their module body evaluates',async t=>{
  const root=workspace(t,{'src/main.ts':'console.log(19);\n'}),prepared=await prepare(root);
  const control=execute(root,prepared);assert.equal(control.status,0,control.stderr);assert.equal(control.stdout,'19\n');assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
  const assets=Reflect.get(prepared.snapshot!,'assets') as Record<string,string>|undefined;
  assert.deepEqual(Object.keys(assets??{}).sort(),['assets/oracle-assets.mjs','assets/oracle-loader.mjs','assets/oracle-runtime.mjs'],'the parent publishes exactly three type-free runtime assets');
  for(const name of ['loader','runtime','assets'])await t.test(name,()=>{
    const file=join(dirname(prepared.manifest),'assets/oracle-'+name+'.mjs'),original=readFileSync(file),effect=join(root,'forbidden-'+name);
    assert.equal(createHash('sha256').update(original).digest('hex'),assets!['assets/oracle-'+name+'.mjs']);
    chmodSync(file,0o644);writeFileSync(file,"import {writeFileSync as changedWrite} from 'node:fs';changedWrite("+JSON.stringify(effect)+",'ran');\n"+original.toString('utf8'));
    try{
      const execution=oracleExecution(prepared),actual=execute(root,execution);
      assert.notEqual(actual.status,0);assert.equal(actual.stdout,'');assert.equal(existsSync(effect),false,'bootstrap verification precedes the changed module body');
      assert.match(actual.stderr,/oracle generated bootstrap asset changed/);assert.equal(oracleLoaderReady(execution).ready,false);
    }finally{writeFileSync(file,original);chmodSync(file,0o444);}
    const fresh=oracleExecution(prepared),following=execute(root,fresh);
    assert.equal(following.status,0,following.stderr);assert.equal(following.stdout,'19\n');assert.deepEqual(oracleLoaderReady(fresh),{ready:true});
  });
  assert.deepEqual(oracleOwner.finishOracleSnapshot(prepared),{ready:true});
});

test('prepared Node routes pin positive resolution before live package topology changes',async t=>{
  for(const changed of [false,true])await t.test(changed?'changed mirror package':'unchanged control',async ()=>{
    const root=workspace(t,{
      'src/main.ts':"import {value} from './pkg/value.js';console.log(value);\n",
      'src/pkg/value.js':'export const value=19;\n',
      'src/pkg/package.json':'{"type":"module"}\n',
    },{allowJs:true,checkJs:false});
    const prepared=(await prepare(root)),stored=JSON.parse(readFileSync(prepared.manifest,'utf8')) as {sources:Record<string,string>};
    const output=join(dirname(prepared.manifest),stored.sources[join(root,'src/main.ts')]!);
    const selected=join(dirname(output),'pkg/value.js');
    assert.equal(readFileSync(selected,'utf8'),readFileSync(join(root,'src/pkg/value.js'),'utf8'),'the selected raw JS target is actually captured');
    const packageFile=join(dirname(selected),'package.json');
    assert.equal(JSON.parse(readFileSync(packageFile,'utf8')).type,'module');
    if(changed){chmodSync(packageFile,0o644);writeFileSync(packageFile,'{"type":"commonjs"}\n');}
    const result=execute(root,prepared),health=oracleLoaderReady(prepared);
    t.diagnostic(JSON.stringify({changed,status:result.status,stdout:result.stdout,stderr:result.stderr,health}));
    assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'19\n');
    assert.deepEqual(health,{ready:true},'a positive route uses the format Node selected during preparation');
    assert.deepEqual(oracleOwner.finishOracleSnapshot(prepared),{ready:true});
  });
});

test('prepared Node routes reject a child with different resolution options',async t=>{
  for(const flags of [[],['--conditions=unprobed-condition'],['--preserve-symlinks'],['--preserve-symlinks-main']] as string[][])await t.test(flags.join(' ')||'unchanged control',async ()=>{
    const root=workspace(t,{'src/main.ts':'console.log(19);\n'}),prepared=(await prepare(root));
    const result=spawnSync(process.execPath,[...prepared.args,...flags,join(root,'src/main.ts')],{cwd:root,env:{...fixtureEnvironment(t),...prepared.env},encoding:'utf8'});
    const health=oracleLoaderReady(prepared);
    t.diagnostic(JSON.stringify({flags,status:result.status,stdout:result.stdout,stderr:result.stderr,health}));
    if(flags.length){
      assert.notEqual(result.status,0,'an unprobed option cannot reuse the route table');assert.equal(result.stdout,'');
      assert.equal(health.ready,false);assert.match(health.ready?'':health.why,/oracle resolution options identity changed/);
    }else{assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'19\n');assert.deepEqual(health,{ready:true});}
    assert.deepEqual(oracleOwner.finishOracleSnapshot(prepared),{ready:true});
  });
});

test('prepared file entries retain Node input-type failures while eval imports keep their routes',async t=>{
  for(const flags of [['--input-type=module'],['--input-type','module']])await t.test(flags.join(' '),async()=>{
    const root=workspace(t,{'src/main.ts':'console.log(19);\n'}),prepared=await prepare(root);
    const file=join(root,'src/main.ts'),env=fixtureEnvironment(t);
    const plain=spawnSync(process.execPath,[...flags,file],{encoding:'utf8',env});
    assert.equal(plain.status,1);assert.match(plain.stderr,/ERR_INPUT_TYPE_NOT_ALLOWED/);assert.equal(plain.stdout,'');
    const initial=oracleExecution(prepared),actual=spawnSync(process.execPath,[...initial.args,...flags,file],{encoding:'utf8',env:{...env,...initial.env}});
    assert.equal(actual.status,plain.status);assert.match(actual.stderr,/ERR_INPUT_TYPE_NOT_ALLOWED/);assert.equal(actual.stdout,'');
    assert.deepEqual(oracleLoaderReady(initial),{ready:true},'an ordinary Node entry error is measured');
    const imported=oracleExecution(prepared),code='await import('+JSON.stringify(pathToFileURL(file).href)+');';
    const evaluation=spawnSync(process.execPath,[...imported.args,...flags,'--eval',code],{encoding:'utf8',env:{...env,...imported.env}});
    assert.equal(evaluation.status,0,evaluation.stderr);assert.equal(evaluation.stdout,'19\n');assert.deepEqual(oracleLoaderReady(imported),{ready:true});
    assert.deepEqual(oracleOwner.finishOracleSnapshot(prepared),{ready:true});
  });
});

test('snapshot boundaries keep original validation out of child output loads',async t=>{
  for(const mutation of ['none','unused-output','used-output','original-source','original-listing'] as const)await t.test(mutation,async ()=>{
    const root=workspace(t,{
      'src/main.ts':'console.log(19);\n',
      'dependency/value.ts':'export const value=23;\n',
    });
    const dependency=join(root,'dependency/value.ts'),owner=join(root,'dependency/tsconfig.json');
    writeFileSync(owner,JSON.stringify({extends:join(REPOSITORY,'tsconfig.fixtures.json'),compilerOptions:{types:[]},files:['value.ts'],include:[]})+'\n');
    const prepared=(await prepare(root,'src/main.ts',{preloads:[{entry:dependency,project:owner}]})),manifest=JSON.parse(readFileSync(prepared.manifest,'utf8')) as {sources:Record<string,string>};
    const output=(source:string)=>join(dirname(prepared.manifest),manifest.sources[source]!);
    assert.ok(manifest.sources[dependency],'unused owner must actually be published');
    if(mutation==='unused-output'){chmodSync(output(dependency),0o644);appendFileSync(output(dependency),'\n// changed unused output\n');}
    if(mutation==='used-output'){const file=output(join(root,'src/main.ts'));chmodSync(file,0o644);appendFileSync(file,'\nconsole.log(99);\n');}
    if(mutation==='original-source')writeFileSync(dependency,'export const value=29;\n');
    if(mutation==='original-listing')writeFileSync(join(root,'dependency/new-entry.txt'),'changed listing\n');
    const actual=execute(root,prepared),health=oracleLoaderReady(prepared);
    t.diagnostic(JSON.stringify({mutation,status:actual.status,stdout:actual.stdout,stderr:actual.stderr,health}));
    if(mutation==='used-output'){
      assert.notEqual(actual.status,0,'used output bytes must hold before evaluation');
      assert.equal(actual.stdout,'');assert.equal(health.ready,false);return;
    }
    assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'19\n');assert.deepEqual(health,{ready:true});
    const finish=Reflect.get(oracleOwner,'finishOracleSnapshot');
    // The old producer reaches its real eager-load red before this new seam.
    // A successor that omits finalization cannot pass the mutation subjects.
    if(mutation==='none'&&typeof finish!=='function')return;
    assert.equal(typeof finish,'function','snapshot finalization must precede a final verdict');
    const final=finish(prepared) as {ready:boolean;why?:string};
    t.diagnostic(JSON.stringify({mutation,final}));
    if(mutation.startsWith('original-')){
      assert.equal(final.ready,false,'changed original facts must hold the whole snapshot');
      assert.match(final.why??'',/original|snapshot|filesystem/i);
    }else assert.deepEqual(final,{ready:true});
  });
});

test('an explicit case project replaces its aggregate owner while retaining nearer owners',async t=>{
  const root=workspace(t,{
    'src/cases/one/main.ts':"import {local} from './local.ts';import {shared} from '../../common/shared.ts';import {near} from '../../near/value.ts';console.log(local+shared+near);\n",
    'src/cases/one/local.ts':'export const local=19;\n',
    'src/common/shared.ts':'export const shared=23;\n',
    'src/cases/unrelated/broken.ts':'export const unrelated:number="sibling type error";\n',
    'src/near/value.ts':'export const near=29;\n',
    'src/near/anchor.ts':'export const anchor=31;\n',
    'src/near/tsconfig.json':JSON.stringify({extends:'../../tsconfig.json',files:['value.ts'],include:[]}),
  });
  const project=join(root,'case-project.json'),near=join(root,'src/near/tsconfig.json');
  writeFileSync(project,JSON.stringify({extends:'./tsconfig.json',files:['src/cases/one/main.ts'],include:[]}));
  const original=readFileSync(join(root,'tsconfig.json'));
  const prepared=await prepare(root,'src/cases/one/main.ts',{project});
  const stored=JSON.parse(readFileSync(prepared.manifest,'utf8'));
  assert.deepEqual(stored.groups.map((group:{project:string})=>group.project).sort(),[project,near].sort());
  const group=stored.groups.find((group:{project:string})=>group.project===project);
  assert.ok(group.sourceInventory.some((fact:{path:string})=>fact.path===join(root,'src/common/shared.ts')));
  assert.equal(group.sourceInventory.some((fact:{path:string})=>fact.path.endsWith('/unrelated/broken.ts')),false,'a sibling error is outside the case Program');
  const run=execute(root,prepared,'src/cases/one/main.ts');
  assert.equal(run.status,0,run.stdout+run.stderr);assert.equal(run.stdout,'71\n');
  assert.ok(readFileSync(join(root,'tsconfig.json')).equals(original),'the aggregate config remains unchanged');
  writeFileSync(near,JSON.stringify({extends:'../../tsconfig.json',files:['anchor.ts'],include:[]}));
  await assert.rejects(prepare(root,'src/cases/one/main.ts',{project,directory:join(root,'unchecked')}),/owner closure has no checking input: .*near\/value\.ts/);
});

test('declaration diagnostics are requested only for an owner that enables declarations',async t=>{
  const root=workspace(t,{
    'src/types.ts':"interface Label {name:string;}export class Parser {label:Label={name:'label'};}\n",
    'src/main.ts':"import {Parser} from './types.ts';function plugin(Parent:typeof Parser){return class extends Parent {};}export function create(){return function(Parent:typeof Parser){return plugin(Parent);};}console.log(new (create()(Parser))().label.name);\n",
  },{declaration:false});
  const project=join(root,'tsconfig.json'),{compiler}=verifyToolchain(toolchain);
  const plain=await activeCommand(compiler,['-p',project,'--noEmit','--pretty','false'],{cwd:root,env:fixtureEnvironment(t)});
  assert.equal(plain.status,0,plain.stdout+plain.stderr);
  const prepared=await prepare(root);
  const stored=JSON.parse(readFileSync(prepared.manifest,'utf8'));
  assert.equal(stored.groups[0].options.declaration,false);
  const run=execute(root,prepared);assert.equal(run.status,0,run.stdout+run.stderr);assert.equal(run.stdout,'label\n');
  const options=JSON.parse(readFileSync(project,'utf8'));options.compilerOptions.declaration=true;writeFileSync(project,JSON.stringify(options));
  await assert.rejects(prepare(root,'src/main.ts',{directory:join(root,'declarations')}),error=>error instanceof TypeScriptDiagnosticError&&error.diagnostics.includes('TS4058'));
});
