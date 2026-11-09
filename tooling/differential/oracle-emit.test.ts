import type {Diagnostic} from 'typescript/sync';
import type {CheckerImportRelation} from './oracle-filesystem.ts';
type EmittedFile={path:string;text:string;sourceFileName?:string};
import * as oracleOwner from './oracle-emit.ts';
import {oracleToolchainLocation,gateEnvironment,hostEnvironment,sealOracleRun} from "../gate/canonical-environment.ts";
import {finishRunTemporary} from '../gate/run-temporary.ts';
import {ownerEmissionCalls} from '../gate/owner-emission-calls.ts';
import assert from "node:assert/strict";
import {activeCommand} from "../gate/active-command.ts";
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {chmodSync,cpSync,renameSync,appendFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,parse,relative,resolve} from "node:path";
import {test,afterEach,type TestContext} from "node:test";
import {pathToFileURL} from "node:url";
import {OracleWorker,TypeScriptDiagnosticError,ORACLE_LOADER,REPOSITORY,oracleIdentity,packageIdentity,removeOracleSnapshot,prepareOracle as prepareOracleTemplate,verifyToolchain,oracleExecution as newOracleExecution,oracleLoaderReady,oracleRuntimeFile,type OracleOptions,type OraclePrepared,type OracleRuntimeRoute,type OracleRuntimeNode,type OracleRuntimeDescriptor,type OwnerImportRoute} from "./oracle-emit.ts";
import {nativeOutput,OUTCOME_ORACLE_PRELOADS,outcomeSourceAssets} from "../conformance/outcomes-project.ts";
import {prepareOracles} from "./oracle-batch.ts";
import {OracleFilesystem,readOracleSnapshotIndex,writeOracleSnapshotIndex,type HostObservation,type DirectoryEntries} from './oracle-filesystem.ts';
import {ORACLE_EXECUTION_FILES,type SnapshotSlotIndex} from './oracle-runtime.ts';

import {setupOracleTestEnvironment} from './oracle-test-fixture.ts';

await setupOracleTestEnvironment();

const toolchain=oracleToolchainLocation();

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
const executions=new Set<OraclePrepared>();
function closeOracleExecution(prepared:OraclePrepared){const close=Reflect.get(oracleOwner,'closeOracleExecution');if(typeof close==='function')close(prepared);}
function oracleExecution(...args:Parameters<typeof newOracleExecution>){const execution=newOracleExecution(...args);executions.add(execution);return execution;}
async function prepareOracle(...args:Parameters<typeof prepareOracleTemplate>){return oracleExecution((await prepareOracleTemplate(...args)));}
afterEach(()=>{for(const execution of executions)closeOracleExecution(execution);executions.clear();});

test('an unused captured module with a nonlocal file URL does not abort preparation',async t=>{
  for(const mode of ['builtin-unused','foreign-unused','foreign-used'] as const)await t.test(mode,async()=>{
    const foreign=mode!=='builtin-unused',used=mode==='foreign-used';
    const body=used?`try{await import('./unused.mjs');}catch(error){console.log(JSON.stringify({name:error.name,properties:Object.fromEntries(Object.getOwnPropertyNames(error).filter(key=>key!=='stack').map(key=>[key,error[key]]))}));}\n`:'console.log(19);\n';
    const root=workspace(t,{'app/main.mjs':body,
      'app/unused.mjs':foreign?'import "file://hmm.js";\n':'import "node:path";\n'});
    const entry=join(root,'app/main.mjs'),prepared=await prepareOracle({entry,project:null,
      runtimeRoots:[join(root,'app')],directory:join(root,'prepared'),toolchain});
    const file=oracleRuntimeFile(prepared,entry),reference=spawnSync(process.execPath,[file],{cwd:root,encoding:'utf8'});
    const actual=spawnSync(process.execPath,[...prepared.args,file],
      {cwd:root,env:{...process.env,...prepared.env},encoding:'utf8'});
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
    const result=spawnSync(process.execPath,[...prepared.args,...flags,join(root,'src/main.ts')],{cwd:root,env:{...process.env,...prepared.env},encoding:'utf8'});
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
    const file=join(root,'src/main.ts'),env=process.env;
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


function workspace(t:TestContext,files:Record<string,string>,options:Record<string,unknown>={}) {
  const root=mkdtempSync(join(tmpdir(),"nts-oracle-emit-"));
  t.after(()=>removeOracleSnapshot(root));
  writeFileSync(join(root,"package.json"),'{"type":"module"}');
  writeFileSync(join(root,"tsconfig.json"),JSON.stringify({
    extends:join(REPOSITORY,"tsconfig.fixtures.json"),compilerOptions:{types:['node'],typeRoots:[join(REPOSITORY,'node_modules/@types')],...options},include:["src"],
  }));
  for(const [name,text] of Object.entries(files)) {
    const path=join(root,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);
  }
  return root;
}
function execute(root:string,prepared:Pick<OraclePrepared,"args"|"env">,entry="src/main.ts") {
  return spawnSync(process.execPath,[...prepared.args,"--no-warnings",join(root,entry)],{
    encoding:"utf8",cwd:root,env:{...process.env,...prepared.env},
  });
}
function bare(root:string,prepared:OraclePrepared,entry="src/main.ts"){
  const stored=JSON.parse(readFileSync(prepared.manifest,'utf8'));
  const output=join(dirname(prepared.manifest),stored.sources[join(root,entry)]);
  return spawnSync(process.execPath,['--enable-source-maps','--no-warnings',output],{encoding:'utf8',cwd:root,env:process.env});
}
async function prepare(root:string,entry="src/main.ts",extra:Partial<OracleOptions>={}) {
  return (await prepareOracle({toolchain,entry:join(root,entry),directory:join(root,"scratch"),...extra}));
}

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
  const plain=await activeCommand(compiler,['-p',project,'--noEmit','--pretty','false'],{cwd:root,env:process.env});
  assert.equal(plain.status,0,plain.stdout+plain.stderr);
  const prepared=await prepare(root);
  const stored=JSON.parse(readFileSync(prepared.manifest,'utf8'));
  assert.equal(stored.groups[0].options.declaration,false);
  const run=execute(root,prepared);assert.equal(run.status,0,run.stdout+run.stderr);assert.equal(run.stdout,'label\n');
  const options=JSON.parse(readFileSync(project,'utf8'));options.compilerOptions.declaration=true;writeFileSync(project,JSON.stringify(options));
  await assert.rejects(prepare(root,'src/main.ts',{directory:join(root,'declarations')}),error=>error instanceof TypeScriptDiagnosticError&&error.diagnostics.includes('TS4058'));
});

test('owner runtime capture follows imports without visiting unrelated package trees',async t=>{
  const root=workspace(t,{
    'src/main.ts':"import {value} from './dependency.mjs';console.log(value);const request=process.argv[2];if(request){try{await import(request);}catch{console.log('caught');}}\n",
    'src/dependency.mjs':'export const value=19;\n',
    'unrelated/poison.mjs':"console.log('UNRELATED MODULE RAN');\n",
    'foreign/index.mjs':"console.log('FOREIGN PACKAGE RAN');\n",
  },{allowJs:true,checkJs:false});
  const modules=join(root,'unrelated/node_modules');mkdirSync(modules,{recursive:true});
  symlinkSync(join(root,'foreign'),join(modules,'stale'));
  const prepared=await prepare(root),manifest=JSON.parse(readFileSync(prepared.manifest,'utf8'));
  const control=execute(root,prepared);assert.equal(control.status,0,control.stderr);assert.equal(control.stdout,'19\n');
  assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
  assert.equal(Object.keys(manifest.inputs).some(file=>file.startsWith(join(root,'unrelated')+'/')||file.startsWith(join(root,'foreign')+'/')),false);
  assert.equal(manifest.observations.some((fact:HostObservation)=>fact.path.startsWith(join(root,'unrelated')+'/')),false,'no traversal of an unrelated package tree');
  const execution=oracleExecution(prepared),subject=spawnSync(process.execPath,[...execution.args,join(root,'src/main.ts'),'../unrelated/poison.mjs'],
    {cwd:root,env:{...process.env,...execution.env},encoding:'utf8'});
  assert.equal(subject.status,0,subject.stderr);assert.equal(subject.stdout,'19\ncaught\n');
  const health=oracleLoaderReady(execution);assert.equal(health.ready,false,'an omitted subtree remains unknown');
  if(!health.ready)assert.match(health.why,/resolution context was not captured/);
  assert.deepEqual(oracleOwner.finishOracleSnapshot(prepared),{ready:true});
});

test('declared runtime files do not implicitly capture their project directory',async t=>{
  const root=workspace(t,{
    'tooling/driver.mjs':"import {value} from './helper.mjs';console.log(value);\n",
    'tooling/helper.mjs':'export const value=23;\n',
    'outside/index.mjs':"throw Error('UNRELATED PACKAGE');\n",
  });
  const modules=join(root,'tooling/stale/node_modules');mkdirSync(modules,{recursive:true});
  symlinkSync(join(root,'outside'),join(modules,'unused'));
  const entry=join(root,'tooling/driver.mjs'),prepared=await prepareOracle({entry,project:null,toolchain,
    runtimeRoots:[entry,join(root,'tooling/helper.mjs')],directory:join(root,'scratch')});
  const result=execute(root,prepared,'tooling/driver.mjs');assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'23\n');
  assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
  const manifest=JSON.parse(readFileSync(prepared.manifest,'utf8'));
  assert.equal(manifest.observations.some((fact:HostObservation)=>fact.path.startsWith(join(root,'tooling/stale')+'/')),false);
  assert.deepEqual(oracleOwner.finishOracleSnapshot(prepared),{ready:true});
});

test('runtime package capture includes the reached package without unrelated installed siblings',async t=>{
  const root=workspace(t,{
    'src/main.ts':"import {value} from 'kept';console.log(value);\n",
    'node_modules/kept/package.json':'{"type":"module","main":"index.js"}\n',
    'node_modules/kept/index.js':'export const value=31;\n',
    'outside/index.mjs':"throw Error('UNRELATED INSTALLED SIBLING');\n",
  },{allowJs:true,checkJs:false,maxNodeModuleJsDepth:1});
  symlinkSync(join(root,'outside'),join(root,'node_modules/stale'));
  const prepared=await prepare(root),result=execute(root,prepared);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'31\n');
  assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
  const manifest=JSON.parse(readFileSync(prepared.manifest,'utf8'));
  assert.equal(manifest.observations.some((fact:HostObservation)=>fact.path===join(root,'node_modules/stale')||fact.path.startsWith(join(root,'outside')+'/')),false);
  assert.deepEqual(oracleOwner.finishOracleSnapshot(prepared),{ready:true});
});

function snapshotRecords(prepared:OraclePrepared):Map<string,unknown>{
  const directory=dirname(prepared.manifest),reference=prepared.snapshot!.index;
  const descriptorBytes=readFileSync(join(directory,reference.path));
  assert.equal(createHash('sha256').update(descriptorBytes).digest('hex'),reference.sha256);
  const descriptor=JSON.parse(descriptorBytes.toString('utf8')) as SnapshotSlotIndex;
  const table=readFileSync(join(directory,descriptor.table.path)),data=readFileSync(join(directory,descriptor.data.path));
  assert.equal(createHash('sha256').update(table).digest('hex'),descriptor.table.sha256);
  assert.equal(createHash('sha256').update(data).digest('hex'),descriptor.data.sha256);
  const checked=readOracleSnapshotIndex(directory,reference),records=new Map<string,unknown>();
  for(let slot=0;slot<descriptor.slots;slot++){
    const offset=table.readUInt32LE(slot*descriptor.slotBytes),length=table.readUInt32LE(slot*descriptor.slotBytes+4);
    if(!length)continue;
    const bucket=JSON.parse(data.subarray(offset,offset+length).toString('utf8')) as {entries:[string,unknown][]};
    for(const [key,value] of bucket.entries){assert.equal(records.has(key),false);assert.deepEqual(checked.get(key),value);records.set(key,value);}
  }
  return records;
}
/** Rebind a deliberately changed producer record, so a semantic guard reaches
 * its predicate rather than merely tripping the authenticated-byte check. */
function changedSnapshot(prepared:OraclePrepared,change:(records:Map<string,unknown>)=>void):OraclePrepared{
  const directory=dirname(prepared.manifest),records=snapshotRecords(prepared);change(records);
  chmodSync(join(directory,'runtime-index'),0o700);
  const index=writeOracleSnapshotIndex(directory,records);chmodSync(join(directory,'runtime-index'),0o500);
  const manifest=JSON.parse(readFileSync(prepared.manifest,'utf8'));manifest.runtimeIndex=index;
  const bytes=JSON.stringify(manifest)+'\n';writeFileSync(prepared.manifest,bytes);
  const snapshot={...prepared.snapshot!,index,manifestSha256:createHash('sha256').update(bytes).digest('hex')};
  return {...prepared,snapshot,env:{...prepared.env,NTS_ORACLE_SNAPSHOT:JSON.stringify(snapshot)}};
}
function witnessOwner(root:string,entry:string){
  const project=join(root,'witness.tsconfig.json');
  writeFileSync(project,JSON.stringify({extends:join(REPOSITORY,'tsconfig.fixtures.json'),compilerOptions:{allowJs:true,checkJs:false,types:[]},files:[relative(root,entry)],include:[]})+'\n');
  return {entry,project};
}
function ordinaryProject(root:string,files:string[],name='tsconfig.json') {
  const file=join(root,name),config=name==='tsconfig.json'?JSON.parse(readFileSync(file,'utf8')):{extends:join(root,'tsconfig.json')};
  writeFileSync(file,JSON.stringify({...config,files,include:[]}));return file;
}

test('package TypeScript imports require an exact owner-emitted resolution',async t=>{
  for(const kind of ['relative','package','unchecked','root-owner','two-owner'] as const)await t.test(kind,async ()=>{
    const specifier=kind==='relative'||kind==='two-owner'?'../dependency/value.ts':'mapped/value.ts';
    const body=kind==='two-owner'
      ?'const seen:number[]=[];class Base {} Object.defineProperty(Base.prototype,"item",{set(value:number){seen.push(value);}});class Derived extends Base{item=7;}new Derived();export const value=seen.length===1?19:23;\n'
      :'export const value=19;\n';
    const root=workspace(t,{
      'src/main.ts':`import {value} from ${JSON.stringify(specifier)};console.log(value);\n`,
      'dependency/value.ts':body,
      'dependency/package.json':JSON.stringify({name:'mapped',type:'module',exports:{'./value.ts':'./value.ts'}}),
    },{paths:{'mapped/*':['./dependency/*']}});
    const dependency=join(root,'dependency'),owner=join(dependency,'tsconfig.json');
    if(kind==='unchecked')writeFileSync(join(dependency,'anchor.ts'),'export {};\n');
    if(kind!=='root-owner')writeFileSync(owner,JSON.stringify({extends:join(REPOSITORY,'tsconfig.fixtures.json'),compilerOptions:{rootDir:dependency,types:[],...(kind==='two-owner'?{target:'es2021'}:{})},files:[kind==='unchecked'?'anchor.ts':'value.ts'],include:[]})+'\n');
    mkdirSync(join(root,'node_modules'));symlinkSync('../dependency',join(root,'node_modules/mapped'));
    if(kind==='unchecked'){
      await assert.rejects(prepare(root),error=>{
        assert.match(String(error),/owner closure has no checking input/);assert.ok(String(error).includes(join(dependency,'value.ts')));return true;
      });
      return;
    }
    const prepared=(await prepare(root)),run=execute(root,prepared);
    assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');
    assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
    if(kind==='root-owner'){
      const stored=JSON.parse(readFileSync(prepared.manifest,'utf8')) as oracleOwner.OracleManifest;
      const group=stored.groups.find(group=>group.project===join(root,'tsconfig.json'));assert.ok(group);
      assert.equal(existsSync(owner),false,'the dependency has no separate configuration');
      assert.equal(group.files.includes(join(dependency,'value.ts')),false,'the import stays a non-root');
      assert.ok(group.sourceInventory.some(fact=>fact.path===join(dependency,'value.ts')));
      assert.ok(group.emitted[join(dependency,'value.ts')],'the nearest root project emits its checked import');
      assert.equal(stored.groups.length,1);
    }
    if(kind==='package'||kind==='two-owner'){
      const manifest=JSON.parse(readFileSync(prepared.manifest,'utf8'));
      const group=manifest.groups.find((group:oracleOwner.EmitGroup)=>group.project===owner);
      assert.ok(group,'the package target keeps its own nearest project');
      assert.ok(group.emitted[join(dependency,'value.ts')],'the exact checker target has a producer-owned executable');
      const sourceIndex=JSON.parse(readFileSync(join(dirname(prepared.manifest),'source-index.json'),'utf8'));
      const parent=sourceIndex.files.find((file:OracleRuntimeRoute)=>file.source===join(root,'src/main.ts'));
      const child=sourceIndex.files.find((file:OracleRuntimeRoute)=>file.source===join(dependency,'value.ts'));
      assert.equal(relative(dirname(parent.execution),child.execution),'../dependency/value.js','owner output positions preserve the source relation');
    }
  });
});

test('referenced placement configs cannot become changed JSON program inputs',async t=>{
  for(const self of [false,true])await t.test(self?'referenced-config':'sibling-json',async ()=>{
    const root=workspace(t,{'src/main.mts':`import data from '../dependency/${self?'tsconfig.json':'data.json'}' with {type:'json'};console.log(data.compilerOptions.outDir);\n`,
      'dependency/value.ts':'export const value=19;\n'}, {resolveJsonModule:true,module:'nodenext',moduleResolution:'nodenext'});
    const owner=join(root,'dependency/tsconfig.json');
    writeFileSync(owner,JSON.stringify({extends:join(REPOSITORY,'tsconfig.fixtures.json'),compilerOptions:{composite:true,declaration:true,emitDeclarationOnly:true,noEmit:false,outDir:'./not-built',types:[]},files:['value.ts'],include:[]})+'\n');
    cpSync(owner,join(root,'dependency/data.json'));
    const file=join(root,'tsconfig.json'),config=JSON.parse(readFileSync(file,'utf8'));
    writeFileSync(file,JSON.stringify({...config,references:[{path:'./dependency'}]})+'\n');
    if(self){(await assert.rejects(async ()=>(await prepare(root,'src/main.mts')),/overlay config is a program input/));return;}
    const prepared=(await prepare(root,'src/main.mts')),run=execute(root,prepared,'src/main.mts');
    assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'./not-built\n');
    assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
  });
});

test('a shared owner reuses emission and re-emits after a recorded input changes',async t=>{
  const root=workspace(t,{'src/main.ts':"import {value} from '../dependency/value.ts';console.log(value);\n",'dependency/value.ts':'export const value=19;\n'});
  const owner=join(root,'dependency/tsconfig.json');
  writeFileSync(owner,JSON.stringify({extends:join(REPOSITORY,'tsconfig.fixtures.json'),compilerOptions:{types:[]},files:['value.ts'],include:[]})+'\n');
  const directory=join(root,'worker'),worker=new OracleWorker(directory,toolchain),context=JSON.parse(readFileSync(join(directory,'owner-cache.json'),'utf8'));
  const ledger=join(context.ledger,'oracle-owner-calls.jsonl');
  try{
    for(const [index,value] of [19,19,23].entries()){
      if(index===2)writeFileSync(join(root,'dependency/value.ts'),'export const value=23;\n');
      const prepared=oracleExecution((await worker.prepare({entry:join(root,'src/main.ts'),directory:join(root,'fixture-'+index)}))),run=execute(root,prepared);
      assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,value+'\n');assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
    }
    const calls=readFileSync(ledger,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(row=>row.project===owner);
    assert.deepEqual(calls.map(row=>row.mode),['emit','hit','emit']);
    assert.equal(calls[0].inputsSha256,calls[1].inputsSha256);
    assert.notEqual(calls[1].inputsSha256,calls[2].inputsSha256);
    t.diagnostic(JSON.stringify({kind:'owner-emission-reuse',owner,calls}));
  }finally{worker.close();}
});

test('an owner configuration change invalidates its cached output placement',async t=>{
  const body='console.log(19);\n',root=workspace(t,{'src/main.ts':body},{rootDir:'.'});
  const project=join(root,'tsconfig.json'),directory=join(root,'worker');
  const outputs=['first','changed','reuse','substituted'].map(name=>join(root,name));
  for(const output of outputs)mkdirSync(output,{recursive:true});
  const worker=new OracleWorker(directory,toolchain,[directory,...outputs]);
  const context=JSON.parse(readFileSync(join(directory,'owner-cache.json'),'utf8'));
  try{
    for(const [index,rootDir] of ['.','src','src'].entries()){
      const config=JSON.parse(readFileSync(project,'utf8'));
      config.compilerOptions.rootDir=rootDir;writeFileSync(project,JSON.stringify(config));
      const prepared=oracleExecution((await worker.prepare({entry:join(root,'src/main.ts'),directory:outputs[index]!,outputRoots:outputs})));
      const run=execute(root,prepared);assert.equal(run.status,0,run.stderr);
      assert.equal(run.stdout,'19\n');assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
      assert.equal(readFileSync(join(root,'src/main.ts'),'utf8'),body);
    }
    const calls=readFileSync(join(context.ledger,'oracle-owner-calls.jsonl'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(row=>row.project===project);
    assert.deepEqual(calls.map(row=>row.mode),['emit','emit','hit']);
    assert.notEqual(calls[0].inputsSha256,calls[1].inputsSha256);
    assert.equal(calls[1].inputsSha256,calls[2].inputsSha256);
    // An output substitution with unchanged inputs is still an authority hold.
    await assert.rejects(worker.prepareBatch([{entry:join(root,'src/main.ts'),directory:outputs[3]!,outputRoots:outputs}],async(...args)=>{
      const requestFile=args[1][2]!,request=JSON.parse(readFileSync(requestFile,'utf8'));
      request.output=join(root,'not-the-owner-output');const bytes=JSON.stringify(request)+'\n';
      writeFileSync(requestFile,bytes);args[1][3]=createHash('sha256').update(bytes).digest('hex');
      return boundedCompiler(...args);
    }),/owner cache request changed/);
    for(const entry of readdirSync(outputs[3]!))assert.equal(existsSync(join(outputs[3]!,entry,'manifest.json')),false);
    t.diagnostic(JSON.stringify({kind:'owner-config-invalidation',project,calls}));
  }finally{worker.close();}
});

test('gate and standalone seals share owner emissions until their own run ends',async t=>{
  for(const kind of ['gate','standalone'] as const)await t.test(kind,async()=>{
    const root=workspace(t,{'src/main.ts':'console.log(19);\n'}),outside=mkdtempSync(join(tmpdir(),'nts-owner-scope-'));
    const planned=await sealOracleRun(gateEnvironment(hostEnvironment(process.env),{run:outside,oracleAdmissionContext:kind}));
    const keys=['NTS_ORACLE_DEPENDENCIES','NTS_GATE_ENV_CONTEXT'] as const,previous=keys.map(key=>process.env[key]);
    const cap=JSON.parse(planned.env.NTS_ORACLE_DEPENDENCIES!),contexts=[];let green=false;
    try{
      for(const key of keys)process.env[key]=planned.env[key];
      for(let index=0;index<2;index++){
        const directory=join(outside,'consumer-'+index),worker=new OracleWorker(directory,toolchain);
        try{
          const context=JSON.parse(readFileSync(join(directory,'owner-cache.json'),'utf8'));contexts.push(context);assert.equal(context.shared,true);
          assert.ok(context.directory.startsWith((kind==='gate'?planned.temporary.path:cap.directory)+'/'));
          const prepared=oracleExecution((await worker.prepare({entry:join(root,'src/main.ts'),directory:join(outside,'output-'+index)}))),run=execute(root,prepared);
          assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
        }finally{worker.close();}
        assert.equal(existsSync(contexts[index].directory),true,'worker closure does not end its registered owner');
      }
      assert.equal(contexts[0].directory,contexts[1].directory);
      const ledger=join(cap.directory,'oracle-owner-calls.jsonl');
      const calls=readFileSync(ledger,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(row=>row.project===join(root,'tsconfig.json'));
      assert.deepEqual(calls.map(row=>row.mode),['emit','hit']);
      const report=ownerEmissionCalls(cap,{drained:true});assert.equal(report.status,'complete');assert.equal(report.emits,1);assert.equal(report.hits,1);assert.equal(report.held,0);
      assert.deepEqual(report.owners.map(owner=>owner.project),[join(root,'tsconfig.json')]);t.diagnostic(JSON.stringify({kind,contexts,calls,report}));green=true;
    }finally{
      for(const [index,key] of keys.entries())if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];
      const cleanup=finishRunTemporary(planned.temporary,planned.env.HOME!,green);
      if(green){assert.equal(cleanup.state,'removed after green');assert.equal(existsSync(contexts[0].directory),false);removeOracleSnapshot(outside);}
    }
  });
});

test('a new actual emit diagnostic prevents publication after checking succeeds',async t=>{
  const root=workspace(t,{'src/main.ts':'console.log(19);\n'}),worker=new OracleWorker(join(root,'worker'),toolchain);
  try{
    await assert.rejects(worker.prepareBatch([{entry:join(root,'src/main.ts'),directory:join(root,'emitted')}],async(...args)=>{
      const run=await boundedCompiler(...args);assert.equal(run.status,0,run.stderr);
      const record=JSON.parse(run.stdout);
      assert.ok(Object.values(record.proof.beforeDiagnostics).every(channel=>Array.isArray(channel)&&channel.length===0));
      record.proof.emitDiagnostics.push({code:2322,category:1,fileName:join(root,'src/main.ts'),pos:0,end:1,text:'known emit-only error'});
      return {...run,stdout:JSON.stringify(record)+'\n'};
    }),/actual emit diagnostics were not accepted/);
  }finally{worker.close();}
});

test('a package route cannot substitute another existing owner output',async t=>{
  const root=workspace(t,{'src/main.ts':"import {value} from 'mapped/value.ts';import {other} from '../dependency/other.ts';console.log(value,other);\n",
    'dependency/value.ts':'export const value=19;\n','dependency/other.ts':'export const other=23;export const value=37;\n'}, {paths:{'mapped/*':['./dependency/*']}});
  const owner=join(root,'dependency/tsconfig.json');writeFileSync(owner,JSON.stringify({extends:join(REPOSITORY,'tsconfig.fixtures.json'),compilerOptions:{types:[]},files:['value.ts','other.ts'],include:[]})+'\n');
  const outputRoots=[join(root,'healthy'),join(root,'changed-producer-route')];
  for(const output of outputRoots)mkdirSync(output,{recursive:true});
  const worker=new OracleWorker(join(root,'worker'),toolchain,outputRoots),request={entry:join(root,'src/main.ts'),directory:outputRoots[0]!,outputRoots};
  try{
    const [prepared]=await worker.prepareBatch([request],boundedCompiler),clean=oracleExecution(prepared),run=execute(root,clean);
    assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19 23\n');assert.deepEqual(oracleLoaderReady(clean),{ready:true});
    const other=join(root,'dependency/other.ts'),manifest=JSON.parse(readFileSync(prepared.manifest,'utf8'));
    assert.ok(manifest.sources[other],'the substituted target is already owned');
    await t.test('producer relation',async()=>{
      await assert.rejects(worker.prepareBatch([{...request,directory:join(root,'changed-producer-route')}],async(...args)=>{
        const result=await boundedCompiler(...args),record=JSON.parse(result.stdout);
        if(record.deferredImports.length)record.deferredImports[0].target=other;
        return {...result,stdout:JSON.stringify(record)+'\n'};
      }),/checker import relation/);
    });
    await t.test('loader relation',()=>{
      const altered=changedSnapshot(prepared,records=>{
        const routes=records.get('imports\0'+request.entry) as OwnerImportRoute[];
        const target=(records.get('source\0'+other) as OracleRuntimeRoute[])[0]!;
        routes[0]!.target=other;routes[0]!.execution=target.execution;
      });
      const changed=oracleExecution(altered),bad=execute(root,changed);
      t.diagnostic(JSON.stringify({kind:'changed-owner-route',status:bad.status,stdout:bad.stdout,stderr:bad.stderr}));
      assert.notEqual(bad.status,0);assert.match(bad.stderr,/checker import relation/);assert.equal(bad.stdout,'');
      assert.equal(oracleLoaderReady(changed).ready,false);
    });
  }finally{worker.close();}
});

test('repeated static and dynamic package literals share one runtime route',async t=>{
  for(const repeated of [false,true])await t.test(repeated?'same-literal':'relative-control',async ()=>{
    const dynamic=repeated?'mapped/value.ts':'../dependency/value.ts';
    const root=workspace(t,{'src/main.ts':`import {value} from 'mapped/value.ts';console.log(value);import(${JSON.stringify(dynamic)}).then(module=>console.log(module.value));\n`,
      'dependency/value.ts':'export const value=19;\n'}, {paths:{'mapped/*':['./dependency/*']}});
    writeFileSync(join(root,'dependency/tsconfig.json'),JSON.stringify({extends:join(REPOSITORY,'tsconfig.fixtures.json'),compilerOptions:{types:[]},files:['value.ts'],include:[]})+'\n');
    const prepared=(await prepare(root)),run=execute(root,prepared);
    assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n19\n');assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
    const result=JSON.parse(readFileSync(join(dirname(prepared.manifest),'program/program-result.json'),'utf8'));
    const relations=result.checkerImports.filter((item:CheckerImportRelation)=>item.file===join(root,'src/main.ts')&&item.specifier==='mapped/value.ts');
    assert.equal(relations.length,repeated?2:1);
    assert.equal(new Set(relations.map((item:CheckerImportRelation)=>item.pos)).size,relations.length,'each literal retains its own checker span');
  });
});

test('deferred imports in an unrelated checking root do not publish that root',async t=>{
  const root=workspace(t,{'src/main.ts':'console.log(19);\n','src/unrelated.ts':"import {value} from 'mapped/value.ts';console.log('UNRELATED',value);\n",'dependency/value.ts':'export const value=23;\n'}, {paths:{'mapped/*':['./dependency/*']}});
  writeFileSync(join(root,'dependency/tsconfig.json'),JSON.stringify({extends:join(REPOSITORY,'tsconfig.fixtures.json'),compilerOptions:{types:[]},files:['value.ts'],include:[]})+'\n');
  const prepared=(await prepare(root)),run=execute(root,prepared),manifest=JSON.parse(readFileSync(prepared.manifest,'utf8'));
  assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
  assert.equal(Object.hasOwn(manifest.sources,join(root,'src/unrelated.ts')),false);
  assert.equal(Object.hasOwn(manifest.sources,join(root,'dependency/value.ts')),false);
  assert.deepEqual(manifest.imports,[]);
  const result=JSON.parse(readFileSync(join(dirname(prepared.manifest),'program/program-result.json'),'utf8'));
  assert.ok(result.proof.beforeFiles.includes(join(root,'src/unrelated.ts')),'full checking roots stay intact');
  assert.ok(result.deferredImports.some((item:{file:string})=>item.file===join(root,'src/unrelated.ts')),'the diagnostic obligation is retained');
});

test('configured build output is omitted from the captured runtime namespace',async t=>{
  for(const build of [false,true]){
    const root=workspace(t,{'src/main.ts':'console.log(19);\n'}),output=join(root,'node_modules/.tsbuild/dist'),file=join(output,'unread-build-state.js');
    const config=join(root,'tsconfig.json'),options=JSON.parse(readFileSync(config,'utf8'));
    options.compilerOptions.outDir=output;writeFileSync(config,JSON.stringify(options)+'\n');
    if(build){mkdirSync(output,{recursive:true});writeFileSync(file,"throw Error('BUILD STATE MUST NOT BE CAPTURED');\n");}
    const prepared=(await prepare(root)),run=execute(root,prepared),manifest=JSON.parse(readFileSync(prepared.manifest,'utf8'));
    assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
    assert.ok(!Object.keys(manifest.outputs).some(path=>path.endsWith('/unread-build-state.js')));
    assert.ok(!manifest.observations.some((fact:HostObservation)=>fact.kind==='file'&&fact.path===file));
  }
});

test('runtime binding injection follows producer source identity for emitted modules',async t=>{
  for(const runtime of [false,true]){
    const imported=runtime?'@nts/runtime/node/async_hooks/src/main.ts':'./unrelated.ts';
    const root=workspace(t,{'src/main.ts':`import ${JSON.stringify(imported)};console.log(typeof Reflect.get(globalThis,'nts_promise_hook_install'));\n`,'src/unrelated.ts':'export const value=19;\n'}, {paths:{'@nts/runtime/*':[join(REPOSITORY,'runtime/*')]}});
    const prepared=(await prepare(root,'src/main.ts',{preloads:[...OUTCOME_ORACLE_PRELOADS],sourceAssets:outcomeSourceAssets()}));
    const run=spawnSync(process.execPath,[...prepared.args,'--no-warnings',...OUTCOME_ORACLE_PRELOADS.flatMap(file=>['--import',file]),join(root,'src/main.ts')],{cwd:root,encoding:'utf8',env:{...process.env,...prepared.env}});
    assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,(runtime?'function':'undefined')+'\n');
    assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
  }
});

test('captured asset lookup distinguishes present absent and unobserved candidates',async t=>{
  for(const kind of ['present','absent','unobserved'] as const)await t.test(kind,async ()=>{
    const root=workspace(t,{'src/main.ts':'export {};\n','fixture.txt':'19\n'});
    const candidate=kind==='present'?join(root,'fixture.txt'):kind==='absent'?join(root,'missing.txt'):root+'-unobserved/missing.txt';
    writeFileSync(join(root,'src/main.ts'),`import {dirname,join} from 'node:path';import {pathToFileURL} from 'node:url';import {readFileSync} from 'node:fs';
const loader=await import(pathToFileURL(join(dirname(process.env.NTS_ORACLE_EMIT_MANIFEST!),'assets/oracle-loader.ts')).href);
try{const file=loader.oracleCapturedFile(${JSON.stringify(candidate)});console.log(file===null?'ABSENT':readFileSync(file,'utf8').trim());}catch(error){console.log('HELD',String(error));}\n`);
    const prepared=(await prepare(root,'src/main.ts',{sourceAssets:[{root,depth:0,name:kind==='absent'?'missing.txt':'fixture.txt'}]})),run=execute(root,prepared),health=oracleLoaderReady(prepared);
    assert.equal(run.status,0,run.stderr);
    if(kind==='unobserved'){
      assert.match(run.stdout,/HELD.*oracle captured asset query was not observed/);
      assert.equal(health.ready,false);assert.match(health.why??'',/oracle captured asset query was not observed/);
    }else{
      assert.equal(run.stdout,(kind==='present'?'19':'ABSENT')+'\n');assert.deepEqual(health,{ready:true});
    }
  });
});

function diagnostics(text:string,cwd:string){
    try{const record=JSON.parse(text);if(record?.version===1&&'emitSkipped' in record)text=record.diagnostics||record.instrument||text;}catch{}
    const result:unknown[]=[];
    for(const line of text.split(/\r?\n/)){
      const at=/^(.*?)\((\d+),(\d+)\): (error TS\d+:.*)$/.exec(line);
      if(at)result.push({file:resolve(cwd,at[1]!),line:Number(at[2]),column:Number(at[3]),message:at[4]});
      else if(/^error TS\d+:/.test(line)||/^\s+\S/.test(line))result.push(line);
    }
    return result;
}

test('public program output ownership is mandatory before any executable is published',async t=>{
  const root=workspace(t,{'src/main.ts':'console.log(19);\n'}),worker=new OracleWorker(join(root,'worker'),toolchain);
  try{
    const request={entry:join(root,'src/main.ts'),directory:join(root,'clean')};
    const [clean]=await worker.prepareBatch([request],boundedCompiler);assert.ok(clean);
    const run=execute(root,oracleExecution(clean));assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');
    const stored=JSON.parse(readFileSync(clean.manifest,'utf8'));
    const proof=JSON.parse(readFileSync(join(dirname(clean.manifest),'program/program-result.json'),'utf8')).proof;
    assert.deepEqual(proof.beforeFiles,proof.afterFiles);assert.deepEqual(proof.beforeEdges,proof.afterEdges);assert.deepEqual(proof.beforeDiagnostics,proof.afterDiagnostics);
    const changed=Object.keys({...proof.beforeOptions,...proof.afterOptions}).filter(key=>JSON.stringify(proof.beforeOptions[key])!==JSON.stringify(proof.afterOptions[key])).sort();
    assert.deepEqual(changed,[...proof.changedOptions].sort());assert.ok(changed.includes('noEmit'));
    for(const key of ['module','moduleResolution','jsx','experimentalDecorators'])assert.deepEqual(proof.beforeOptions[key],proof.afterOptions[key],key+' belongs to the project');
    assert.equal(proof.afterOptions.target,13);
    assert.equal(proof.afterOptions.useDefineForClassFields,true);
    assert.ok(changed.every(key=>oracleOwner.ORACLE_EMIT_OPTIONS.some(item=>item.name===key)));
    assert.ok(Object.keys(stored.groups[0].emitted).includes(request.entry));
    for(const owner of [undefined,join(root,'foreign.ts')]){
      const directory=join(root,owner?'foreign':'missing-owner');
      await assert.rejects(worker.prepareBatch([{...request,directory}],async(...args)=>{
        const run=await boundedCompiler(...args);assert.equal(run.status,0,run.stderr);
        const record=JSON.parse(run.stdout),file=record.outputs.find((output:EmittedFile)=>/\.[cm]?jsx?$/.test(output.path));assert.ok(file);
        if(owner)file.sourceFileName=owner;else delete file.sourceFileName;
        return {...run,stdout:JSON.stringify(record)+'\n'};
      }),/executable has no captured source owner/);
      for(const item of readdirSync(directory))assert.equal(existsSync(join(directory,item,'manifest.json')),false,'invalid producer ownership cannot publish a manifest');
    }
  }finally{worker.close();}
});

test('the complete declared input join includes nonemitted declaration files',async t=>{
  const root=workspace(t,{'src/main.ts':"import type {Marker} from './types.js';const value:Marker={value:19};console.log(value.value);\n",'src/types.d.ts':'export interface Marker{value:number}\n'});
  const declaration=join(root,'src/types.d.ts'),worker=new OracleWorker(join(root,'worker'),toolchain);
  try{
    const request={entry:join(root,'src/main.ts'),directory:join(root,'clean')};
    const [prepared]=await worker.prepareBatch([request],boundedCompiler);assert.ok(prepared);
    const run=execute(root,oracleExecution(prepared));assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');
    await assert.rejects(worker.prepareBatch([{...request,directory:join(root,'missing-input')}],async(...args)=>{
      const run=await boundedCompiler(...args);assert.equal(run.status,0,run.stderr);
      const record=JSON.parse(run.stdout);assert.ok(record.inventory.some((file:oracleOwner.EmitGroup['sourceInventory'][number])=>file.path===declaration&&file.declaration));
      assert.ok(record.observations.some((row:HostObservation)=>row.kind==='file'&&row.path===declaration&&typeof row.value==='string'));
      record.observations=record.observations.filter((row:HostObservation)=>row.kind!=='file'||row.path!==declaration);
      return {...run,stdout:JSON.stringify(record)+'\n'};
    }),/program input has no captured file answer/);
  }finally{worker.close();}
});

test('checking intent never becomes the bytes of an imported config JSON module',async t=>{
  for(const self of [false,true]){
    const target=self?'tsconfig.json':'data.json';
    const root=workspace(t,{'src/main.mts':`import config from '../${target}' with {type:'json'};console.log(config.compilerOptions.noEmit);\n`},
      {noEmit:false,resolveJsonModule:true,module:'nodenext',moduleResolution:'nodenext'});
    cpSync(join(root,'tsconfig.json'),join(root,'data.json'));
    const reference=join(root,'reference'),compiler=verifyToolchain(toolchain).compiler;
    const args=['--project',join(root,'tsconfig.json'),'--noEmit','false','--emitDeclarationOnly','false','--rewriteRelativeImportExtensions','true','--outDir',reference,'--rootDir',root,'--pretty','false'];
    const emitted=spawnSync(compiler,args,{cwd:root,encoding:'utf8'});assert.equal(emitted.status,0,emitted.stdout+emitted.stderr);
    const stock=spawnSync(process.execPath,[join(reference,'src/main.mjs')],{cwd:root,encoding:'utf8'});
    t.diagnostic(JSON.stringify({kind:'stock-config-json',self,compiler,args,emit:{status:emitted.status,stdout:emitted.stdout,stderr:emitted.stderr},run:{status:stock.status,stdout:stock.stdout,stderr:stock.stderr}}));
    assert.equal(stock.status,0,String(stock.stderr));assert.equal(stock.stdout,'false\n');
    if(!self){
      const prepared=(await prepare(root,'src/main.mts',{outputRoots:[reference]})),run=execute(root,prepared,'src/main.mts');
      assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,stock.stdout);assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
    }else{
      let prepared:OraclePrepared|undefined;
      try{prepared=(await prepare(root,'src/main.mts',{outputRoots:[reference]}));}catch(error){assert.match(String(error),/checking overlay config is a program input/);continue;}
      const run=execute(root,prepared,'src/main.mts');
      t.diagnostic(JSON.stringify({kind:'unexpected-config-json-verdict',status:run.status,stdout:run.stdout,stderr:run.stderr,health:oracleLoaderReady(prepared)}));
      assert.fail('the checking overlay config must hold before program execution');
    }
  }
});

test('both program byte joins preserve BOM, Unicode and nonemitted type inputs',async t=>{
  const root=workspace(t,{'src/main.ts':'\uFEFFimport type {Marker} from "./types.js";\r\nconst value:Marker={value:"é"};console.log(value.value);\r\n','src/types.d.ts':'export interface Marker{value:string}\n'});
  const declaration=join(root,'src/types.d.ts'),worker=new OracleWorker(join(root,'worker'),toolchain);
  try{
    const request={entry:join(root,'src/main.ts'),directory:join(root,'clean')};
    const [prepared]=await worker.prepareBatch([request],boundedCompiler);assert.ok(prepared);
    const run=execute(root,oracleExecution(prepared));assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'é\n');
    for(const program of ['checking','emission'])await assert.rejects(worker.prepareBatch([{...request,directory:join(root,program+'-wrong-bytes')}],async(...args)=>{
      const run=await boundedCompiler(...args);assert.equal(run.status,0,run.stderr);
      const record=JSON.parse(run.stdout);assert.ok(record.inputHashes[program][declaration]);
      record.inputHashes[program][declaration]='0'.repeat(64);
      return {...run,stdout:JSON.stringify(record)+'\n'};
    }),/program input bytes differ from captured original/);
  }finally{worker.close();}
});
test("oracle diagnostics match captured tsgo in the original project context",async t=>{
  // First pair differs only in the declared type package. Both compilers must
  // retain the original project's lookup context, even with no typeRoots.
  for(const typed of [false,true]){
    const root=workspace(t,{'src/main.ts':'console.log(process.pid);\n'});
    symlinkSync(join(REPOSITORY,'node_modules'),join(root,'node_modules'));
    const file=join(root,'tsconfig.json'),config=JSON.parse(readFileSync(file,'utf8'));
    delete config.compilerOptions.typeRoots;
    if(!typed)delete config.compilerOptions.types;
    config.compilerOptions.noErrorTruncation=true;writeFileSync(file,JSON.stringify(config));
    const output=mkdtempSync(join(tmpdir(),'nts-oracle-context-output-'));
    t.after(()=>removeOracleSnapshot(output));
    const worker=new OracleWorker(join(output,'worker'),toolchain);
    try{
      const reference=await boundedCompiler(worker.compiler,['--project',file,'--noEmit','--pretty','false'],root);
      let observed:unknown[]|undefined,status:number|null|undefined,completed=false,rawResult:string|undefined;
      try{
        await worker.prepareBatch([{entry:join(root,'src/main.ts'),project:file,roots:[join(root,'src/main.ts')],directory:join(output,'emitted')}],async(compiler,args,cwd)=>{
          const run=await boundedCompiler(compiler,args,cwd);status=run.status;rawResult=run.stdout;observed=diagnostics(run.stdout+run.stderr,cwd);return run;
        });
        completed=true;
      }catch(error){assert.match(String(error),/oracle TypeScript rejected the program/);}
      assert.ok(observed,'the real oracle compiler must run');
      const expected=diagnostics(reference.stdout+reference.stderr,root);
      assert.equal(reference.status,typed?0:2,reference.stdout+reference.stderr);
      assert.equal(JSON.parse(rawResult!).diagnostics,reference.stdout+reference.stderr,'complete diagnostic bytes match the original project');
      assert.deepEqual(observed,expected,typed?'explicit Node types retain original-project resolution':'undeclared Node types retain every original diagnostic');
      assert.equal(status,reference.status,'oracle and original-project compiler exit statuses agree');
      assert.equal(completed,typed,'only the clean explicit-types subject completes preparation');
    }finally{worker.close();}
  }
});

test("a missing compiler exit status stays unmeasured after emission",async t=>{
  const root=workspace(t,{'src/main.ts':'console.log(19);\n'});
  const worker=new OracleWorker(join(root,'worker'),toolchain);
  try{
    const request={entry:join(root,'src/main.ts'),project:join(root,'tsconfig.json')};
    const [clean]=await worker.prepareBatch([{...request,directory:join(root,'clean')}],boundedCompiler);
    const run=execute(root,oracleExecution(clean));assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');
    const output=join(root,'unmeasured');
    await assert.rejects(worker.prepareBatch([{...request,directory:output}],async(...args)=>{
      const completed=await boundedCompiler(...args);assert.equal(completed.status,0,completed.stdout+completed.stderr);
      return {...completed,status:null};
    }),/not measured.*(?:null|exit status)/is);
    for(const item of readdirSync(output))assert.equal(existsSync(join(output,item,'manifest.json')),false,'unmeasured compiler cannot publish a ready member');
  }finally{worker.close();}
});

test("original implicit roots keep complete diagnostics for every pinned layout trigger",async t=>{
  for(const composite of [false,true])for(const noEmit of [false,true]){
    const root=workspace(t,{'app/main.ts':"import {value} from '../shared.js'; export const answer=value;\n",'shared.ts':'export const value:number=19;\n'});
    ordinaryProject(root,['shared.ts']);
    const project=join(root,'app/tsconfig.json'),entry=join(root,'app/main.ts');
    const layouts=['none','outDir','sourceRoot','mapRoot','declarationDir','tsBuildInfoFile'];
    const outputRoots=layouts.flatMap(layout=>[join(root,'worker-'+composite+'-'+layout),join(root,'emit-'+composite+'-'+layout),join(root,'reference-'+layout+'.json')]);
    for(const layout of layouts){
      const boundedRoot=layout!=='none'&&layout!=='tsBuildInfoFile';
      writeFileSync(project,JSON.stringify({compilerOptions:{target:'esnext',module:'esnext',moduleResolution:'bundler',types:[],strict:true,composite,noEmit,declaration:true,sourceMap:true,...(layout==='tsBuildInfoFile'?{incremental:true,tsBuildInfoFile:'dist/original.info'}:{}),...(boundedRoot?{[layout]:'dist'}:{})},files:['main.ts','../shared.ts']}));
      const worker=new OracleWorker(join(root,'worker-'+composite+'-'+layout),toolchain,outputRoots);
      try{
        const cwd=dirname(project),reference=await boundedCompiler(worker.compiler,['--project',project,'--noEmit','--pretty','false',...((composite||layout==='tsBuildInfoFile')?['--tsBuildInfoFile',join(root,'reference-'+layout+'.json')]:[])],cwd);
        let result:Awaited<ReturnType<typeof boundedCompiler>>|undefined,completed=false;
        try{
          await worker.prepareBatch([{entry,project,directory:join(root,'emit-'+composite+'-'+layout),outputRoots}],async(...args)=>{
            const run=await boundedCompiler(...args);if(JSON.parse(readFileSync(args[1][2]!,'utf8')).project===project)result=run;return run;
          });completed=true;
        }catch(error){assert.match(String(error),/TS6059/);}
        assert.ok(result,'the actual project compiler runs');
        assert.equal(reference.status,boundedRoot?2:0,reference.stdout+reference.stderr);
        if(boundedRoot)assert.match(reference.stdout+reference.stderr,/TS6059/);
        assert.equal(JSON.parse(result.stdout).diagnostics,reference.stdout+reference.stderr,'every complete implicit-root diagnostic byte matches the original project');
        assert.deepEqual(diagnostics(result.stdout+result.stderr,cwd),diagnostics(reference.stdout+reference.stderr,cwd),'every implicit-root diagnostic matches the original project');
        assert.equal(result.status,reference.status);assert.equal(completed,!boundedRoot);
      }finally{worker.close();}
    }
  }
});

test("a missing project exit cannot become completed diagnostic attribution in either order",async t=>{
  for(const missingFirst of [false,true]){
    const bad=workspace(t,{'src/main.ts':"const value:number='wrong'; console.log(value);\n"});
    const clean=workspace(t,{'src/main.ts':'console.log(19);\n'});
    const worker=new OracleWorker(join(clean,'worker'),toolchain);
    const request=(root:string)=>({entry:join(root,'src/main.ts'),project:join(root,'tsconfig.json'),directory:join(root,'emitted')});
    const members=missingFirst?[request(clean),request(bad)]:[request(bad),request(clean)];
    try{
      await assert.rejects(worker.prepareBatch(members,async(...args)=>{
        const run=await boundedCompiler(...args);
        if(JSON.parse(readFileSync(args[1][2]!, 'utf8')).project===join(clean,'tsconfig.json')){assert.equal(run.status,0,run.stdout+run.stderr);return {...run,status:null};}
        assert.equal(run.status,2);assert.match(run.stdout+run.stderr,/TS2322/);return run;
      }),error=>{
        assert.equal(error instanceof TypeScriptDiagnosticError,false,'an unmeasured project cannot trigger diagnostic-only singleton attribution');
        assert.match(String(error),/not measured.*(?:null|exit status)/is);return true;
      });
    }finally{worker.close();}
  }
});

test("a TypeScript diagnostic prevents oracle publication and its clean twin runs",async t=>{
  const bad=workspace(t,{"src/main.ts":"const value:number='bad'; console.log(value);\n"});
  (await assert.rejects(async ()=>(await prepare(bad)),/oracle TypeScript.*TS2322/s));
  const emitted=join(bad,"scratch");
  for(const item of readdirSync(emitted))assert.equal(existsSync(join(emitted,item,"manifest.json")),false);
  const clean=workspace(t,{"src/main.ts":"const value:number=7; console.log(value);\n"});
  const prepared=(await prepare(clean)),run=execute(clean,prepared);
  assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,"7\n");
  const stored=JSON.parse(readFileSync(prepared.manifest,"utf8"));
  assert.equal(stored.groups[0].compilerStatus,0);
  assert.equal(stored.groups[0].options.noEmitOnError,false);
  assert.equal(stored.groups[0].options.rewriteRelativeImportExtensions,true);
});

test("an absolute TypeScript import retains its exact diagnostic obligation until owner output is proved",async t=>{
  const root=workspace(t,{'src/main.ts':'export {};\n','src/value.ts':'export const value=19;\n'});
  writeFileSync(join(root,'src/main.ts'),`import {value} from ${JSON.stringify(join(root,'src/value.ts'))}; console.log(value);\n`);
  const worker=new OracleWorker(join(root,'worker'),toolchain);
  try{
    const reference=await boundedCompiler(worker.compiler,['--project',join(root,'tsconfig.json'),'--noEmit','--pretty','false'],root);
    assert.equal(reference.status,0,reference.stdout+reference.stderr);
    const prepared=oracleExecution((await worker.prepare({entry:join(root,'src/main.ts'),directory:join(root,'absolute')}))),run=execute(root,prepared);
    assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
    const result=JSON.parse(readFileSync(join(dirname(prepared.manifest),'program/program-result.json'),'utf8'));
    assert.ok(result.proof.afterDiagnostics.semantic.some((diagnostic:Diagnostic)=>diagnostic.code===2877));
    assert.deepEqual(result.proof.emitDiagnostics,[],'the complete public emit channel does not repeat this semantic obligation');
    assert.equal(result.deferredImports.length,1);assert.equal(result.deferredImports[0].target,join(root,'src/value.ts'));
    ordinaryProject(root,['src/main.ts']);
    const transitive=oracleExecution(await worker.prepare({entry:join(root,'src/main.ts'),directory:join(root,'transitive')})),imported=execute(root,transitive);
    assert.equal(imported.status,0,imported.stderr);assert.equal(imported.stdout,'19\n');assert.deepEqual(oracleLoaderReady(transitive),{ready:true});
    const owner=(JSON.parse(readFileSync(transitive.manifest,'utf8')) as oracleOwner.OracleManifest).groups[0]!;
    assert.deepEqual(owner.files,[join(root,'src/main.ts')],'an imported file does not become an ordinary root');
    assert.ok(owner.sourceInventory.some(fact=>fact.path===join(root,'src/value.ts')),'the checked Program contains the imported non-root');
    assert.ok(owner.emitted[join(root,'src/value.ts')],'its own owner emits the exact checked target');
    ordinaryProject(root,['src/main.ts','src/value.ts']);
  }finally{worker.close();}
  writeFileSync(join(root,'src/main.ts'),"import {value} from './value.ts'; console.log(value);\n");
  const prepared=(await prepare(root)),run=execute(root,prepared);
  assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');
});

test('an imported non-root requires membership in its nearest owner checked Program',async t=>{
  for(const included of [true,false])await t.test(included?'checked-transitive-target':'absent-from-nearest-owner',async()=>{
    const root=workspace(t,{
      'src/main.ts':"import {value} from '../dependency/value.ts';console.log(value);\n",
      'dependency/anchor.ts':included?"export {value} from './value.js';\n":'export {};\n',
      'dependency/value.ts':'export const value=19;\n',
    });
    const project=ordinaryProject(root,['anchor.ts'],'dependency/tsconfig.json'),target=join(root,'dependency/value.ts');
    const before=readFileSync(project,'utf8'),worker=new OracleWorker(join(root,'worker'),toolchain);
    try{
      const request={entry:join(root,'src/main.ts'),directory:join(root,'emitted')};
      if(!included){
        await assert.rejects(worker.prepare(request),error=>{
          assert.match(String(error),/owner closure has no checking input/);assert.ok(String(error).includes(target));return true;
        });
        return;
      }
      const prepared=oracleExecution(await worker.prepare(request)),run=execute(root,prepared);
      assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
      const stored=JSON.parse(readFileSync(prepared.manifest,'utf8')) as oracleOwner.OracleManifest;
      const owner=stored.groups.find(group=>group.project===project);assert.ok(owner);
      assert.deepEqual(owner.files,[join(root,'dependency/anchor.ts')]);
      assert.ok(owner.sourceInventory.some(fact=>fact.path===target),'nearest owner checks its own imported non-root');
      assert.ok(owner.emitted[target]);assert.equal(owner.emitted[join(root,'dependency/anchor.ts')],undefined,'checking roots outside the requested closure are not published');
    }finally{worker.close();assert.equal(readFileSync(project,'utf8'),before,'owner roots and options stay unchanged');}
  });
});

test("a requested root outside the ordinary project holds without changing that project",async t=>{
  const root=workspace(t,{'src/main.ts':'console.log(19);\n','outside.ts':'console.log(23);\n'});
  const config=readFileSync(join(root,'tsconfig.json'),'utf8');
  (await assert.rejects(async ()=>(await prepare(root,'outside.ts',{roots:[join(root,'outside.ts')]})),error=>String(error).includes('declared entry is not an ordinary root')&&String(error).includes(join(root,'outside.ts'))&&String(error).includes(join(root,'tsconfig.json'))));
  assert.equal(readFileSync(join(root,'tsconfig.json'),'utf8'),config);
  const prepared=(await prepare(root)),run=execute(root,prepared);
  assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');
  const stored=JSON.parse(readFileSync(prepared.manifest,'utf8'));
  assert.equal(stored.groups[0].project,join(root,'tsconfig.json'));
  assert.equal(stored.groups[0].options.rootDir,parse(root).root);
  assert.equal('config' in stored.groups[0],false);
});

test("outside-config inputs preserve diagnostic parity and explicit root constraints",async t=>{
  const root=workspace(t,{'app/main.ts':"import {value} from '../shared/value.ts'; console.log(value);\n",'shared/value.ts':'export const value=19;\n'});
  ordinaryProject(root,['shared/value.ts']);
  const project=join(root,'app/tsconfig.json'),entry=join(root,'app/main.ts');
  for(const explicit of [false,true]){
    writeFileSync(project,JSON.stringify({extends:join(root,'tsconfig.json'),compilerOptions:explicit?{rootDir:'.'}:{},files:['main.ts'],include:[]}));
    const worker=new OracleWorker(join(root,'worker-'+explicit),toolchain);
    try{
      const reference=await boundedCompiler(worker.compiler,['--project',project,'--noEmit','--pretty','false'],dirname(project));
      let result:Awaited<ReturnType<typeof boundedCompiler>>|undefined,completed=false;
      try{
        await worker.prepareBatch([{entry,project,directory:join(root,'emit-'+explicit)}],async(...args)=>{
          const run=await boundedCompiler(...args);if(JSON.parse(readFileSync(args[1][2]!,'utf8')).project===project)result=run;return run;
        });completed=true;
      }catch(error){assert.match(String(error),/TS6059/);}
      assert.ok(result);assert.equal(result.status,reference.status);
      assert.equal(JSON.parse(result.stdout).diagnostics,reference.stdout+reference.stderr);
      assert.deepEqual(diagnostics(result.stdout+result.stderr,dirname(project)),diagnostics(reference.stdout+reference.stderr,dirname(project)));
      assert.equal(completed,!explicit);
      assert.equal(reference.status,explicit?2:0,reference.stdout+reference.stderr);
    }finally{worker.close();}
  }
});

test("the source-owned host project has the original compiler's complete diagnostics",async t=>{
  const output=mkdtempSync(join(tmpdir(),'nts-oracle-host-context-'));
  t.after(()=>removeOracleSnapshot(output));
  const project=join(REPOSITORY,'tooling/conformance/tsconfig.json'),entry=join(REPOSITORY,'tooling/conformance/node-preloads.ts');
  const worker=new OracleWorker(join(output,'worker'),toolchain);
  try{
    const cwd=dirname(project),reference=await boundedCompiler(worker.compiler,['--project',project,'--noEmit','--tsBuildInfoFile',join(output,'reference.tsbuildinfo'),'--pretty','false'],cwd);
    let result:Awaited<ReturnType<typeof boundedCompiler>>|undefined;
    const [prepared]=await worker.prepareBatch([{entry,project,directory:join(output,'emit')}],async(...args)=>result=await boundedCompiler(...args));
    assert.ok(result);assert.equal(reference.status,0,reference.stdout+reference.stderr);assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(JSON.parse(result.stdout).diagnostics,reference.stdout+reference.stderr);
    assert.deepEqual(diagnostics(result.stdout+result.stderr,cwd),diagnostics(reference.stdout+reference.stderr,cwd));
    const stored=JSON.parse(readFileSync(prepared.manifest,'utf8'));
    assert.equal(stored.groups[0].project,project);assert.ok(stored.inputs[project]);assert.ok(stored.sources[entry]);
  }finally{worker.close();}
});

test("the actual outcome consumer's preload roots emit and retain exception reporting",async t=>{
  const root=workspace(t,{'src/main.ts':"throw new RangeError('owner control');\n"});
  const prepared=oracleExecution((await prepare(root,'src/main.ts',{preloads:[...OUTCOME_ORACLE_PRELOADS],sourceAssets:outcomeSourceAssets()})));
  const stored=JSON.parse(readFileSync(prepared.manifest,'utf8'));
  for(const entry of OUTCOME_ORACLE_PRELOADS)assert.ok(stored.sources[entry],'ordinary host project owns the actual consumer preload');
  const run=spawnSync(process.execPath,[...prepared.args,...OUTCOME_ORACLE_PRELOADS.flatMap(file=>['--import',file]),join(root,'src/main.ts')],{encoding:'utf8',cwd:root,env:{...process.env,...prepared.env}});
  assert.equal(run.status,1);assert.equal(run.stdout,'');assert.equal(run.stderr,'nts: uncaught RangeError: owner control\n');
  assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
});

test('owner map choices are preserved without automatic compiler maps',async t=>{
  const authored='data:application/json;base64,'+Buffer.from(JSON.stringify({version:3,sources:['file:///authored/source.ts'],names:[],mappings:'AAAA',sourcesContent:['throw new Error("authored");']})).toString('base64');
  for(const [name,options,kind] of [
    ['disabled',{sourceMap:false,inlineSourceMap:false},'none'],
    ['external',{sourceMap:true,inlineSourceMap:false},'file'],
    ['inline',{sourceMap:false,inlineSourceMap:true},'inline'],
    ['authored-url',{sourceMap:false,inlineSourceMap:false},'none'],
  ] as const)await t.test(name,async()=>{
    const code='const error=new Error("owner-map");console.log(error.message);\n'+(name==='authored-url'?'//# sourceMappingURL='+authored+'\n':'');
    const root=workspace(t,{'src/main.ts':code},{rootDir:'.',...options}),worker=new OracleWorker(join(root,'worker'),toolchain);
    try{
      const [prepared]=await worker.prepareBatch([{entry:join(root,'src/main.ts'),project:join(root,'tsconfig.json'),directory:join(root,'emitted')}],boundedCompiler);
      const stored=JSON.parse(readFileSync(prepared.manifest,'utf8')) as oracleOwner.OracleManifest,group=stored.groups[0]!;
      const output=Object.values(group.emitted)[0]!,bytes=readFileSync(join(dirname(prepared.manifest),group.output,output),'utf8');
      if(name==='authored-url')assert.ok(bytes.trimEnd().endsWith('//# sourceMappingURL='+authored),'the authored URL is kept byte for byte');
      assert.equal(group.options.sourceMap,options.sourceMap,name);assert.equal(group.options.inlineSourceMap,options.inlineSourceMap,name);
      assert.equal(group.maps[output]?.kind,kind,name);
      if(name==='disabled'){assert.doesNotMatch(bytes,/sourceMappingURL=/);assert.equal(group.compilerOutputs.some(file=>file.endsWith('.map')),false);}
      const result=execute(root,oracleExecution(prepared));assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'owner-map\n');
      assert.deepEqual(oracleOwner.finishOracleSnapshot(prepared),{ready:true});
    }finally{worker.close();}
  });
});

test("project map shapes keep diagnostic parity and stock Node stack presentation",async t=>{
  for(const [name,options,_external] of [
    ['none',{},false],['sourceMap',{sourceMap:true},true],['mapRoot',{sourceMap:true,mapRoot:'maps'},true],
    ['sourceRoot',{sourceMap:true,sourceRoot:'virtual-source'},true],['inline',{inlineSourceMap:true},false],
  ] as const){
    const root=workspace(t,{'src/main.ts':'const error=new Error("mapped"); console.log(JSON.stringify({message:error.message,frame:error.stack!.split("\\n")[1]}));\n'},{rootDir:'.',...options});
    const worker=new OracleWorker(join(root,'worker'),toolchain);
    try{
      const project=join(root,'tsconfig.json'),reference=await boundedCompiler(worker.compiler,['--project',project,'--noEmit','--pretty','false'],root);
      let actual:Awaited<ReturnType<typeof boundedCompiler>>|undefined;
      let stock:ReturnType<typeof spawnSync>|undefined,stockFile:string|undefined;
      const [prepared]=await worker.prepareBatch([{entry:join(root,'src/main.ts'),project,directory:join(root,'emitted')}],async(...args)=>{
        actual=await boundedCompiler(...args);
        const record=JSON.parse(actual.stdout);
        for(const output of record.outputs){mkdirSync(dirname(output.path),{recursive:true});writeFileSync(output.path,output.text);}
        stockFile=record.outputs.find((output:EmittedFile)=>output.sourceFileName===join(root,'src/main.ts')&&output.path.endsWith('.js')).path;
        // Run the compiler's untouched files before publication normalizes
        // maps or constructs a runtime tree. This is an independent reference.
        // The shared raw-output cache is outside the owner's package scope.
        writeFileSync(join(dirname(stockFile!),'package.json'),readFileSync(join(root,'package.json')));
        stock=spawnSync(process.execPath,['--enable-source-maps','--no-warnings',stockFile!],{encoding:'utf8',cwd:root,env:process.env});
        return actual;
      });
      assert.ok(actual);assert.equal(reference.status,0,name+reference.stdout+reference.stderr);assert.equal(actual.status,0,name+actual.stdout+actual.stderr);
      assert.deepEqual(diagnostics(actual.stdout+actual.stderr,root),diagnostics(reference.stdout+reference.stderr,root),name);
      const stored=JSON.parse(readFileSync(prepared.manifest,'utf8'));
      assert.equal(stored.groups[0].options.sourceMap,(options as Record<string,unknown>).sourceMap,name);
      assert.equal(stored.groups[0].options.inlineSourceMap,(options as Record<string,unknown>).inlineSourceMap,name);
      const outside=bare(root,prepared),inside=execute(root,oracleExecution(prepared));
      assert.equal(outside.status,0,name+outside.stderr);assert.equal(inside.status,outside.status,name+inside.stderr);
      assert.equal(inside.stdout,outside.stdout,name);assert.equal(inside.stderr,outside.stderr,name);
      assert.ok(stock&&stockFile);assert.equal(stock.status,0,name+stock.stderr);
      t.diagnostic(JSON.stringify({control:'raw-stock-map-'+name,reference:{status:stock.status,stdout:stock.stdout,stderr:stock.stderr}}));
      const executionFile=join(dirname(prepared.manifest),stored.sources[join(root,'src/main.ts')]);
      const presentation=(text:string,file:string)=>text.replaceAll(file,'<emitted-main>');
      assert.equal(presentation(inside.stdout,executionFile),presentation(String(stock.stdout),stockFile),name+' raw stock-map presentation');
      assert.equal(inside.stderr,stock.stderr,name+' raw stock stderr');
    }finally{worker.close();}
  }
});

test('raw owner output preserves module and untyped CommonJS package formats',async t=>{
  for(const module of [true,false])await t.test(module?'module-package':'untyped-commonjs-package',async()=>{
    const root=workspace(t,{'src/main.ts':'const error=new Error("format");console.log(JSON.stringify({commonjs:typeof module==="object",frame:error.stack!.split("\\n")[1]}));\n'});
    const config=join(root,'tsconfig.json'),options=JSON.parse(readFileSync(config,'utf8'));options.compilerOptions.sourceMap=true;writeFileSync(config,JSON.stringify(options));
    const packageFile=join(root,'package.json'),packageBytes=JSON.stringify(module?{name:'owner-format-control',type:'module'}:{name:'owner-format-control'})+'\n';
    writeFileSync(packageFile,packageBytes);
    assert.equal(Object.hasOwn(JSON.parse(packageBytes),'type'),module);
    const worker=new OracleWorker(join(root,'worker'),toolchain);let stock:ReturnType<typeof spawnSync>|undefined;
    try{
      const [prepared]=await worker.prepareBatch([{entry:join(root,'src/main.ts'),project:join(root,'tsconfig.json'),directory:join(root,'emitted')}],async(...args)=>{
        const result=await boundedCompiler(...args);assert.equal(result.status,0,result.stdout+result.stderr);
        const record=JSON.parse(result.stdout);
        for(const output of record.outputs){mkdirSync(dirname(output.path),{recursive:true});writeFileSync(output.path,output.text);}
        const file=record.outputs.find((output:EmittedFile)=>output.sourceFileName===join(root,'src/main.ts')&&output.path.endsWith('.js')).path;
        writeFileSync(join(dirname(file),'package.json'),readFileSync(packageFile));
        assert.equal(readFileSync(join(dirname(file),'package.json'),'utf8'),packageBytes);
        stock=spawnSync(process.execPath,['--enable-source-maps','--no-warnings',file],{cwd:root,env:process.env,encoding:'utf8'});
        return result;
      });
      assert.ok(stock);assert.equal(stock.status,0,String(stock.stderr));assert.equal(JSON.parse(String(stock.stdout)).commonjs,!module);
      const execution=oracleExecution(prepared),run=execute(root,execution);
      assert.equal(run.status,stock.status,run.stderr);assert.equal(run.stdout,stock.stdout);assert.equal(run.stderr,stock.stderr);
      assert.deepEqual(oracleLoaderReady(execution),{ready:true});
      t.diagnostic(JSON.stringify({module,packageBytes,stock:{status:stock.status,stdout:stock.stdout,stderr:stock.stderr}}));
    }finally{worker.close();}
  });
});

for(const present of [true,false])test(`actual source-map URL inputs revalidate their precise ${present?"files":"absence"}`,async t=>{
  const root=workspace(t,{'src/main.ts':'const error=new Error("mapped"); console.log(JSON.stringify({frame:error.stack!.split("\\n")[1]}));\n'},
    {rootDir:'src',sourceMap:true,types:[],typeRoots:[],lib:['esnext','dom']});
  const external=mkdtempSync(join(tmpdir(),'nts-oracle-external-map-'));
  t.after(()=>removeOracleSnapshot(external));
  const mapFile=join(external,'main.js.map'),config=join(root,'tsconfig.json');
  const project=JSON.parse(readFileSync(config,'utf8'));project.compilerOptions.mapRoot=external;writeFileSync(config,JSON.stringify(project));
  const content=(name:string)=>JSON.stringify({version:3,file:'main.js',sourceRoot:'file:///virtual-source/',sources:[name+'.ts'],sourcesContent:['const value=19;'],names:[],mappings:'AAAA'})+'\n';
  const worker=new OracleWorker(join(root,'worker'),toolchain);
  try{
    // Only the encompassing host capture differs between the control and
    // subject. The actual source/project and the changed map bytes are equal.
    for(const captured of [true,false]){
      if(present)writeFileSync(mapFile,content('before'));else rmSync(mapFile,{force:true});
      let declarations:OracleOptions["declarations"];
      if(captured){
        const host=new OracleFilesystem();host.fileExists(mapFile);host.readBytes(mapFile);
        declarations={descriptor:{purpose:'actual-source-map-control'},files:present?{[mapFile]:createHash('sha256').update(readFileSync(mapFile)).digest('hex')}:{},absent:present?[]:[mapFile],observations:host.captured()};
      }
      const request={entry:join(root,'src/main.ts'),project:config,...(declarations?{declarations}:{})};
      const control=(await worker.prepare({...request,directory:join(root,'control-'+present+'-'+captured)}));
      const before=oracleExecution(control),first=execute(root,before);
      assert.equal(first.status,0,first.stderr);assert.deepEqual(oracleLoaderReady(before),{ready:true});
      if(present)assert.match(first.stdout,/before\.ts:1:1/);
      assert.deepEqual(oracleOwner.finishOracleSnapshot(control),{ready:true});
      const subject=(await worker.prepare({...request,directory:join(root,'subject-'+present+'-'+captured)}));
      writeFileSync(mapFile,content('after'));
      const after=oracleExecution(subject),changed=execute(root,after),health=oracleLoaderReady(after);
      assert.deepEqual(health,{ready:true},'the child executes only the captured map or its captured absence');
      assert.equal(changed.stdout.replaceAll(dirname(subject.manifest),'<snapshot>'),first.stdout.replaceAll(dirname(control.manifest),'<snapshot>'),'changed originals never change the snapshot output');
      const final=oracleOwner.finishOracleSnapshot(subject);
      assert.equal(final.ready,false,'a changed actual map URL input or appeared map must hold the final owner result');
      if(!final.ready)assert.ok(final.why.includes(mapFile),final.why);
    }
  }finally{worker.close();}
});

test("actual output inventory rejects missing and unowned executable outputs",async t=>{
  for(const mutation of ['missing','unowned']){
    const root=workspace(t,{'src/main.ts':'console.log(19);\n'}),worker=new OracleWorker(join(root,'worker'),toolchain);
    try{
      const request={entry:join(root,'src/main.ts'),project:join(root,'tsconfig.json')};
      const [control]=await worker.prepareBatch([{...request,directory:join(root,'control')}],boundedCompiler);
      const run=execute(root,oracleExecution(control));assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');
      await assert.rejects(worker.prepareBatch([{...request,directory:join(root,'subject')}],async(...args)=>{
        const result=await boundedCompiler(...args);assert.equal(result.status,0);
        const record=JSON.parse(result.stdout);
        if(mutation==='missing')record.outputs=record.outputs.filter((output:EmittedFile)=>!output.path.endsWith('/main.js'));
        else record.outputs.push({path:join(record.options.outDir,'unowned.js'),text:'console.log(23);\n'});
        return {...result,stdout:JSON.stringify(record)+'\n'};
      }),mutation==='missing'?/did not emit/:/no captured source owner/);
    }finally{worker.close();}
  }
});

test("valid strict emit rewrites relative TypeScript imports to JavaScript",async t=>{
  const root=workspace(t,{
    "src/main.ts":"import {value} from './value.ts'; console.log(value);\n",
    "src/value.ts":"export const value:number=17;\n",
  });
  const prepared=(await prepare(root)),stored=JSON.parse(readFileSync(prepared.manifest,"utf8"));
  const output=readFileSync(join(dirname(prepared.manifest),stored.sources[join(root,"src/main.ts")]),"utf8");
  assert.match(output,/\.\/value\.js/);assert.doesNotMatch(output,/from ['"]\.\/value\.ts['"]/);
  const run=execute(root,prepared);assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,"17\n");
});

test('one application tree owns runtime code, data and relative links independently of their origin',async t=>{
  const root=workspace(t,{
    'src/main.ts':'export const value:number=19;\n',
    'tooling/driver.cjs':"const fs=require('node:fs');require(process.argv[2]);console.log(fs.readFileSync(process.argv[3],'utf8'));console.log(fs.readlinkSync(process.argv[4]));\n",
  });
  const suite=mkdtempSync(join(tmpdir(),'nts-oracle-runtime-suite-'));t.after(()=>removeOracleSnapshot(suite));
  writeFileSync(join(suite,'case.cjs'),'console.log(19);\n');writeFileSync(join(suite,'data.txt'),'captured');symlinkSync('data.txt',join(suite,'link'));
  const alias=join(root,'suite');symlinkSync(suite,alias);
  const project=ordinaryProject(root,['main.ts'],'src/tsconfig.json'),entry=join(root,'tooling/driver.cjs');
  const request={entry,project:null,preloads:[{entry:join(root,'src/main.ts'),project}],runtimeRoots:[alias],toolchain,directory:join(root,'prepared')};
  const prepared=(await prepareOracle(request)),stored=JSON.parse(readFileSync(prepared.manifest,'utf8'));
  const index=JSON.parse(readFileSync(join(dirname(prepared.manifest),'source-index.json'),'utf8'));
  assert.equal(index.trees.filter((tree:{root:string})=>tree.root==='tree/application').length,1);
  const run=(prepared:OraclePrepared)=>{
    const execution=oracleExecution(prepared),args=[entry,...['case.cjs','data.txt','link'].map(file=>join(alias,file))].map(file=>oracleRuntimeFile(prepared,file));
    const actual=spawnSync(process.execPath,[...execution.args,...args],{cwd:root,encoding:'utf8',env:{...process.env,...execution.env}});
    return {actual,health:oracleLoaderReady(execution)};
  };
  const first=run(prepared);assert.equal(first.actual.status,0,first.actual.stderr);assert.equal(first.actual.stdout,'19\ncaptured\ndata.txt\n');assert.deepEqual(first.health,{ready:true});
  assert.ok(stored.inputs[join(suite,'case.cjs')]);
  writeFileSync(join(suite,'case.cjs'),'console.log(23);\n');
  const stale=run(prepared);assert.deepEqual(stale.health,{ready:true});assert.equal(stale.actual.stdout,first.actual.stdout);
  const final=oracleOwner.finishOracleSnapshot(prepared);assert.equal(final.ready,false);if(!final.ready)assert.match(final.why,/filesystem file changed/);
  const fresh=(await prepareOracle({...request,directory:join(root,'fresh')})),current=run(fresh);
  assert.equal(current.actual.status,0,current.actual.stderr);assert.equal(current.actual.stdout,'23\ncaptured\ndata.txt\n');assert.deepEqual(current.health,{ready:true});
  const captured=[entry,...['case.cjs','data.txt','link'].map(file=>join(alias,file))].map(file=>oracleRuntimeFile(fresh,file));
  chmodSync(dirname(captured[3]!),0o700);
  rmSync(captured[3]!);symlinkSync(join(suite,'data.txt'),captured[3]!);
  const escaped=oracleExecution(fresh),outside=spawnSync(process.execPath,[...escaped.args,...captured],{cwd:root,encoding:'utf8',env:{...process.env,...escaped.env}});
  const escapedHealth=oracleLoaderReady(escaped);assert.equal(escapedHealth.ready,false,'a copied link cannot be redirected to an origin inode');
  if(!escapedHealth.ready)assert.match(escapedHealth.why,/filesystem (readlink|runtimeKind) changed/);
  assert.equal(outside.stdout,'23\ncaptured\n','earlier validated reads complete, but the changed link is never returned');
  symlinkSync(join(suite,'data.txt'),join(suite,'absolute'));
  (await assert.rejects(async ()=>(await prepareOracle({...request,directory:join(root,'unsafe')})),/runtime asset has an absolute symlink/));
});

test('a new package inside the captured runtime tree cannot change a prepared module goal',async t=>{
  const root=workspace(t,{'src/main.ts':'console.log(this===undefined);\n'},{module:'preserve',moduleResolution:'bundler'});
  writeFileSync(join(root,'package.json'),'{"type":"commonjs"}');
  const prepared=(await prepare(root)),healthy=oracleExecution(prepared),first=execute(root,healthy);
  assert.equal(first.status,0,first.stderr);assert.equal(first.stdout,'false\n');assert.deepEqual(oracleLoaderReady(healthy),{ready:true});
  const stored=JSON.parse(readFileSync(prepared.manifest,'utf8')),file=join(dirname(prepared.manifest),stored.sources[join(root,'src/main.ts')]);
  chmodSync(dirname(file),0o700);
  writeFileSync(join(dirname(file),'package.json'),'{"type":"module"}');
  const changed=oracleExecution(prepared),actual=execute(root,changed);
  assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,first.stdout,'the authenticated route retains Node\'s prepared format');
  assert.deepEqual(oracleLoaderReady(changed),{ready:true});assert.deepEqual(oracleOwner.finishOracleSnapshot(prepared),{ready:true});
});

test('repeated bootstrap accepts only exact identity-bound tooling files',async t=>{
  const root=workspace(t,{'src/main.ts':`import {pathToFileURL} from 'node:url';
const target=new URL('./assets/'+(process.argv[2]??'oracle-loader.ts'),pathToFileURL(process.env.NTS_ORACLE_EMIT_MANIFEST!));
try{await import(target.href);}catch{}
console.log('application');\n`});
  const prepared=(await prepare(root));
  const run=(name?:string)=>{
    const execution=oracleExecution(prepared),actual=spawnSync(process.execPath,[...execution.args,join(root,'src/main.ts'),...(name?[name]:[])],{cwd:root,encoding:'utf8',env:{...process.env,...execution.env}});
    return {actual,health:oracleLoaderReady(execution)};
  };
  const healthy=run();assert.equal(healthy.actual.status,0,healthy.actual.stderr);assert.equal(healthy.actual.stdout,'application\n');assert.deepEqual(healthy.health,{ready:true});
  chmodSync(join(dirname(prepared.manifest),'assets'),0o700);
  writeFileSync(join(dirname(prepared.manifest),'assets/unowned.ts'),"console.log('unowned');export {};\n");
  for(const name of ['unowned.ts','oracle-loader.ts?again=1']){
    const held=run(name);assert.equal(held.actual.stdout,'application\n');assert.equal(held.health.ready,false,'a bootstrap directory or variant has no blanket authority');
  }
});

test("a zero compiler status cannot hide a diagnostic",async t=>{
  const root=workspace(t,{"src/main.ts":"console.log(7);\n"});
  const worker=new OracleWorker(join(root,'worker'),toolchain);
  try{
    await assert.rejects(worker.prepareBatch([{entry:join(root,'src/main.ts'),directory:join(root,'emitted')}],async(...args)=>{
      const run=await boundedCompiler(...args);assert.equal(run.status,0);
      const record=JSON.parse(run.stdout);record.diagnostics='error TS9999: diagnostic status mismatch\n';
      return {...run,stdout:JSON.stringify(record)+'\n'};
    }),/oracle public emit was not measured: 0;.*TS9999/s);
    for(const item of readdirSync(join(root,'emitted')))
      assert.equal(existsSync(join(root,'emitted',item,'manifest.json')),false);
  }finally{worker.close();}
});

test("rewritten mts and cts imports retain their module goals and governed CJS holds",async t=>{
  for(const extension of ['mts','cts']){
    const root=workspace(t,{
      ['src/main.'+extension]:`import {value} from './value.${extension}'; console.log(value);\n`,
      ['src/value.'+extension]:"export const value:number=19;\n",
    },{module:'nodenext',moduleResolution:'nodenext'});
    const prepared=(await prepare(root,'src/main.'+extension));
    const reference=bare(root,prepared,'src/main.'+extension);assert.equal(reference.status,0,reference.stderr);assert.equal(reference.stdout,'19\n');
    const run=execute(root,prepared,'src/main.'+extension);
    if(extension==='mts'){assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,reference.stdout);assert.deepEqual(oracleLoaderReady(prepared),{ready:true});}
    else {const health=oracleLoaderReady(prepared);assert.equal(health.ready,false);if(!health.ready)assert.match(health.why,/unproved CommonJS route: \.\/value\.cjs/);}
  }
});

test("NodeNext TS imports preserve the package-type-only module goal",async t=>{
  const root=workspace(t,{
    'src/main.ts':"import {value} from './value.ts'; console.log(value);\n",
    'src/value.ts':'export const value:number=19;\n',
  },{module:'nodenext',moduleResolution:'nodenext'});
  writeFileSync(join(root,'package.json'),'{"type":"commonjs"}');
  const first=(await prepare(root)),reference=bare(root,first),subject=execute(root,first);
  assert.equal(reference.status,0,reference.stderr);assert.equal(reference.stdout,'19\n');
  const health=oracleLoaderReady(first);assert.equal(health.ready,false);if(!health.ready)assert.match(health.why,/unproved CommonJS route: \.\/value\.js/);
  const firstIndex=JSON.parse(readFileSync(join(dirname(first.manifest),'source-index.json'),'utf8'));
  assert.ok(firstIndex.files.every((item:OracleRuntimeRoute)=>!('format' in item)&&!('decision' in item)));
  assert.equal(readFileSync(join(dirname(first.manifest),firstIndex.trees[0].root,root.slice(1),'package.json'),'utf8'),'{"type":"commonjs"}');
  writeFileSync(join(root,'package.json'),'{"type":"module"}');
  const second=(await prepare(root)),control=execute(root,second);
  const secondIndex=JSON.parse(readFileSync(join(dirname(second.manifest),'source-index.json'),'utf8'));
  assert.ok(secondIndex.files.every((item:OracleRuntimeRoute)=>!('format' in item)&&!('decision' in item)));
  assert.equal(readFileSync(join(dirname(second.manifest),secondIndex.trees[0].root,root.slice(1),'package.json'),'utf8'),'{"type":"module"}');
  assert.equal(control.status,0,control.stderr);assert.equal(control.stdout,'19\n');
  assert.notEqual(subject.status,0,'the CJS lookup must hold before Node selects a relative file');assert.equal(subject.stdout,'');
});

test("Preserve type-only imports keep the emitted JavaScript goal",async t=>{
  const body="console.log(this===undefined);\n";
  const root=workspace(t,{
    'src/main.ts':"import type {Value} from './types.ts';\n"+body,
    'src/types.ts':'export interface Value { value:number; }\n',
  },{module:'preserve',moduleResolution:'bundler'});
  writeFileSync(join(root,'package.json'),'{"type":"commonjs"}');
  const compare=(prepared:OraclePrepared)=>{
    const manifest=JSON.parse(readFileSync(prepared.manifest,'utf8'));
    const output=join(dirname(prepared.manifest),manifest.sources[join(root,'src/main.ts')]);
    const oracle=execute(root,prepared);
    const bare=spawnSync(process.execPath,['--no-warnings',output],{cwd:root,env:process.env,encoding:'utf8'});
    assert.equal(bare.status,0,bare.stderr);assert.equal(oracle.status,0,oracle.stderr);
    return {oracle:oracle.stdout,bare:bare.stdout};
  };
  const subject=compare((await prepare(root)));
  writeFileSync(join(root,'src/main.ts'),body);
  const control=compare((await prepare(root)));
  assert.equal(control.oracle,'false\n');assert.equal(control.bare,'false\n');
  assert.equal(subject.bare,'false\n');assert.equal(subject.oracle,subject.bare);
});

test("captured runtime assets preserve fs identity and caught misses hold only their execution",async t=>{
  const root=workspace(t,{
    'src/main.mjs':`import fs from 'node:fs';
import promises from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),named=await import('node:fs');
console.log(fs.readFileSync===require('fs').readFileSync,fs.readFileSync===named.readFileSync);
console.log(fs.readFileSync(new URL('./data.txt',import.meta.url),'utf8'));
if(process.argv[2]){
  const path=new URL('./missing-'+process.argv[2],import.meta.url);
  try{
    const key=process.argv[2];
    if(key==='exists')console.log(fs.existsSync(path));
    else if(key==='read')fs.readFileSync(path);
    else if(key==='opendir')await promises.opendir(path);
    else if(key==='readdir')fs.readdirSync(path);
    else if(key==='stat')fs.statSync(path);
    else if(key==='access')await promises.access(path);
  }catch(error){console.log(error.code);}
}
`,
    'src/data.txt':'captured sibling',
  });
  const prepared=(await prepare(root,'src/main.mjs',{project:null,runtimeRoots:[join(root,'src/data.txt')]}));
  for(const key of ['exists','read','opendir','readdir','stat','access']){
    const own=oracleExecution(prepared);
    const run=spawnSync(process.execPath,[...own.args,join(root,'src/main.mjs'),key],{encoding:'utf8',env:{...process.env,...own.env}});
    assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,`true true\ncaptured sibling\n${key==='exists'?'false':'ENOENT'}\n`);
    const health=oracleLoaderReady(own);assert.equal(health.ready,false);
    if(!health.ready)assert.match(health.why,/runtime asset was not captured: .*missing-/);
  }
  const healthy=oracleExecution(prepared),run=execute(root,healthy,'src/main.mjs');
  assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'true true\ncaptured sibling\n');
  assert.deepEqual(oracleLoaderReady(healthy),{ready:true});
});

test("every external JavaScript load needs a captured owner",async t=>{
  const root=workspace(t,{
    'src/main.mjs':'',
    'outside/value.mjs':'export const value=19;\n',
  },{allowJs:true,checkJs:false});
  const member=join(root,'outside/value.mjs');
  // The entry bytes are identical in both arms. Only the enclosing capture
  // differs; no resolved module may execute from the live source filesystem.
  writeFileSync(join(root,'src/main.mjs'),'const target='+JSON.stringify(pathToFileURL(member).href)+
    ';console.log((await import(target)).value);\n');
  const subject=(await prepare(root,'src/main.mjs',{project:null}));
  const control=(await prepare(root,'src/main.mjs',{project:join(root,'tsconfig.json'),runtimeRoots:[member]}));
  const healthy=oracleExecution(control),first=execute(root,healthy,'src/main.mjs');
  assert.equal(first.status,0,first.stderr);assert.equal(first.stdout,'19\n');
  assert.deepEqual(oracleLoaderReady(healthy),{ready:true});
  for(const changed of [false,true]){
    if(changed)writeFileSync(member,'export const value=23;\n');
    const own=oracleExecution(subject),run=execute(root,own,'src/main.mjs');
    const health=oracleLoaderReady(own);
    assert.equal(health.ready,false,'an unobserved external module cannot execute as a healthy oracle');
    if(!health.ready)assert.ok(health.why.includes('value.mjs'),health.why);
    assert.equal(run.stdout,'','unobserved module code never executes');
  }
  const stale=oracleExecution(control),snapshot=execute(root,stale,'src/main.mjs');assert.equal(snapshot.status,0,snapshot.stderr);assert.equal(snapshot.stdout,'19\n');assert.deepEqual(oracleLoaderReady(stale),{ready:true});
  const health=oracleOwner.finishOracleSnapshot(control);assert.equal(health.ready,false);
  if(!health.ready)assert.match(health.why,/filesystem file changed:/);
});

test("an owned large module driver preserves stdin and a CommonJS program's own format",async t=>{
  const root=workspace(t,{
    'src/main.ts':"import {readFileSync} from 'node:fs'; console.log('program',this===undefined,readFileSync(0,'utf8')); export const value:number=19;\n",
  },{module:'nodenext',moduleResolution:'nodenext'});
  writeFileSync(join(root,'package.json'),'{"type":"commonjs"}');
  const owned=join(root,'owned');mkdirSync(owned);
  const prepared=(await prepare(root,'src/main.ts',{outputRoots:[owned]}));
  const stored=JSON.parse(readFileSync(prepared.manifest,'utf8'));
  const source=pathToFileURL(join(root,'src/main.ts')).href;
  const output=pathToFileURL(join(dirname(prepared.manifest),stored.sources[join(root,'src/main.ts')])).href;
  const body="console.log('driver',this===undefined); const value=await import("+JSON.stringify(source)+");console.log(value.value);\n//"+'padding'.repeat(45000)+'\n';
  assert.ok(Buffer.byteLength(body)>262144,'the complete driver exceeds Linux single-argument limits');
  const driver=join(owned,'driver.mjs'),plain=join(owned,'plain.mjs');
  writeFileSync(driver,body);writeFileSync(plain,body.replace(source,output));
  const reference=spawnSync(process.execPath,[plain],{cwd:root,env:process.env,input:'stdin payload',encoding:'utf8'});
  assert.equal(reference.status,0,reference.stderr);assert.equal(reference.stdout,'driver true\nprogram false stdin payload\n19\n');
  const run=(own:OraclePrepared)=>spawnSync(process.execPath,[...own.args,driver],{cwd:root,env:{...process.env,...own.env},input:'stdin payload',encoding:'utf8'});
  const absent=oracleExecution(prepared);run(absent);assert.equal(oracleLoaderReady(absent).ready,false);
  const healthy=oracleExecution(prepared,driver),actual=run(healthy);
  assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,reference.stdout);assert.deepEqual(oracleLoaderReady(healthy),{ready:true});
  const changed=oracleExecution(prepared,driver);writeFileSync(driver,body+'// changed\n');
  const rejected=run(changed),changedHealth=oracleLoaderReady(changed);
  assert.equal(rejected.stdout,'');assert.equal(changedHealth.ready,false);
  if(!changedHealth.ready)assert.match(changedHealth.why,/execution driver changed/);
  writeFileSync(driver,body);
  const mismatch=oracleExecution(prepared,driver),record=join(dirname(mismatch.loaderState),'module-inputs.json');
  const identity=JSON.parse(readFileSync(record,'utf8'));identity.manifestSha256='0'.repeat(64);writeFileSync(record,JSON.stringify(identity));
  const held=run(mismatch),heldHealth=oracleLoaderReady(mismatch);assert.equal(held.stdout,'');assert.equal(heldHealth.ready,false);
  if(!heldHealth.ready)assert.match(heldHealth.why,/execution module input identity mismatch/);
});

test("promisified filesystem probes preserve callable properties and observe caught missing assets",async t=>{
  const root=workspace(t,{
    'src/main.mjs':`import fs from 'node:fs';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),named=await import('node:fs');
const exists=promisify(fs.exists),descriptor=Object.getOwnPropertyDescriptor(fs.exists,promisify.custom);
console.log(fs.exists===require('fs').exists,fs.exists===named.exists,exists===fs.exists[promisify.custom]);
console.log(descriptor?.writable,descriptor?.enumerable,descriptor?.configurable);
try{const result=await exists(new URL('./'+(process.argv[2]||'data.txt'),import.meta.url));console.log(typeof result,result);}catch(error){console.log('rejected',error);}
`,
    'src/data.txt':'captured sibling',
  });
  const prepared=(await prepare(root,'src/main.mjs',{project:null,runtimeRoots:[join(root,'src/data.txt')]}));
  const index=JSON.parse(readFileSync(join(dirname(prepared.manifest),'source-index.json'),'utf8'));
  const output=join(dirname(prepared.manifest),index.trees[0].root,root.slice(1),'src/main.mjs');
  for(const name of ['data.txt','missing.txt']){
    const reference=spawnSync(process.execPath,[output,name],{cwd:root,env:process.env,encoding:'utf8'});
    assert.equal(reference.status,0,reference.stderr);
    assert.equal(reference.stdout,`true true true\nfalse false false\nboolean ${name==='data.txt'}\n`);
    const own=oracleExecution(prepared);
    const run=spawnSync(process.execPath,[...own.args,join(root,'src/main.mjs'),name],{cwd:root,env:{...process.env,...own.env},encoding:'utf8'});
    assert.equal(run.status,reference.status,run.stderr);assert.equal(run.stdout,reference.stdout);
    const health=oracleLoaderReady(own);
    if(name==='data.txt')assert.deepEqual(health,{ready:true});
    else{assert.equal(health.ready,false);if(!health.ready)assert.match(health.why,/runtime asset was not captured: .*missing\.txt/);}
  }
  const following=oracleExecution(prepared);execute(root,following,'src/main.mjs');
  assert.deepEqual(oracleLoaderReady(following),{ready:true});
});

test("one NodeNext program preserves mixed mts and cts output goals",async t=>{
  const root=workspace(t,{
    'src/main.mts':"import {c} from './c.cts'; import {m} from './m.mts'; console.log(c+m);\n",
    'src/c.cts':'export const c:number=19;\n',
    'src/m.mts':'export const m:number=23;\n',
  },{module:'nodenext',moduleResolution:'nodenext'});
  const prepared=(await prepare(root,'src/main.mts')),run=execute(root,prepared,'src/main.mts');
  assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'42\n');
});

test("package TS exports retain emitted providers and governed bare CommonJS holds",async t=>{
  for(const extension of ['ts','mts','cts']){
    const root=workspace(t,{
      ['src/main.'+extension]:extension==='cts'?"console.log(require('pkg').value);\n":"import {value} from 'pkg';console.log(value);\n",
      'node_modules/pkg/package.json':JSON.stringify({name:'pkg',version:'1.0.0',type:extension==='cts'?'commonjs':'module',exports:'./index.'+extension}),
      ['node_modules/pkg/index.'+extension]:'enum Choice { Value=19 } export const value=Choice.Value;\n',
    },{module:'nodenext',moduleResolution:'nodenext'});
    writeFileSync(join(root,'package.json'),JSON.stringify({type:extension==='cts'?'commonjs':'module'}));
    const entry='src/main.'+extension,member=join(root,'node_modules/pkg/index.'+extension);
    const project=ordinaryProject(root,['index.'+extension],'node_modules/pkg/tsconfig.json');
    const prepared=(await prepare(root,entry,{preloads:[{entry:member,project,roots:[member]}]}));
    const stored=JSON.parse(readFileSync(prepared.manifest,'utf8'));
    assert.ok(stored.sources[member],'the non-erasable package entry must have real emitted output');
    const run=execute(root,prepared,entry),health=oracleLoaderReady(prepared);
    if(extension==='cts'){
      const output=resolve(dirname(prepared.manifest),stored.sources[member]);
      const reference=spawnSync(process.execPath,['-e','console.log(require(process.argv[1]).value)',output],{cwd:root,encoding:'utf8'});
      assert.equal(reference.status,0,reference.stderr);assert.equal(reference.stdout,'19\n');
      assert.equal(health.ready,false);if(!health.ready)assert.match(health.why,/unproved CommonJS route: pkg/);
    }else {assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');assert.deepEqual(health,{ready:true});}
  }
});

test("a newly nearer package scope invalidates a captured script goal",async t=>{
  const root=workspace(t,{'src/deep/main.ts':'console.log(this===undefined);\n'});
  writeFileSync(join(root,'package.json'),'{"type":"commonjs"}');
  const extra={roots:[join(root,'src/deep/main.ts')]},prepared=(await prepare(root,'src/deep/main.ts',extra));
  const first=execute(root,prepared,'src/deep/main.ts');assert.equal(first.status,0,first.stderr);assert.equal(first.stdout,'false\n');
  const nearer=join(root,'src/deep/package.json'),manifest=JSON.parse(readFileSync(prepared.manifest,'utf8'));
  assert.ok(manifest.observations.some((item:HostObservation)=>item.path===nearer&&(item.kind==='fileExists'&&item.value===false||item.kind==='file'&&item.value===null)),'the failed nearer scope lookup is recorded');
  writeFileSync(nearer,'{"type":"module"}');
  const stale=oracleExecution(prepared),snapshot=execute(root,stale,'src/deep/main.ts');assert.equal(snapshot.status,0,snapshot.stderr);assert.equal(snapshot.stdout,'false\n');assert.deepEqual(oracleLoaderReady(stale),{ready:true});
  const final=oracleOwner.finishOracleSnapshot(prepared);assert.equal(final.ready,false);if(!final.ready)assert.match(final.why,/filesystem (file|fileExists|entries) changed/);
  const fresh=(await prepare(root,'src/deep/main.ts',extra)),current=execute(root,fresh,'src/deep/main.ts');
  assert.equal(current.status,0,current.stderr);assert.equal(current.stdout,'true\n');
});

test("a rewritten TSX import ignores an unrelated TS sibling",async t=>{
  for(const jsx of ['react-jsx','preserve']){
    const root=workspace(t,{
      'src/main.ts':"import {value} from './value.tsx'; console.log(value);\n",
      'src/value.tsx':'export const value:number=19;\n',
      'src/value.ts':'export const value:number=23;\n',
    },{jsx});
    ordinaryProject(root,['src/main.ts','src/value.tsx']);
    const extra={roots:[join(root,'src/main.ts'),join(root,'src/value.tsx')]};
    const run=async ()=>{
      const prepared=(await prepare(root,'src/main.ts',extra)),stored=JSON.parse(readFileSync(prepared.manifest,'utf8'));
      const oracle=execute(root,prepared),bare=spawnSync(process.execPath,['--no-warnings',join(dirname(prepared.manifest),stored.sources[join(root,'src/main.ts')])],{encoding:'utf8',env:process.env});
      assert.equal(oracle.status,bare.status,oracle.stderr);assert.equal(oracle.stdout,bare.stdout);
      if(jsx==='preserve'){assert.equal(oracle.status,1);assert.match(oracle.stderr,/ERR_UNKNOWN_FILE_EXTENSION/);}
      else{assert.equal(oracle.status,0,oracle.stderr);assert.equal(oracle.stdout,'19\n');}
      return oracle;
    };
    const subject=await run();rmSync(join(root,'src/value.ts'));const control=await run();
    assert.equal(subject.status,control.status);assert.equal(subject.stdout,control.stdout);
  }
});

test("rewritten imports stay in the owning emitted project",async t=>{
  const root=workspace(t,{
    'src/main.ts':"import {value} from './value.tsx'; console.log(value);\n",
    'src/value.tsx':'export const value:number=19;\n',
    'preload/value.ts':'export const value:number=23;\n',
  },{jsx:'react-jsx'});
  ordinaryProject(root,['src/main.ts','src/value.tsx']);
  const preload=ordinaryProject(root,['value.ts'],'preload/tsconfig.json');
  const prepared=(await prepare(root,'src/main.ts',{
    roots:[join(root,'src/main.ts'),join(root,'src/value.tsx')],
    preloads:[{entry:join(root,'preload/value.ts'),project:preload,roots:[join(root,'preload/value.ts')]}],
  }));
  const run=execute(root,prepared);assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');
});

test("captured emitted routes preserve query and fragment module identity",async t=>{
  const root=workspace(t,{
    'src/main.ts':"import {value} from './value.ts'; const other=await import('./value.'+String('js?token=1#part')); console.log(value,other.value,other.url.endsWith('/value.js?token=1#part'));\n",
    'src/value.ts':'export const value:number=19; export const url=import.meta.url;\n',
  });
  const run=execute(root,(await prepare(root)));assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19 19 true\n');
});

test("conflicting captured routes hold instead of selecting a parent context",async t=>{
  const root=workspace(t,{
    'src/main.ts':"import {value} from './value.tsx'; console.log(value);\n",
    'src/value.tsx':'export const value:number=19;\n',
    'src/other.ts':'export const value:number=23;\n',
  },{jsx:'react-jsx'});
  ordinaryProject(root,['src/main.ts','src/value.tsx']);
  const same=ordinaryProject(root,['src/main.ts'],'tsconfig.same.json');
  const otherProject=ordinaryProject(root,['src/other.ts'],'tsconfig.other.json');
  const prepared=(await prepare(root,'src/main.ts',{
    roots:[join(root,'src/main.ts'),join(root,'src/value.tsx')],
    preloads:[
      {entry:join(root,'src/main.ts'),project:same,roots:[join(root,'src/main.ts')]},
      {entry:join(root,'src/other.ts'),project:otherProject,roots:[join(root,'src/other.ts')]},
    ],
  }));
  const clean=oracleExecution(prepared),run=execute(root,clean);
  assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');assert.deepEqual(oracleLoaderReady(clean),{ready:true});
  const own=dirname(prepared.manifest),manifest=JSON.parse(readFileSync(prepared.manifest,'utf8'));
  const indexPath=join(own,'source-index.json'),index=JSON.parse(readFileSync(indexPath,'utf8'));
  const values=index.files.filter((item:OracleRuntimeRoute)=>item.source===join(root,'src/value.tsx'));
  assert.equal(manifest.groups.filter((group:oracleOwner.EmitGroup)=>group.sourceInventory.some((file:oracleOwner.EmitGroup['sourceInventory'][number])=>file.path===join(root,'src/value.tsx'))).length,2,'both complete checking contexts remain');
  assert.equal(values.length,1,'one nearest owner publishes one shared runtime route');
  const other=index.files.find((item:OracleRuntimeRoute)=>item.source===join(root,'src/other.ts'));
  const altered=changedSnapshot(prepared,records=>{
    const selected=(records.get('source\0'+join(root,'src/value.tsx')) as OracleRuntimeRoute[])[0]!;
    for(const file of [selected.output,selected.execution]){
      const node=records.get('path\0'+join(own,file)) as OracleRuntimeNode;
      node.compiled!.source=other.source;
    }
  });
  const conflicting=oracleExecution(altered),bad=execute(root,conflicting);assert.notEqual(bad.status,0);assert.equal(bad.stdout,'');
  const health=oracleLoaderReady(conflicting);assert.equal(health.ready,false);
  if(!health.ready)assert.match(health.why,/ambiguous oracle emitted import contexts|no captured owner|source identity mismatch/);
});

test("a caught missing emitted route stays an instrument failure",async t=>{
  const root=workspace(t,{
    'src/main.ts':"const target='../hidden/'+String('late.ts'); try { await import(target); } catch {} console.log('caught'); export {};\n",
    'hidden/late.ts':'export const value:number=1;\n',
  });
  const prepared=(await prepare(root,'src/main.ts',{roots:[join(root,'src/main.ts')]}));
  const run=execute(root,prepared);assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'caught\n');
  const health=oracleLoaderReady(prepared);assert.equal(health.ready,false);
  if(!health.ready)assert.match(health.why,/resolution context was not captured: .*; unprepared direct module request/);
});

test("native outcome output leaves prepared source listings intact; source writes still hold",async t=>{
  const root=workspace(t,{"project/src/main.ts":"console.log(7); export {};\n"});
  const project=join(root,"project");
  writeFileSync(join(project,"tsconfig.json"),JSON.stringify({extends:"../tsconfig.json",include:["src"]}));
  const output=nativeOutput(root,project);
  mkdirSync(output,{recursive:true});
  const prepared=(await prepareOracle({toolchain,entry:join(project,"src/main.ts"),project:join(project,"tsconfig.json"),directory:join(root,"emit")}));
  writeFileSync(join(output,"program.c"),"/* native output */\n");
  const clean=oracleExecution(prepared),run=execute(project,clean);
  assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,"7\n");
  assert.deepEqual(oracleLoaderReady(clean),{ready:true});
  // A tool that writes into the prepared project changes an observed lookup.
  mkdirSync(join(project,"out"));writeFileSync(join(project,"out/program.c"),"/* misplaced output */\n");
  const stale=oracleExecution(prepared),snapshot=execute(project,stale);assert.equal(snapshot.status,0,snapshot.stderr);assert.equal(snapshot.stdout,'7\n');assert.deepEqual(oracleLoaderReady(stale),{ready:true});
  const health=oracleOwner.finishOracleSnapshot(prepared);
  assert.equal(health.ready,false);
  assert.match(health.why??"",/filesystem entries changed:/);
});

test("program emit resolves namespace merging and ambient const enums",async t=>{
  const root=workspace(t,{"src/main.ts":`
enum Choice { A=4 }
namespace Units { export const base=10; }
namespace Units { export function twice() { return base*2; } }
declare const enum Flags { Both=3 }
class Box { constructor(public value:number) {} }
console.log(JSON.stringify([Choice.A,Units.twice(),Flags.Both,new Box(8).value]));
`});
  const prepared=(await prepare(root)),run=execute(root,prepared);
  assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,"[4,20,3,8]\n");
  assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
  const manifest=JSON.parse(readFileSync(prepared.manifest,"utf8"));
  assert.deepEqual(manifest.identity,oracleIdentity(toolchain));
  const proof=JSON.parse(readFileSync(join(dirname(prepared.manifest),'program/program-result.json'),'utf8')).proof;void proof;
  assert.equal(manifest.groups[0].options.target,13,'the shared finite runtime target is explicit');
  assert.equal(existsSync(prepared.manifest),true,"the caller still owns its evidence");
});

test("enum constant folding follows TypeScript while a plain negative zero keeps its sign",async t=>{
  const root=workspace(t,{"src/main.ts":"enum E { NegativeZero=-0 } console.log(JSON.stringify([Object.is(E.NegativeZero,-0),Object.is(-0,-0)]));\n"});
  const run=execute(root,(await prepare(root)));
  assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,"[false,true]\n");
});

test("project options and emitted import/module identity match plain Node",async t=>{
  const root=workspace(t,{
    "src/main.ts":`import {value} from './value.js';
class Base { declare item:number; constructor() { let current=0; Object.defineProperty(this,'item',{configurable:true,get(){return current;},set(v:number){current=v;console.log('set',v);}}); } }
class Derived extends Base { item=7; }
new Derived(); console.log(value,import.meta.url===${JSON.stringify(pathToFileURL("PLACEHOLDER").href)});
`,
    "src/value.ts":"export const value:number=13;\n",
  },{useDefineForClassFields:false});
  const entry=join(root,"src/main.ts");
  writeFileSync(entry,readFileSync(entry,"utf8").replace(pathToFileURL("PLACEHOLDER").href,pathToFileURL(entry).href));
  const prepared=(await prepare(root)),reference=bare(root,prepared),run=execute(root,prepared);
  t.diagnostic(JSON.stringify({control:'import-meta-url',old:'set 7\n13 true\n',plainNode:{status:reference.status,stdout:reference.stdout,stderr:reference.stderr}}));
  assert.equal(reference.status,0,reference.stderr);assert.equal(reference.stdout,"set 7\n13 false\n");
  assert.equal(run.status,reference.status,run.stderr);assert.equal(run.stdout,reference.stdout);
});

test("CommonJS emitted filename identity matches plain Node",async t=>{
  const root=workspace(t,{"src/main.ts":"export const value:number=9; console.log(value, __filename.endsWith('/src/main.ts'));\n"},
    {module:"NodeNext",moduleResolution:"nodenext"});
  writeFileSync(join(root,"package.json"),'{"type":"commonjs"}');
  const prepared=(await prepare(root)),reference=bare(root,prepared),run=execute(root,prepared);
  t.diagnostic(JSON.stringify({control:'commonjs-filename',old:'9 true\n',plainNode:{status:reference.status,stdout:reference.stdout,stderr:reference.stderr}}));
  assert.equal(reference.status,0,reference.stderr);assert.equal(reference.stdout,"9 false\n");
  assert.equal(run.status,reference.status,run.stderr);assert.equal(run.stdout,reference.stdout);
});

test("an explicit CommonJS scope handles emitted script and module syntax as plain Node",async t=>{
  const root=workspace(t,{"src/main.ts":"console.log(this===module.exports);\n"});
  writeFileSync(join(root,"package.json"),'{"type":"commonjs"}');
  assert.equal(execute(root,(await prepare(root))).stdout,"true\n");
  writeFileSync(join(root,"src/main.ts"),"export const value=1; console.log(this===undefined,value);\n");
  const prepared=(await prepare(root)),reference=bare(root,prepared),run=execute(root,prepared);
  t.diagnostic(JSON.stringify({control:'commonjs-module-syntax',old:{status:0,stdout:'true 1\n'},plainNode:{status:reference.status,stdout:reference.stdout,stderr:reference.stderr}}));
  assert.equal(reference.status,1,reference.stderr);assert.match(reference.stderr,/SyntaxError: Unexpected token 'export'/);
  assert.equal(run.status,reference.status,run.stderr);assert.equal(run.stdout,reference.stdout);
  assert.match(run.stderr,/SyntaxError: Unexpected token 'export'/);assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
});

test("JavaScript entries keep Node's loader and their TypeScript imports use emit",async t=>{
  const root=workspace(t,{
    "src/main.js":"import {value} from './value.ts'; console.log(value,import.meta.url.endsWith('/src/main.js'));\n",
    "src/value.ts":"enum E { Value=19 } export const value=E.Value;\n",
  });
  const run=execute(root,(await prepare(root,"src/main.js")),"src/main.js");
  assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,"19 true\n");
});

test("an uncaught stack retains the old oracle's original source lines",async t=>{
  const root=workspace(t,{"src/main.ts":`class Box {
  constructor(public value:number) {}
}
function fail():never {
  const box=new Box(3);
  throw new Error('stack-'+box.value);
}
fail();
`},{sourceMap:true});
  const entry=join(root,"src/main.ts");
  const run=execute(root,(await prepare(root)));assert.equal(run.status,1,run.stderr);
  const locations=(text:string)=>[...text.matchAll(/main\.ts:(\d+):\d+/g)].map(match=>Number(match[1]));
  // The migration comparison runs on Node24. Future Node versions removed
  // that flag; they still owe the exact source-line assertions below.
  if(Number(process.versions.node.split('.')[0])===24){
    const old=spawnSync(process.execPath,["--experimental-transform-types","--no-warnings",entry],{encoding:"utf8"});
    assert.equal(old.status,1,old.stderr);assert.deepEqual(locations(run.stderr),locations(old.stderr));
  }
  assert.ok(locations(run.stderr).includes(6));assert.ok(locations(run.stderr).includes(8));
  assert.match(run.stderr,/Error: stack-3/);
});

test("preloads, async output and explicit exit remain the application's events",async t=>{
  const root=workspace(t,{
    "preload.ts":"declare global { var fromPreload:number; } globalThis.fromPreload=17; export {};\n",
    "src/main.ts":"declare global { var fromPreload:number; } await Promise.resolve(); console.log(globalThis.fromPreload); console.error('error-output'); process.exitCode=7; export {};\n",
  });
  ordinaryProject(root,['preload.ts','src/main.ts']);
  const prepared=(await prepare(root,"src/main.ts",{preloads:[join(root,"preload.ts")]}));
  const run=execute(root,{...prepared,args:[...prepared.args,"--import",pathToFileURL(join(root,"preload.ts")).href]});
  assert.equal(run.status,7,run.stderr);assert.equal(run.stdout,"17\n");assert.equal(run.stderr,"error-output\n");
});

test("fresh preparation cannot reuse an earlier emitted source",async t=>{
  const root=workspace(t,{"src/main.ts":"console.log(1);\n"}),first=(await prepare(root));
  writeFileSync(join(root,"src/main.ts"),"console.log(2);\n");
  const second=(await prepare(root));assert.notEqual(first.manifest,second.manifest);
  assert.equal(execute(root,second).stdout,"2\n");
  const stale=execute(root,first);assert.equal(stale.status,0,stale.stderr);assert.equal(stale.stdout,'1\n');
  const final=oracleOwner.finishOracleSnapshot(first);assert.equal(final.ready,false);if(!final.ready)assert.match(final.why,/oracle filesystem file changed/);
  writeFileSync(join(root,"src/main.ts"),"console.log(1);\n");
  assert.equal(oracleOwner.finishOracleSnapshot(first),final,'a restored original cannot erase the held final result');
  const restored=await prepare(root);assert.equal(execute(root,restored).stdout,"1\n");assert.deepEqual(oracleOwner.finishOracleSnapshot(restored),{ready:true});
});

test("a missing or different oracle identity is refused before application code",async t=>{
  const root=workspace(t,{"src/main.ts":"console.log('must-not-run');\n"}),prepared=(await prepare(root));
  const altered=changedSnapshot(prepared,records=>{(records.get('descriptor') as OracleRuntimeDescriptor).identity.typescript.version='wrong';});
  const execution=oracleExecution(altered),changed=execute(root,execution);assert.notEqual(changed.status,0);assert.equal(changed.stdout,"");
  assert.match(changed.stderr,/oracle TypeScript emit identity mismatch/);
  assert.equal(oracleLoaderReady(execution).ready,false);
  const env={...process.env};delete env.NTS_ORACLE_EMIT_MANIFEST;
  const missing=spawnSync(process.execPath,["--import",ORACLE_LOADER,join(root,"src/main.ts")],{encoding:"utf8",env});
  assert.notEqual(missing.status,0);assert.match(missing.stderr,/oracle emit manifest is missing/);
});

test('a literal dynamic ESM request preserves both a present module and a caught absence',async t=>{
  const body="try{const value=await import('./target.ts');console.log(value.value);}catch(error){console.log(error!==null&&typeof error==='object'&&'code' in error?error.code:'other');}\ntry{await import('./target.ts',JSON.parse('null'));}catch(error){console.log(error instanceof TypeError?'TypeError':'other');}\nexport {};\n";
  for(const present of [true,false]){
    // The ambient type describes either runtime outcome without suppressing a
    // diagnostic. Only the target file differs between the control and subject.
    const files:Record<string,string>={'src/main.ts':body,'src/modules.d.ts':"declare module '*.ts' {export const value:number;}\n"};
    if(present)files['src/target.ts']='export const value:number=19;\n';
    const root=workspace(t,files),prepared=(await prepare(root));
    const reference=bare(root,prepared),actual=execute(root,prepared);
    assert.equal(reference.status,0,reference.stderr);assert.equal(actual.status,0,actual.stderr);
    assert.equal(reference.stdout,present?'19\nTypeError\n':'ERR_MODULE_NOT_FOUND\nTypeError\n');
    assert.equal(actual.stdout,reference.stdout);
    assert.deepEqual(oracleLoaderReady(prepared),{ready:true},'a recorded literal absence is an ordinary Node failure');
  }
});

test("a caught unprepared dynamic import stays an instrument after exit zero",async t=>{
  const root=workspace(t,{"src/main.js":"const target='../hidden/'+String('late.ts');try { await import(target); } catch {} console.log('caught');\n","hidden/late.ts":"export const value:number=1;\n"});
  const prepared=(await prepare(root,"src/main.js"));
  // The file did not belong to the completed project. A caught load must
  // hold instead of silently switching to Node's different TS transform.
  const run=execute(root,prepared,"src/main.js");assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,"caught\n");
  const state=oracleLoaderReady(prepared);assert.equal(state.ready,false);
  if(!state.ready)assert.match(state.why,/TypeScript import was not prepared: .*late.ts/);
});

test("package identity changes when a published compiler input changes",t=>{
  const root=workspace(t,{"tool":"first","lib/a.js":"one"});
  const first=packageIdentity(root,join(root,"tool"));writeFileSync(join(root,"lib/a.js"),"two");
  const second=packageIdentity(root,join(root,"tool"));assert.notEqual(first.packageSha256,second.packageSha256);
  writeFileSync(join(root,"tool"),"second");assert.notEqual(second.nativeSha256,packageIdentity(root,join(root,"tool")).nativeSha256);
});

test("copied oracle assets run outside their source tree with an explicit toolchain",t=>{
  const root=workspace(t,{"src/main.ts":"enum E { Value=42 } console.log(E.Value);\n"});
  writeFileSync(join(root,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ESNext",module:"ESNext",moduleResolution:"bundler",noEmit:true},include:["src"]}));
  const assets=join(root,"assets");mkdirSync(assets);writeFileSync(join(assets,"package.json"),'{"type":"module"}');
  for(const name of [...ORACLE_EXECUTION_FILES,"oracle-emit.ts","oracle-loader.ts","oracle-filesystem.ts","oracle-runtime.ts","oracle-resolution.ts","oracle-assets.ts","oracle-toolchain.json"])
    cpSync(join(REPOSITORY,"tooling/differential",name),join(assets,name));
  const prepared=spawnSync(process.execPath,[join(assets,"oracle-emit.ts"),"--prepare",join(root,"src/main.ts"),join(root,"emitted"),join(root,"tsconfig.json")],{
    encoding:"utf8",cwd:root,env:{...process.env,NTS_ORACLE_TYPESCRIPT:toolchain},
  });
  assert.equal(prepared.status,0,prepared.stderr);
  const configured:OraclePrepared=JSON.parse(prepared.stdout);
  assert.ok(configured.args.some(arg=>arg.startsWith("data:text/javascript,")&&decodeURIComponent(arg).includes("assets/oracle-loader.mjs")));
  for(const name of [...ORACLE_EXECUTION_FILES,"oracle-emit.ts","oracle-loader.ts","oracle-filesystem.ts","oracle-runtime.ts","oracle-resolution.ts","oracle-assets.ts","oracle-toolchain.json"])
    assert.deepEqual(readFileSync(join(dirname(configured.manifest),"assets",name)),readFileSync(join(assets,name)));
  assert.deepEqual(configured.identity,oracleIdentity(toolchain));
  const run=execute(root,oracleExecution(configured));assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,"42\n");
});

test("different owned scratch roots preserve authenticated manifest facts and Node flags",async t=>{
  const root=workspace(t,{"src/main.ts":"console.log(process.cwd());\n"});
  // Scratch routing is the only varying input. Both consulted parent
  // directory listings already exist, so the second arm changes no namespace.
  mkdirSync(join(root,"first"));mkdirSync(join(root,"deeper/second"),{recursive:true});
  const request={entry:join(root,"src/main.ts"),project:join(root,"tsconfig.json"),toolchain,outputRoots:[join(root,"first"),join(root,"deeper/second")]};
  const first=(await prepareOracle({...request,directory:join(root,"first")}));
  const second=(await prepareOracle({...request,directory:join(root,"deeper/second")}));
  assert.notEqual(dirname(first.manifest),dirname(second.manifest));
  const normalised=(prepared:OraclePrepared)=>{
    const stored=JSON.parse(readFileSync(prepared.manifest,'utf8'));
    const sourceIndex=readFileSync(join(dirname(prepared.manifest),'source-index.json'));
    assert.equal(createHash('sha256').update(sourceIndex).digest('hex'),stored.outputs['source-index.json']);
    // Hash-bound physical routes differ with their snapshot root. Compare
    // their authenticated contents, normalising only that declared location.
    stored.outputs['source-index.json']={contents:JSON.parse(sourceIndex.toString('utf8'))};
    stored.runtimeIndex=[...snapshotRecords(prepared)].sort(([a],[b])=>a.localeCompare(b,'en'));
    return JSON.stringify(stored).replaceAll(dirname(prepared.manifest),'@snapshot');
  };
  assert.deepEqual(first.args,second.args);assert.equal(normalised(first),normalised(second));
  for(const prepared of [first,second]){const run=execute(root,prepared);assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,root+"\n");}
});

test('worker output prefixes exclude owned outputs without serializing unrelated namespaces',async t=>{
  const root=workspace(t,{'src/main.ts':"console.log(19);\n"}),owned=join(root,'owned-output'),workerRoot=join(root,'worker');
  mkdirSync(owned);writeFileSync(join(owned,'must-not-copy.cjs'),'throw Error("output is not an input");');
  const unrelated=Array.from({length:256},(_,index)=>'/unrelated-oracle-outputs/case-'+index);
  const shared=[owned,workerRoot,...unrelated],worker=new OracleWorker(workerRoot,toolchain,shared);
  shared.push(root); // The worker's snapshot must not follow later caller mutations.
  try{
    const [prepared]=await worker.prepareBatch([{entry:join(root,'src/main.ts'),project:join(root,'tsconfig.json'),directory:join(root,'scratch')}],boundedCompiler);
    assert.ok(prepared);
    const index=JSON.parse(readFileSync(join(dirname(prepared.manifest),'source-index.json'),'utf8'));
    for(const tree of index.trees){
      assert.ok(tree.coverage.excluded.includes(owned));
      assert.ok(!tree.coverage.excluded.some((path:string)=>path.startsWith('/unrelated-oracle-outputs')));
    }
    assert.ok(!Object.keys(JSON.parse(readFileSync(prepared.manifest,'utf8')).inputs).includes(join(owned,'must-not-copy.cjs')));
    const run=execute(root,oracleExecution(prepared));assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');
  }finally{worker.close();}
  const overlap=new OracleWorker(join(root,'overlap-worker'),toolchain,[join(root,'src')]);
  try{await assert.rejects(overlap.prepareBatch([{entry:join(root,'src/main.ts'),project:join(root,'tsconfig.json'),directory:join(root,'overlap-output')}],boundedCompiler),/output namespace overlaps source input/);}
  finally{overlap.close();}
});

test("missing capability and changed package bytes fail before execution",async t=>{
  assert.throws(()=>verifyToolchain(""),/NTS_ORACLE_TYPESCRIPT is missing/);
  const root=workspace(t,{"src/main.ts":"console.log('must-not-run');\n"});
  const corrupt=join(root,"typescript");cpSync(toolchain,corrupt,{recursive:true});
  writeFileSync(join(corrupt,"package.json"),readFileSync(join(corrupt,"package.json"),"utf8")+"\n");
  (await assert.rejects(async ()=>(await prepare(root,"src/main.ts",{toolchain:corrupt})),/root package hash mismatch: expected [a-f0-9]{64}; actual [a-f0-9]{64}/));
  assert.equal(existsSync(join(root,"scratch")),false);
  const env={...process.env};delete env.NTS_ORACLE_TYPESCRIPT;
  const missing=spawnSync(process.execPath,[join(REPOSITORY,"tooling/differential/oracle-emit.ts"),"--prepare",join(root,"src/main.ts"),join(root,"missing"),join(root,"tsconfig.json")],{encoding:"utf8",env});
  assert.notEqual(missing.status,0);assert.equal(missing.stdout,"");assert.match(missing.stderr,/NTS_ORACLE_TYPESCRIPT is missing/);
});

test("a changed native executable is refused against its recorded hash",t=>{
  const root=workspace(t,{"src/main.ts":"console.log('must-not-run');\n"});
  const record=JSON.parse(readFileSync(join(REPOSITORY,"tooling/differential/oracle-toolchain.json"),"utf8")).platforms[process.platform+'-'+process.arch];
  const modules=join(root,"toolchain/node_modules"),copy=join(modules,"typescript");
  mkdirSync(modules,{recursive:true});cpSync(toolchain,copy,{recursive:true});
  const native=dirname(createRequire(pathToFileURL(join(toolchain,"package.json"))).resolve(record.nativePackage+'/package.json'));
  const copiedNative=join(modules,record.nativePackage);cpSync(native,copiedNative,{recursive:true});
  assert.deepEqual(verifyToolchain(copy).identity,verifyToolchain(toolchain).identity);
  const executable=join(copiedNative,record.executable);
  writeFileSync(executable,Buffer.concat([readFileSync(executable),Buffer.from([0])]));
  assert.throws(()=>verifyToolchain(copy),/packageSha256 mismatch: expected [a-f0-9]{64}; actual [a-f0-9]{64}/);
});

async function boundedCompiler(compiler:string,args:string[],cwd:string){
  const run=await activeCommand(compiler,args,{cwd,env:process.env,idleMs:120_000,cpuBudgetSeconds:120,maxBuffer:32*2**20});
  if(run.error||run.signal||run.hung||run.runaway)throw Error('oracle batch not measured: '+(run.signal??run.hung??run.runaway??run.error));
  return run;
}

test('a failed shared owner is attributed to every dependent member while independent members run',async t=>{
  const bad=workspace(t,{'src/main.ts':"const value:number='wrong';console.log(value);\n"});
  const roots=Array.from({length:3},()=>workspace(t,{'src/main.ts':'console.log(19);\n'})),worker=new OracleWorker(join(roots[0]!,'worker'),toolchain);
  const requests=roots.map((root,index)=>({entry:join(root,'src/main.ts'),directory:join(root,'emitted'),...(index<2?{preloads:[{entry:join(bad,'src/main.ts'),project:join(bad,'tsconfig.json')}]}:{})})),commands:string[]=[];
  try{
    await assert.rejects(worker.prepareBatch(requests,async(...args)=>{
      commands.push(JSON.parse(readFileSync(args[1][2]!,'utf8')).project);return boundedCompiler(...args);
    }),error=>error instanceof TypeScriptDiagnosticError&&error.diagnostics.includes('TS2322'));
    assert.deepEqual(commands,[join(bad,'tsconfig.json'),join(bad,'tsconfig.json'),join(roots[2]!,'tsconfig.json')]);
    for(let index=0;index<2;index++){
      const directory=readdirSync(join(roots[index]!,'emitted')).find(name=>name.startsWith('emit-'))!;
      const result=JSON.parse(readFileSync(join(roots[index]!,'emitted',directory,'member-result.json'),'utf8'));
      assert.equal(result.status,'diagnostic');assert.equal(result.project,join(bad,'tsconfig.json'));assert.match(result.diagnostics,/TS2322/);
    }
    const directory=readdirSync(join(roots[2]!,'emitted')).find(name=>name.startsWith('emit-'))!;
    assert.equal(JSON.parse(readFileSync(join(roots[2]!,'emitted',directory,'program/program-result.json'),'utf8')).diagnostics,'');
    for(const root of roots)for(const item of readdirSync(join(root,'emitted')))assert.equal(existsSync(join(root,'emitted',item,'manifest.json')),false);
    const context=JSON.parse(readFileSync(join(roots[0]!,'worker/owner-cache.json'),'utf8'));
    const calls=readFileSync(join(context.ledger,'oracle-owner-calls.jsonl'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(row=>row.project===join(bad,'tsconfig.json'));
    assert.deepEqual(calls.map(row=>row.mode),['held','hit']);t.diagnostic(JSON.stringify({kind:'shared-owner-diagnostic',commands,calls}));
  }finally{worker.close();}
});

test("one batch preserves eight independent projects and attributes a type error",async t=>{
  const roots=Array.from({length:8},(_,i)=>workspace(t,{"src/main.ts":i===3?"const value:number='bad'; console.log(value);\n":`console.log(${i});\n`},{allowImportingTsExtensions:false}));
  const worker=new OracleWorker(join(roots[0]!,"worker"),toolchain);try{
  const requests=roots.map(root=>({entry:join(root,"src/main.ts"),directory:join(root,"emitted"),outputRoots:[join(roots[0]!,"worker"),join(roots[0]!,"attribution"),...roots.map(item=>join(item,"emitted"))]}));
  let commands=0;
  await assert.rejects(worker.prepareBatch(requests,async(...args)=>{
    commands++;const run=await boundedCompiler(...args);
    const record=JSON.parse(run.stdout),request=JSON.parse(readFileSync(args[1][2]!,'utf8'));
    const diagnostic=record.diagnostics.split('\n').filter((line:string)=>line.includes('TS2322'));
    const rejected=request.project===join(roots[3]!,'tsconfig.json');
    assert.equal(diagnostic.length,rejected?1:0);
    if(rejected)assert.equal(resolve(args[2],diagnostic[0]!.slice(0,diagnostic[0]!.indexOf('('))),join(roots[3]!,'src/main.ts'));
    assert.equal((record.diagnostics.match(/TS2322/g)??[]).length,rejected?1:0);
    assert.equal(args[2],dirname(request.project),'each project runs from its original directory');
    return run;
  }),/oracle TypeScript.*TS2322/s);
  assert.equal(commands,8,'one original-project compiler invocation per member');
  for(const root of roots)for(const item of readdirSync(join(root,'emitted')))
    assert.equal(existsSync(join(root,'emitted',item,'manifest.json')),false,'rejected batch publishes no ready member');
  const attributed=await prepareOracles(requests.map((options,i)=>({key:String(i),options})),{
    directory:join(roots[0]!,'attribution'),toolchain,workers:1,env:process.env,memoryBytes:2*2**30,
  });
  const rejected=attributed['3']!;assert.ok('instrument' in rejected);
  assert.match(rejected.instrument,/TS2322/);
  assert.equal('prepared' in rejected,false);
  assert.equal(Object.values(attributed).filter(row=>'prepared' in row).length,7);
  for(let i=0;i<8;i++){
    if(i===3)continue;
    const member=attributed[String(i)]!;assert.ok('prepared' in member);
    const prepared=oracleExecution(member.prepared);
    const run=execute(roots[i]!,prepared);assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,i+'\n');
    const stored=JSON.parse(readFileSync(prepared.manifest,'utf8'));
    const inventory=Object.keys(stored.outputs).join('\n');
    for(let j=0;j<8;j++)if(j!==i)assert.ok(!inventory.includes(roots[j]!.slice(1)),inventory);
  }
  }finally{worker.close();}
});

test("a canceled batch publishes no ready manifest after its compiler drains",async t=>{
  const root=workspace(t,{"src/main.ts":"console.log(7);\n"});
  const worker=new OracleWorker(join(root,"worker"),toolchain);try{
  const controller=new AbortController();
  await assert.rejects(worker.prepareBatch([{entry:join(root,'src/main.ts'),directory:join(root,'canceled')}],async(...args)=>{
    const run=await boundedCompiler(...args);controller.abort();return run;
  },controller.signal),/canceled before publication/);
  const {readdirSync}=await import('node:fs');
  for(const name of readdirSync(join(root,'canceled')))assert.equal(existsSync(join(root,'canceled',name,'manifest.json')),false);
  const [next]=await worker.prepareBatch([{entry:join(root,'src/main.ts'),directory:join(root,'next')}],boundedCompiler);
  assert.equal(execute(root,oracleExecution(next)).stdout,'7\n');
  }finally{worker.close();}
});

test("an interrupted compiler leaves its batch unmeasured and singleton attribution is independent",async t=>{
  const root=workspace(t,{"src/main.ts":"console.log(11);\n"});
  const worker=new OracleWorker(join(root,"worker"),toolchain);try{
  await assert.rejects(worker.prepareBatch([{entry:join(root,'src/main.ts'),directory:join(root,'killed')}],async(compiler,args,cwd)=>{
    const run=await activeCommand('prlimit',['--core=0','--cpu=0:0',compiler,...args],{cwd,env:process.env,cpuBudgetSeconds:120,idleMs:120_000});
    assert.ok(run.signal,'the real native compiler must be stopped');throw Error('oracle batch not measured: '+run.signal);
  }),/not measured: SIG/);
  const good=oracleExecution(await worker.prepare({entry:join(root,'src/main.ts'),directory:join(root,'singleton')}));
  assert.equal(execute(root,good).stdout,'11\n');
  }finally{worker.close();}
});

test("a captured worker is independent of a changed installed declaration library",async t=>{
  const root=workspace(t,{"src/main.ts":"const value:Array<number>=[19]; console.log(value[0]);\n"});
  const record=JSON.parse(readFileSync(join(REPOSITORY,'tooling/differential/oracle-toolchain.json'),'utf8')).platforms[process.platform+'-'+process.arch];
  const modules=join(root,'origin/node_modules'),copy=join(modules,'typescript');mkdirSync(modules,{recursive:true});cpSync(toolchain,copy,{recursive:true});
  const native=dirname(createRequire(pathToFileURL(join(toolchain,'package.json'))).resolve(record.nativePackage+'/package.json'));
  const copiedNative=join(modules,record.nativePackage);cpSync(native,copiedNative,{recursive:true});
  const worker=new OracleWorker(join(root,'worker'),copy);try{
  const declaration=join(copiedNative,'lib/lib.es5.d.ts');writeFileSync(declaration,readFileSync(declaration,'utf8')+'\n// changed origin\n');
  assert.throws(()=>new OracleWorker(join(root,'bad-worker'),copy),/nativePackageSha256 mismatch: expected [a-f0-9]{64}; actual [a-f0-9]{64}/);
  const [prepared]=await worker.prepareBatch([{entry:join(root,'src/main.ts'),directory:join(root,'emitted')}],boundedCompiler);
  assert.equal(execute(root,oracleExecution(prepared)).stdout,'19\n');
  }finally{worker.close();}
});


test("append-only loader events retain either parent/child instrument order and reject incomplete streams",async t=>{
  const root=workspace(t,{"src/main.ts":"export {};"}),loaderState=join(root,'events.jsonl');
  const ready=JSON.stringify({version:1,status:'ready'})+'\n';
  const instrument=JSON.stringify({version:1,status:'instrument',reason:'child undeclared input'})+'\n';
  const prepared=(await prepare(root)),check=(raw:string)=>{const own=oracleExecution(prepared);try{writeFileSync(own.loaderState,raw);return oracleLoaderReady(own);}finally{closeOracleExecution(own);}};
  assert.equal(oracleLoaderReady({loaderState}).ready,false);
  for(const raw of [ready,ready+ready]){
    assert.deepEqual(check(raw),{ready:true});
  }
  for(const raw of [ready+instrument,instrument+ready,'','{}\n','null\n','[]\n','{\n',ready.trimEnd(),ready+'\n',
    JSON.stringify({version:2,status:'ready'})+'\n',JSON.stringify({version:1,status:'ready',extra:true})+'\n']){
    assert.equal(check(raw).ready,false,raw);
  }
});

test("nested children cannot overwrite an instrument event, and file executions share no status path",async t=>{
  const root=workspace(t,{
    'src/main.ts':`import {spawnSync} from 'node:child_process';
const children=process.argv.includes('bad')?['bad','good']:['good'];
if(process.argv.includes('reverse'))children.reverse();
for(const name of children){const result=spawnSync(process.execPath,[...process.execArgv,new URL('../'+name+'.mjs',import.meta.url).pathname],{encoding:'utf8',env:process.env});if(result.status!==0)throw Error(result.stderr);}
console.log('completed');
`,
    'bad.mjs':"try{await import('./unprepared.ts')}catch{}\n",
    'good.mjs':"console.log('healthy child');\n",'unprepared.ts':'export const value:number=5;\n',
  });
  const prepared=(await prepare(root,'src/main.ts',{runtimeRoots:['bad.mjs','good.mjs','unprepared.ts'].map(file=>join(root,file))}));
  const run=(suffix:string[])=>{
    const before=oracleExecution(prepared);
    assert.equal(oracleLoaderReady(before).ready,false,'a new file cannot inherit ready');
    const own=oracleExecution(prepared);
    const result=spawnSync(process.execPath,[...own.args,join(root,'src/main.ts'),...suffix],{encoding:'utf8',env:{...process.env,...own.env}});
    assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'completed\n');
    return own;
  };
  const first=run(['bad']),second=run(['bad','reverse']),third=run([]);
  for(const own of [first,second]){const health=oracleLoaderReady(own);assert.equal(health.ready,false);if(!health.ready)assert.match(health.why,/was not prepared.*unprepared.ts/);}
  assert.deepEqual(oracleLoaderReady(third),{ready:true});
  assert.equal(new Set([first.loaderState,second.loaderState,third.loaderState]).size,3);
});

test("overlapping roots with conflicting emitted bytes hold before any batch manifest is ready",async t=>{
  const root=workspace(t,{'src/main.ts':'export class Box { value=7; } export const value:number=new Box().value;\n'});
  const second=join(root,'other.json');writeFileSync(second,JSON.stringify({extends:join(root,'tsconfig.json'),compilerOptions:{useDefineForClassFields:false}}));
  (await assert.rejects(async ()=>(await prepare(root,'src/main.ts',{preloads:[{entry:join(root,'src/main.ts'),project:second,roots:[join(root,'src/main.ts')]}]})),/conflicting emitted TypeScript source/));
  for(const own of readdirSync(join(root,'scratch')).filter(name=>name.startsWith('emit-')))assert.equal(existsSync(join(root,'scratch',own,'manifest.json')),false);
});


test('the source index cannot redirect a prepared root to another valid output',async t=>{
  const root=workspace(t,{'src/main.ts':"import {value} from './value.ts';console.log(value);\n",'src/value.ts':'export const value:number=7;\n'});
  const prepared=await prepare(root),altered=changedSnapshot(prepared,records=>{
    const own=(records.get('source\0'+join(root,'src/main.ts')) as OracleRuntimeRoute[])[0]!;
    const other=(records.get('source\0'+join(root,'src/value.ts')) as OracleRuntimeRoute[])[0]!;
    own.output=other.output;own.execution=other.execution;
  }),execution=oracleExecution(altered);
  const run=execute(root,execution);assert.notEqual(run.status,0);assert.equal(run.stdout,'');
  const health=oracleLoaderReady(execution);assert.equal(health.ready,false);if(!health.ready)assert.match(health.why,/source route has no exact owner/);
});


test('a module declaration that appears after preparation invalidates resolution',async t=>{
  const root=workspace(t,{'src/main.ts':"import {Choice} from 'appearing-module';console.log(Choice.A);\n",'node_modules/appearing-module/package.json':'{"type":"module","main":"index.js"}','node_modules/appearing-module/index.js':'export const Choice={A:2};\n'},{allowJs:true,maxNodeModuleJsDepth:1});
  const prepared=(await prepare(root)),unchanged=oracleExecution(prepared),first=execute(root,unchanged);
  assert.equal(first.status,0,first.stderr);assert.equal(first.stdout,'2\n');assert.deepEqual(oracleLoaderReady(unchanged),{ready:true});
  writeFileSync(join(root,'node_modules/appearing-module/index.d.ts'),'export declare const enum Choice{A=7}\n');
  const stale=oracleExecution(prepared),snapshot=execute(root,stale);assert.equal(snapshot.status,0,snapshot.stderr);assert.equal(snapshot.stdout,'2\n');assert.deepEqual(oracleLoaderReady(stale),{ready:true});
  const final=oracleOwner.finishOracleSnapshot(prepared);assert.equal(final.ready,false,'appeared declaration must invalidate the complete snapshot');if(!final.ready)assert.match(final.why,/filesystem (file|fileExists|entries) changed/);
  const fresh=oracleExecution((await prepare(root))),current=execute(root,fresh);
  assert.equal(current.status,0,current.stderr);assert.equal(current.stdout,'7\n');assert.deepEqual(oracleLoaderReady(fresh),{ready:true});
});

test('a consulted source directory listing is validated before prepared reuse',async t=>{
  const root=workspace(t,{'src/main.ts':'console.log(1);\n'}),prepared=(await prepare(root)),unchanged=oracleExecution(prepared);
  assert.equal(execute(root,unchanged).stdout,'1\n');assert.deepEqual(oracleLoaderReady(unchanged),{ready:true});
  writeFileSync(join(root,'src/added.ts'),'export const additional:number=3;\n');
  const stale=oracleExecution(prepared),snapshot=execute(root,stale);assert.equal(snapshot.status,0,snapshot.stderr);assert.equal(snapshot.stdout,'1\n');assert.deepEqual(oracleLoaderReady(stale),{ready:true});
  const final=oracleOwner.finishOracleSnapshot(prepared);assert.equal(final.ready,false,'changed consulted directory listing must hold');if(!final.ready)assert.match(final.why,/filesystem entries changed/);
  const fresh=oracleExecution((await prepare(root)));assert.equal(execute(root,fresh).stdout,'1\n');assert.deepEqual(oracleLoaderReady(fresh),{ready:true});
});


test('a failed absolute request outside captured roots remains an instrument hold',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-relative-owner-'));
  t.after(()=>removeOracleSnapshot(root));
  const app=join(root,'app'),outside=join(root,'outside');mkdirSync(app);mkdirSync(outside);
  const entry=join(app,'main.cjs');
  writeFileSync(entry,"try{console.log(require(require('node:path').resolve(__dirname,'../outside/value.cjs')));}catch(error){console.log(error.code);}\n");
  writeFileSync(join(outside,'value.cjs'),'module.exports=19;\n');
  const expected=spawnSync(process.execPath,[entry],{cwd:app,encoding:'utf8'});
  assert.equal(expected.status,0,expected.stderr);assert.equal(expected.stdout,'19\n');
  for(const captured of [true,false]){
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:captured?[app,outside]:[app],toolchain,directory:join(root,captured?'control':'subject')}));
    const execution=oracleExecution(prepared),actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:app,encoding:'utf8',env:{...process.env,...execution.env}});
    if(captured){assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,expected.stdout);assert.deepEqual(oracleLoaderReady(execution),{ready:true});}
    else assert.equal(oracleLoaderReady(execution).ready,false,'an omitted outside module must not become an ordinary missing-module verdict');
  }
});

test('a captured package alias retains its external main ownership boundary',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-alias-main-'));
  t.after(()=>removeOracleSnapshot(root));
  const app=join(root,'app'),outside=join(root,'outside');
  mkdirSync(join(app,'pkg'),{recursive:true});mkdirSync(outside);
  writeFileSync(join(app,'main.cjs'),"try{console.log(require(require('node:path').resolve(__dirname,'./alias')));}catch(error){console.log(error.code);}\n");
  writeFileSync(join(app,'pkg/package.json'),JSON.stringify({main:'../../outside/value.cjs'}));
  writeFileSync(join(outside,'value.cjs'),'module.exports=19;\n');
  symlinkSync('pkg',join(app,'alias'));
  const entry=join(app,'main.cjs'),plain=spawnSync(process.execPath,[entry],{cwd:app,encoding:'utf8'});
  assert.equal(plain.status,0,plain.stderr);assert.equal(plain.stdout,'19\n');
  for(const captureOutside of [true,false]){
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:captureOutside?[app,outside]:[app],toolchain,directory:join(root,captureOutside?'control':'subject')}));
    const execution=oracleExecution(prepared),actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:app,encoding:'utf8',env:{...process.env,...execution.env}}),health=oracleLoaderReady(execution);
    t.diagnostic(JSON.stringify({captureOutside,plain:{status:plain.status,stdout:plain.stdout,stderr:plain.stderr},actual:{status:actual.status,stdout:actual.stdout,stderr:actual.stderr},health}));
    if(captureOutside){assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,plain.stdout);assert.deepEqual(health,{ready:true});}
    else assert.equal(health.ready,false,'a package alias must retain the ownership boundary of its main target');
  }
});

test('main edges preserve logical directory depth with one canonical package owner',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-main-depth-'));t.after(()=>removeOracleSnapshot(root));
  for(const deepPackage of [false,true]){
    const own=join(root,deepPackage?'deep':'shallow'),app=join(own,'app'),outside=join(own,'outside'),pkg=join(app,deepPackage?'nested/pkg':'pkg');
    mkdirSync(pkg,{recursive:true});mkdirSync(join(app,'nested'),{recursive:true});mkdirSync(outside);mkdirSync(join(app,'outside'));
    writeFileSync(join(pkg,'package.json'),JSON.stringify({main:'../../outside/value.cjs'}));
    writeFileSync(join(outside,'value.cjs'),'module.exports=19;\n');writeFileSync(join(app,'outside/value.cjs'),'module.exports=23;\n');
    symlinkSync(deepPackage?'nested/pkg':'pkg',join(app,'alias'));symlinkSync(deepPackage?'pkg':'../pkg',join(app,'nested/alias'));
    const entry=join(app,'main.cjs'),requests=[deepPackage?'./nested/pkg':'./pkg','./alias','./nested/alias'];
    writeFileSync(entry,'for(const request of '+JSON.stringify(requests)+'){try{console.log(require(require("node:path").resolve(__dirname,request)));}catch(error){console.log(error.code);}}\n');
    const expected=spawnSync(process.execPath,[entry],{encoding:'utf8'});assert.equal(expected.status,0,expected.stderr);assert.equal(expected.stdout,deepPackage?'23\n19\n23\n':'19\n19\n23\n');
    for(const captureOutside of [true,false]){
      const prepared=(await prepareOracle({entry,project:null,runtimeRoots:captureOutside?[app,outside]:[app],toolchain,directory:join(own,captureOutside?'control':'subject')})),execution=oracleExecution(prepared);
      const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{encoding:'utf8',env:{...process.env,...execution.env}}),health=oracleLoaderReady(execution);
      t.diagnostic(JSON.stringify({deepPackage,captureOutside,plain:{status:expected.status,stdout:expected.stdout,stderr:expected.stderr},actual:{status:actual.status,stdout:actual.stdout,stderr:actual.stderr},health}));
      if(captureOutside){assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,expected.stdout);assert.deepEqual(health,{ready:true});}
      else assert.equal(health.ready,false,'logical main escape must not receive an ordinary missing verdict');
    }
  }
});

test('an uncaptured main target cannot select a captured package fallback',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-main-fallback-'));
  t.after(()=>removeOracleSnapshot(root));
  const app=join(root,'app'),outside=join(root,'outside');mkdirSync(join(app,'pkg'),{recursive:true});mkdirSync(outside);
  const entry=join(app,'main.cjs');
  writeFileSync(entry,"console.log(require(require('node:path').resolve(__dirname,'./pkg')));\n");
  writeFileSync(join(app,'pkg/package.json'),JSON.stringify({main:'../../outside/value.cjs'}));
  writeFileSync(join(app,'pkg/index.js'),'module.exports=23;\n');writeFileSync(join(outside,'value.cjs'),'module.exports=19;\n');
  const plain=spawnSync(process.execPath,[entry],{cwd:app,encoding:'utf8'});assert.equal(plain.status,0,plain.stderr);assert.equal(plain.stdout,'19\n');
  for(const captureOutside of [true,false]){
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:captureOutside?[app,outside]:[app],toolchain,directory:join(root,captureOutside?'control':'subject')}));
    const execution=oracleExecution(prepared),actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:app,encoding:'utf8',env:{...process.env,...execution.env}}),health=oracleLoaderReady(execution);
    t.diagnostic(JSON.stringify({captureOutside,plain:{status:plain.status,stdout:plain.stdout,stderr:plain.stderr},actual:{status:actual.status,stdout:actual.stdout,stderr:actual.stderr},health}));
    if(captureOutside){assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,plain.stdout);assert.deepEqual(health,{ready:true});}
    else assert.equal(health.ready,false,'a successful fallback cannot hide its unobserved main-target lookup');
  }
});

test('a package main escape needs complete captured target authority for an ordinary failure',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-main-owner-'));
  t.after(()=>removeOracleSnapshot(root));
  const app=join(root,'app'),pkg=join(app,'pkg'),outside=join(root,'outside');mkdirSync(pkg,{recursive:true});mkdirSync(outside);
  const entry=join(app,'main.cjs'),target=join(outside,'value.cjs');
  writeFileSync(entry,"try{console.log(require(require('node:path').resolve(__dirname,'./pkg')));}catch(error){console.log(error.code);}\n");
  writeFileSync(join(pkg,'package.json'),JSON.stringify({main:'../../outside/value.cjs'}));
  const expected=spawnSync(process.execPath,[entry],{cwd:app,encoding:'utf8'});
  assert.equal(expected.status,0,expected.stderr);assert.equal(expected.stdout,'MODULE_NOT_FOUND\n');
  for(const captured of [true,false])await t.test(captured?'captured missing target':'uncaptured missing target',async ()=>{
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:captured?[app,outside]:[app],toolchain,directory:join(root,captured?'control':'subject')}));
    const run=()=>{const execution=oracleExecution(prepared);return {execution,actual:spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:app,encoding:'utf8',env:{...process.env,...execution.env}})};};
    const first=run();assert.equal(first.actual.status,0,first.actual.stderr);
    t.diagnostic(JSON.stringify({captured,plainNode:{status:expected.status,stdout:expected.stdout},actual:{status:first.actual.status,stdout:first.actual.stdout},health:oracleLoaderReady(first.execution)}));
    if(captured){
      assert.equal(first.actual.stdout,expected.stdout);assert.deepEqual(oracleLoaderReady(first.execution),{ready:true});
      writeFileSync(target,'module.exports=19;\n');const appeared=run();assert.equal(appeared.actual.status,0,appeared.actual.stderr);assert.equal(appeared.actual.stdout,expected.stdout);assert.deepEqual(oracleLoaderReady(appeared.execution),{ready:true});
      const final=oracleOwner.finishOracleSnapshot(prepared);assert.equal(final.ready,false,'an appearing package target invalidates its captured directory at finalization');rmSync(target);
    }else assert.equal(oracleLoaderReady(first.execution).ready,false,'an uncaptured package target is not an ordinary missing module');
  });
});

test('shared imports publish one owner and computed requests cannot borrow an unselected root',async t=>{
  const root=workspace(t,{
    'a/main.ts':"import {run} from '../shared/shared.ts';try{console.log(await run());}catch(error){console.log((error as {code?:string}).code); }\n",
    'b/preload.ts':"import '../shared/shared.ts';\n",
    'shared/shared.ts':'export {};\n',
    'shared/value.ts':'export const value:number=19;\n',
  });
  const entry=join(root,'a/main.ts'),preload=join(root,'b/preload.ts'),first=join(root,'a/tsconfig.json'),second=join(root,'b/tsconfig.json'),owner=join(root,'shared/tsconfig.json');
  writeFileSync(first,JSON.stringify({extends:join(root,'tsconfig.json'),files:['main.ts'],include:[]}));
  writeFileSync(second,JSON.stringify({extends:join(root,'tsconfig.json'),files:['preload.ts'],include:[]}));
  writeFileSync(owner,JSON.stringify({extends:join(root,'tsconfig.json'),files:['shared.ts','value.ts'],include:[]}));
  for(const complete of [true,false]){
    writeFileSync(join(root,'shared/shared.ts'),(complete?"import './value.ts';\n":'')+"export async function run(){const spec='./value.js';return (await import(spec)).value;}\n");
    const prepared=(await prepareOracle({entry,project:first,preloads:[{entry:preload,project:second}],toolchain,directory:join(root,complete?'control':'subject'),outputRoots:[join(root,'control'),join(root,'subject')]}));
    const manifest=JSON.parse(readFileSync(prepared.manifest,'utf8')),index=JSON.parse(readFileSync(join(dirname(prepared.manifest),'source-index.json'),'utf8'));
    const owners=index.files.filter((item:OracleRuntimeRoute)=>item.source===join(root,'shared/shared.ts'));
    assert.equal(owners.length,1,'the nearest project publishes one common runtime location');
    assert.equal(manifest.groups.find((group:oracleOwner.EmitGroup)=>group.output===owners[0].group).project,owner);
    assert.equal(Object.hasOwn(manifest.sources,join(root,'shared/value.ts')),complete,'ordinary checking roots alone do not select execution roots');
    const bareOwners=owners.map((item:OracleRuntimeRoute)=>{
      const url=pathToFileURL(join(dirname(prepared.manifest),item.execution)).href;
      const code="try{console.log(await(await import("+JSON.stringify(url)+")).run());}catch(error){console.log(error.code);}";
      const plain=spawnSync(process.execPath,['--input-type=module','--eval',code],{cwd:root,encoding:'utf8'});
      assert.equal(plain.status,0,plain.stderr);return {group:item.group,stdout:plain.stdout,stderr:plain.stderr};
    });
    assert.deepEqual(bareOwners.map((item:{stdout:string})=>item.stdout),complete?['19\n']:['ERR_MODULE_NOT_FOUND\n']);
    t.diagnostic(JSON.stringify({complete,bareOwners}));
    const execution=oracleExecution(prepared),actual=execute(root,execution,'a/main.ts');
    assert.equal(actual.status,0,actual.stderr);
    if(complete){assert.equal(actual.stdout,'19\n');assert.deepEqual(oracleLoaderReady(execution),{ready:true});}
    else{
      const health=oracleLoaderReady(execution);assert.equal(health.ready,false,'an unselected computed target cannot borrow another checking root');
      if(!health.ready)assert.match(health.why,/resolution context was not captured.*unprepared direct module request/s);
    }
  }
});

test('Node resolution failures inside a captured application retain their ordinary error',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-missing-cjs-'));
  t.after(()=>removeOracleSnapshot(root));
  const app=join(root,'app');mkdirSync(app);
  const entry=join(app,'main.cjs'),member=join(app,'value.cjs');
  writeFileSync(entry,"try{console.log(require(require('node:path').resolve(__dirname,'./value.cjs')));}catch(error){console.log(error.code);}\n");
  writeFileSync(member,'module.exports=19;\n');
  for(const missing of [false,true]){
    if(missing)rmSync(member);
    const expected=spawnSync(process.execPath,[entry],{cwd:app,encoding:'utf8'});
    assert.equal(expected.status,0,expected.stderr);
    assert.equal(expected.stdout,missing?'MODULE_NOT_FOUND\n':'19\n');
    t.diagnostic(JSON.stringify({missing,plainNode:{status:expected.status,stdout:expected.stdout,stderr:expected.stderr}}));
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[app],toolchain,directory:join(root,missing?'subject':'control')}));
    const execution=oracleExecution(prepared),captured=oracleRuntimeFile(prepared,entry);
    const actual=spawnSync(process.execPath,[...execution.args,captured],{cwd:app,encoding:'utf8',env:{...process.env,...execution.env}});
    assert.equal(actual.status,0,actual.stderr);
    assert.equal(actual.stdout,expected.stdout,'a captured missing module must preserve Node error fields');
    assert.deepEqual(oracleLoaderReady(execution),{ready:true});
  }
});

test('a covered Node resolution exception keeps its exact object identity',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-error-identity-'));t.after(()=>removeOracleSnapshot(root));
  const app=join(root,'app');mkdirSync(app);const entry=join(app,'main.cjs'),witness=join(root,'witness.mjs');
  writeFileSync(witness,"import {registerHooks} from 'node:module';registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(specifier.endsWith('/missing.cjs'))globalThis[Symbol.for('node-resolution-error')]=error;throw error;}}});\n");
  writeFileSync(entry,"try{require(require('node:path').resolve(__dirname,'./missing.cjs'));}catch(error){console.log(error===globalThis[Symbol.for('node-resolution-error')],error.code);}\n");
  const expected=spawnSync(process.execPath,['--import',pathToFileURL(witness).href,entry],{encoding:'utf8'});
  assert.equal(expected.status,0,expected.stderr);assert.equal(expected.stdout,'true MODULE_NOT_FOUND\n');
  const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[app],preloads:[witnessOwner(root,witness)],toolchain,directory:join(root,'scratch')})),execution=oracleExecution(prepared);
  // The observation hook precedes the oracle, so it sees Node's exception
  // before the oracle receives it, rather than observing a later wrapper.
  const actual=spawnSync(process.execPath,['--import',pathToFileURL(witness).href,...execution.args,oracleRuntimeFile(prepared,entry)],{encoding:'utf8',env:{...process.env,...execution.env}});
  assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,expected.stdout);assert.deepEqual(oracleLoaderReady(execution),{ready:true});
});

test('same-worker package metadata follows fresh captured bytes at the same origin',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-package-mutation-'));let worker:OracleWorker|undefined;t.after(()=>{worker?.close();removeOracleSnapshot(root);});
  const app=join(root,'app'),pkg=join(app,'pkg'),outside=join(root,'outside');mkdirSync(pkg,{recursive:true});mkdirSync(outside);
  const entry=join(app,'main.cjs'),config=join(pkg,'package.json');
  writeFileSync(entry,"try{require(require('node:path').resolve(__dirname,'./pkg'));}catch(error){console.log(error.code);}\n");
  worker=new OracleWorker(join(root,'worker'),toolchain);
  const run=(prepared:OraclePrepared)=>{
    const own=oracleExecution(prepared),actual=spawnSync(process.execPath,[...own.args,oracleRuntimeFile(prepared,entry)],{encoding:'utf8',env:{...process.env,...own.env}});
    return {actual,health:oracleLoaderReady(own)};
  };
  const manifests:string[]=[];
  for(const changed of [false,true]){
    const main=changed?'../../outside/missing.cjs':'./missing.cjs';writeFileSync(config,JSON.stringify({main}));
    const prepared:OraclePrepared=(await worker.prepare({entry,project:null,runtimeRoots:[app],directory:join(root,'prepared')}));manifests.push(prepared.manifest);
    const index=JSON.parse(readFileSync(join(dirname(prepared.manifest),'source-index.json'),'utf8'));
    const fact=index.trees[0].coverage.packages.find((fact:{directory:string})=>fact.directory===pkg);
    assert.equal(fact.main,main);assert.equal(fact.sha256,createHash('sha256').update(readFileSync(config)).digest('hex'));
    const current=run(prepared);assert.equal(current.actual.status,0,current.actual.stderr);
    if(!changed)assert.equal(current.actual.stdout,'MODULE_NOT_FOUND\n');
    else {assert.equal(current.actual.stdout,'undefined\n','an incomplete domain stops before a Node exception exists');if(!current.health.ready)assert.match(current.health.why,/resolution context was not captured/);}
    assert.equal(current.health.ready,!changed,'new metadata at the same origin changes the captured failure authority');
  }
  assert.notEqual(dirname(manifests[0]!),dirname(manifests[1]!),'every metadata parse uses a fresh owned snapshot path');
  const captured=(await worker.prepare({entry,project:null,runtimeRoots:[app,outside],directory:join(root,'prepared')}));
  const control=run(captured);assert.equal(control.actual.status,0,control.actual.stderr);assert.equal(control.actual.stdout,'MODULE_NOT_FOUND\n');assert.deepEqual(control.health,{ready:true});
});

test('captured main metadata matches Node for string, non-string and invalid fields',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-package-fields-'));t.after(()=>removeOracleSnapshot(root));
  const app=join(root,'app'),pkg=join(app,'pkg');mkdirSync(pkg,{recursive:true});const entry=join(app,'main.cjs');
  writeFileSync(entry,"try{console.log(require(require('node:path').resolve(__dirname,'./pkg')));}catch(error){console.log(error.code);}\n");
  writeFileSync(join(pkg,'index.cjs'),'module.exports=23;\n');writeFileSync(join(pkg,'index.js'),'module.exports=23;\n');writeFileSync(join(pkg,'value.cjs'),'module.exports=19;\n');
  const cases=[{text:JSON.stringify({main:'./value.cjs'}),main:'./value.cjs',stdout:'19\n'},
    ...['',19,false,null,{}].map(main=>({text:JSON.stringify({main}),main:typeof main==='string'?main:null,stdout:'23\n'})),
    {text:'\uFEFF'+JSON.stringify({main:'./value.cjs'}),main:'./value.cjs',stdout:'19\n'},
    {text:'{"main":',main:null,stdout:'ERR_INVALID_PACKAGE_CONFIG\n'}];
  for(const [at,item] of cases.entries()){
    writeFileSync(join(pkg,'package.json'),item.text);
    const expected=spawnSync(process.execPath,['--no-warnings',entry],{encoding:'utf8'});assert.equal(expected.status,0,expected.stderr);assert.equal(expected.stdout,item.stdout);
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[app],toolchain,directory:join(root,'prepared')})),own=oracleExecution(prepared);
    const index=JSON.parse(readFileSync(join(dirname(prepared.manifest),'source-index.json'),'utf8')),fact=index.trees[0].coverage.packages.find((fact:{directory:string})=>fact.directory===pkg);
    assert.equal(fact.main,item.main);assert.equal(fact.valid,at!==cases.length-1);
    const actual=spawnSync(process.execPath,[...own.args,'--no-warnings',oracleRuntimeFile(prepared,entry)],{encoding:'utf8',env:{...process.env,...own.env}});
    t.diagnostic(JSON.stringify({at,packageJson:item.text,plain:{status:expected.status,stdout:expected.stdout,stderr:expected.stderr},actual:{status:actual.status,stdout:actual.stdout,stderr:actual.stderr}}));
    assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,expected.stdout);assert.equal(actual.stderr,expected.stderr);assert.deepEqual(oracleLoaderReady(own),{ready:true});
  }
});

test('a package.json directory remains a runtime asset rather than package metadata',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-package-directory-'));
  t.after(()=>removeOracleSnapshot(root));
  const app=join(root,'app'),assets=join(app,'assets');mkdirSync(assets,{recursive:true});
  const entry=join(app,'main.cjs');
  writeFileSync(entry,"const fs=require('node:fs');console.log(JSON.stringify(fs.readdirSync(__dirname+'/assets',{withFileTypes:true}).map(item=>[item.name,item.isDirectory()])));\n");
  for(const directory of [false,true]){
    if(directory)mkdirSync(join(assets,'package.json'));
    const expected=spawnSync(process.execPath,[entry],{cwd:app,encoding:'utf8'});
    assert.equal(expected.status,0,expected.stderr);
    assert.equal(expected.stdout,directory?'[["package.json",true]]\n':'[]\n');
    t.diagnostic(JSON.stringify({directory,plainNode:{status:expected.status,stdout:expected.stdout,stderr:expected.stderr}}));
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[app],toolchain,directory:join(root,directory?'subject':'control')}));
    const execution=oracleExecution(prepared),captured=oracleRuntimeFile(prepared,entry);
    const actual=spawnSync(process.execPath,[...execution.args,captured],{cwd:app,encoding:'utf8',env:{...process.env,...execution.env}});
    assert.equal(actual.status,0,actual.stderr);
    assert.deepEqual(oracleLoaderReady(execution),{ready:true});
    assert.equal(actual.stdout,expected.stdout,'a directory named package.json must retain its literal kind without becoming a scope file');
  }
});

test('runtime directory capture preserves dangling entries instead of deciding a changed listing',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-dangling-'));
  t.after(()=>removeOracleSnapshot(root));
  const app=join(root,'app');mkdirSync(app);
  const entry=join(app,'main.cjs');
  writeFileSync(entry,"const fs=require('node:fs');console.log(JSON.stringify(fs.readdirSync(__dirname).sort()));\n");
  for(const dangling of [false,true]){
    if(dangling)symlinkSync('missing.txt',join(app,'dangling'));
    const expected=spawnSync(process.execPath,[entry],{cwd:app,encoding:'utf8'});
    assert.equal(expected.status,0,expected.stderr);
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[app],toolchain,directory:join(root,dangling?'subject':'control')}));
    const execution=oracleExecution(prepared),captured=oracleRuntimeFile(prepared,entry);
    const actual=spawnSync(process.execPath,[...execution.args,captured],{cwd:app,encoding:'utf8',env:{...process.env,...execution.env}});
    assert.equal(actual.status,0,actual.stderr);
    assert.deepEqual(oracleLoaderReady(execution),{ready:true});
    assert.equal(actual.stdout,expected.stdout,'a dangling entry must not silently disappear from the captured directory');
  }
});

test('literal internal link cycles retain Node errors and dangling-target appearance holds reuse',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-link-graph-'));t.after(()=>removeOracleSnapshot(root));
  const app=join(root,'app');mkdirSync(app);
  const entry=join(app,'main.cjs');
  writeFileSync(entry,"const fs=require('node:fs');for(const name of ['self','a','dangling']){console.log(name,fs.readlinkSync(__dirname+'/'+name));try{fs.statSync(__dirname+'/'+name)}catch(e){console.log(e.code)}}\n");
  symlinkSync('self',join(app,'self'));symlinkSync('b',join(app,'a'));symlinkSync('a',join(app,'b'));symlinkSync('missing',join(app,'dangling'));
  const expected=spawnSync(process.execPath,[entry],{encoding:'utf8'});assert.equal(expected.status,0,expected.stderr);
  const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[app],toolchain,directory:join(root,'scratch')}));
  const run=()=>{const own=oracleExecution(prepared);return {own,result:spawnSync(process.execPath,[...own.args,oracleRuntimeFile(prepared,entry)],{encoding:'utf8',env:{...process.env,...own.env}})};};
  const first=run();assert.equal(first.result.status,0,first.result.stderr);assert.equal(first.result.stdout,expected.stdout);assert.deepEqual(oracleLoaderReady(first.own),{ready:true});
  writeFileSync(join(app,'missing'),'appeared');const changed=run();assert.equal(changed.result.status,0,changed.result.stderr);assert.equal(changed.result.stdout,expected.stdout);assert.deepEqual(oracleLoaderReady(changed.own),{ready:true});
  const final=oracleOwner.finishOracleSnapshot(prepared);assert.equal(final.ready,false,'an appearing original link target invalidates the parent snapshot');
});

test('relative runtime links outside declared roots hold before execution',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-link-escape-'));t.after(()=>removeOracleSnapshot(root));
  const app=join(root,'app');mkdirSync(app);const entry=join(app,'main.cjs');writeFileSync(entry,"console.log('must not run');");
  writeFileSync(join(root,'outside'),'outside');symlinkSync('../outside',join(app,'escape'));
  (await assert.rejects(async ()=>(await prepareOracle({entry,project:null,runtimeRoots:[app],toolchain,directory:join(root,'scratch')})),/link escapes its captured roots/));
});


function authoredExecution(prepared:OraclePrepared,entry:string){
  const execution=oracleExecution(prepared),manifest=readFileSync(prepared.manifest);
  writeFileSync(join(dirname(execution.loaderState),'plain-node-inputs.json'),JSON.stringify({version:1,manifestSha256:createHash('sha256').update(manifest).digest('hex'),inputs:[{path:entry,sha256:createHash('sha256').update(readFileSync(entry)).digest('hex')}]})+'\n',{flag:'wx'});
  return execution;
}

test('authored CommonJS keeps Node lookup paths outside capture',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-plain-cjs-'));t.after(()=>removeOracleSnapshot(root));
  const app=join(root,'app'),outside=join(root,'outside');mkdirSync(join(app,'pkg'),{recursive:true});mkdirSync(outside);
  const entry=join(app,'main.cjs');
  writeFileSync(entry,"console.log(require('./pkg'));\n");
  writeFileSync(join(app,'pkg/package.json'),JSON.stringify({main:'../../outside/value.cjs'}));
  writeFileSync(join(app,'pkg/index.js'),'module.exports=23;\n');writeFileSync(join(outside,'value.cjs'),'module.exports=19;\n');
  const plain=spawnSync(process.execPath,[entry],{cwd:app,encoding:'utf8'});assert.equal(plain.status,0,plain.stderr);assert.equal(plain.stdout,'19\n');
  const executions:OraclePrepared[]=[];
  for(const captureOutside of [true,false]){
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:captureOutside?[app,outside]:[app],toolchain,directory:join(root,captureOutside?'control':'subject')})),execution=authoredExecution(prepared,entry);
    const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:app,encoding:'utf8',env:{...process.env,...execution.env}});
    t.diagnostic(JSON.stringify({scope:'authored CommonJS / plain node (outside capture)',captureOutside,plain:{status:plain.status,stdout:plain.stdout,stderr:plain.stderr},actual:{status:actual.status,stdout:actual.stdout,stderr:actual.stderr},health:oracleLoaderReady(execution)}));
    assert.equal(actual.status,plain.status,actual.stderr);assert.equal(actual.stdout,plain.stdout);assert.deepEqual(oracleLoaderReady(execution),{ready:true});
    executions.push(execution);
  }
  for(const execution of executions){
    const events=readFileSync(execution.loaderState+'.scope.jsonl','utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.ok(events.some(event=>event.version===1&&event.scope==='plain-node'&&event.path===entry));
  }
});

test('emitted CommonJS cannot borrow an authored JavaScript exemption',async t=>{
  for(const relative of [false,true]){
    const root=workspace(t,{'src/main.cts':relative?"try{console.log(require('./value.cjs'));}catch(error){console.log((error as {code?:string}).code);}\n":"console.log(require('node:path').basename('/19'));\n",'src/value.cjs':'module.exports=19;\n'});
    const prepared=(await prepare(root,'src/main.cts')),execution=oracleExecution(prepared),actual=execute(root,execution,'src/main.cts');
    if(!relative){assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'19\n');assert.deepEqual(oracleLoaderReady(execution),{ready:true});}
    else {const health=oracleLoaderReady(execution);assert.equal(health.ready,false,'emitted CommonJS relative resolution has no public caller authority');if(!health.ready)assert.match(health.why,/unproved CommonJS route/);}
  }
});

test('a direct emitted CommonJS output retains its provider role through a plain caller',async t=>{
  for(const relative of [false,true]){
    const root=workspace(t,{
      'src/main.cjs':"const {readFileSync}=require('node:fs');const {resolve,dirname}=require('node:path');const manifest=JSON.parse(readFileSync(process.env.NTS_ORACLE_EMIT_MANIFEST,'utf8'));const output=resolve(dirname(process.env.NTS_ORACLE_EMIT_MANIFEST),manifest.sources[resolve(__dirname,'provider.cts')]);try{console.log(require(output).value);}catch(error){console.log(error.code);}\n",
      'src/provider.cts':relative?"export const value=require('./value.cjs');\n":"export const value=19;\n",
      'src/value.cjs':'module.exports=23;\n',
    },{module:'nodenext',moduleResolution:'nodenext'}),entry=join(root,'src/main.cjs');
    const prepared=(await prepareOracle({entry,project:null,preloads:[{entry:join(root,'src/provider.cts'),project:join(root,'tsconfig.json')}],runtimeRoots:[join(root,'src')],toolchain,directory:join(root,'prepared')})),execution=authoredExecution(prepared,entry);
    const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:root,encoding:'utf8',env:{...process.env,...execution.env}}),health=oracleLoaderReady(execution);
    assert.equal(actual.status,0,actual.stderr);
    if(!relative){assert.equal(actual.stdout,'19\n');assert.deepEqual(health,{ready:true});}
    else {assert.equal(health.ready,false,'a direct emitted .cjs URL cannot become authored JavaScript');if(!health.ready)assert.match(health.why,/unproved CommonJS route/);}
  }
});

test('authored CommonJS transitions keep TypeScript providers governed',async t=>{
  for(const preparedProvider of [true,false]){
    const root=workspace(t,{'src/main.cjs':"try{console.log(require('./provider.ts').value);}catch(error){console.log(error.code);}\n",'src/provider.ts':'export const value:number=19;\n'}),entry=join(root,'src/main.cjs');
    const prepared=(await prepareOracle({entry,project:null,preloads:preparedProvider?[{entry:join(root,'src/provider.ts'),project:join(root,'tsconfig.json')}]:[],runtimeRoots:[join(root,'src')],toolchain,directory:join(root,preparedProvider?'control':'subject')})),execution=authoredExecution(prepared,entry);
    const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:root,encoding:'utf8',env:{...process.env,...execution.env}});
    if(preparedProvider){assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'19\n');assert.deepEqual(oracleLoaderReady(execution),{ready:true});}
    else {const health=oracleLoaderReady(execution);assert.equal(health.ready,false,'plain CommonJS does not grant a TypeScript provider permission');if(!health.ready)assert.match(health.why,/TypeScript import was not prepared/);}
  }
});

test('authored CommonJS admits its literal ESM closure and holds an unobserved computed target',async t=>{
  for(const literal of [true,false])await t.test(literal?'captured literal':'unobserved computed request',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-cjs-esm-'));t.after(()=>removeOracleSnapshot(root));
  const app=join(root,'app');mkdirSync(app);const entry=join(app,'main.cjs');
  writeFileSync(entry,"try{console.log(require("+(literal?"'../outside.mjs'":"process.argv[2]")+").value);}catch(error){console.log(error.code);}\n");
  writeFileSync(join(root,'outside.mjs'),'export const value=19;\n');
  const plain=spawnSync(process.execPath,[entry,'../outside.mjs'],{cwd:app,encoding:'utf8'});assert.equal(plain.status,0,plain.stderr);assert.equal(plain.stdout,'19\n');
  const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[app],toolchain,directory:join(root,'prepared')})),execution=authoredExecution(prepared,entry);
  const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry),'../outside.mjs'],{cwd:app,encoding:'utf8',env:{...process.env,...execution.env}});
  if(literal){assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'19\n');assert.deepEqual(oracleLoaderReady(execution),{ready:true});}
  else {assert.notEqual(actual.stdout,'19\n');assert.equal(oracleLoaderReady(execution).ready,false,'an authored CommonJS parent cannot exempt unobserved ESM code from ownership');}
  });
});


test('non-file ESM transitions hold before either authored or emitted code can run',async t=>{
  for(const authored of [true,false]){
    const body="export {};const request='data:text/javascript,globalThis.scopeLeak=19';try{await import(request);}catch{}console.log((globalThis as typeof globalThis & {scopeLeak?:number}).scopeLeak??0);\n";
    const root=workspace(t,{'src/main.ts':body,'src/main.cjs':"(async()=>{const request='data:text/javascript,globalThis.scopeLeak=19';try{await import(request);}catch{}console.log(globalThis.scopeLeak??0);})();\n"});
    const entry=join(root,authored?'src/main.cjs':'src/main.ts'),prepared=authored?(await prepareOracle({entry,project:null,runtimeRoots:[join(root,'src')],toolchain,directory:join(root,'prepared')})):(await prepare(root));
    const execution=authored?authoredExecution(prepared,entry):oracleExecution(prepared);
    const actual=spawnSync(process.execPath,[...execution.args,authored?oracleRuntimeFile(prepared,entry):entry],{cwd:root,encoding:'utf8',env:{...process.env,...execution.env}});
    assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'0\n','unowned data URL code must not execute');
    const health=oracleLoaderReady(execution);assert.equal(health.ready,false);if(!health.ready)assert.match(health.why,/module URL has no captured owner|resolution context was not captured: data:.*; unproved ESM package name/);
  }
});

test('authored scope records grant neither a changed manifest nor foreign input bytes',async t=>{
  const root=workspace(t,{'src/main.cjs':"console.log(require('node:path').basename('/19'));\n"}),entry=join(root,'src/main.cjs');
  const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[join(root,'src')],toolchain,directory:join(root,'prepared')}));
  for(const mutation of ['none','manifest','input','foreign']){
    const execution=oracleExecution(prepared,undefined,[entry]),file=join(dirname(execution.loaderState),'plain-node-inputs.json'),record=JSON.parse(readFileSync(file,'utf8'));
    if(mutation==='manifest')record.manifestSha256='0'.repeat(64);
    if(mutation==='input')record.inputs[0].sha256='0'.repeat(64);
    if(mutation==='foreign')record.inputs[0].path=join(root,'foreign.cjs');
    writeFileSync(file,JSON.stringify(record)+'\n');
    const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:root,encoding:'utf8',env:{...process.env,...execution.env}});
    if(mutation==='none'){assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'19\n');assert.deepEqual(oracleLoaderReady(execution),{ready:true});}
    else {assert.equal(actual.stdout,'');assert.equal(oracleLoaderReady(execution).ready,false,'invalid scope qualification must hold before code');}
  }
});

test('plain authored callers retain distinct public CommonJS search contexts',async t=>{
  for(const synthetic of [false,true])for(const changed of [false,true]){
    const root=mkdtempSync(join(tmpdir(),'nts-oracle-cjs-callers-'));t.after(()=>removeOracleSnapshot(root));
    const app=join(root,'app'),alternate=join(root,'alternate'),entry=join(app,'main.cjs');
    for(const [directory,value] of [[app,19],[alternate,23]] as const){mkdirSync(join(directory,'node_modules/sample'),{recursive:true});writeFileSync(join(directory,'node_modules/sample/package.json'),'{"type":"commonjs"}');writeFileSync(join(directory,'node_modules/sample/index.js'),'module.exports='+value+';\n');}
    const setup=synthetic?"const Module=require('node:module');const shadow=new Module(__filename,module);shadow.filename=__filename;shadow.paths=[...module.paths];":"const {createRequire}=require('node:module');";
    const change=changed?(synthetic?"shadow.paths=[require('node:path').resolve(__dirname,'../alternate/node_modules')];":"module.paths=[require('node:path').resolve(__dirname,'../alternate/node_modules')];"):'';
    const calls=synthetic?"const first=require('sample');delete require.cache[require.resolve('sample')];console.log(first,shadow.require('sample'));":"const fresh=createRequire(__filename);console.log(require(require.resolve('sample')),fresh(fresh.resolve('sample')));";
    writeFileSync(entry,setup+change+calls+'\n');
    const plain=spawnSync(process.execPath,[entry],{cwd:app,encoding:'utf8'});assert.equal(plain.status,0,plain.stderr);assert.equal(plain.stdout,changed?(synthetic?'19 23\n':'23 19\n'):'19 19\n');
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[app],toolchain,directory:join(root,'prepared')})),execution=authoredExecution(prepared,entry);
    const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:app,encoding:'utf8',env:{...process.env,...execution.env}});
    assert.equal(actual.status,plain.status,actual.stderr);assert.equal(actual.stdout,plain.stdout);assert.deepEqual(oracleLoaderReady(execution),{ready:true});
  }
});


test('a program cannot qualify a governed ESM parent as an authored CommonJS wrapper',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-wrapper-authority-'));t.after(()=>removeOracleSnapshot(root));
  const app=join(root,'app'),outside=join(root,'outside');mkdirSync(app);mkdirSync(outside);
  const entry=join(app,'main.cjs'),provider=join(app,'provider.mjs');
  writeFileSync(provider,"import {createRequire} from 'node:module';createRequire(import.meta.url)('../outside/value.cjs');\n");
  writeFileSync(join(outside,'value.cjs'),'globalThis.scopeOutside=19;\n');
  writeFileSync(entry,`(async()=>{const {pathToFileURL}=require('node:url');const loader=await import(new URL('./assets/oracle-loader.ts',pathToFileURL(process.env.NTS_ORACLE_EMIT_MANIFEST)));if(process.argv[2]==='spoof'&&typeof loader.oracleAuthoredCommonJS==='function')loader.oracleAuthoredCommonJS(require('node:path').join(__dirname,'provider.mjs'),__filename);try{await import('./provider.mjs');}catch{}console.log(globalThis.scopeOutside??0);})();\n`);
  const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[app],toolchain,directory:join(root,'prepared')}));
  for(const spoof of [false,true]){
    const execution=authoredExecution(prepared,entry),actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry),spoof?'spoof':'control'],{cwd:app,encoding:'utf8',env:{...process.env,...execution.env}});
    t.diagnostic(JSON.stringify({spoof,status:actual.status,stdout:actual.stdout,stderr:actual.stderr,health:oracleLoaderReady(execution)}));
    assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'0\n','a governed provider cannot manufacture a plain CommonJS parent');assert.equal(oracleLoaderReady(execution).ready,false);
  }
});

test('a query or fragment cannot create another bootstrap authority',async t=>{
  for(const suffix of ['?copy','#copy']){
    const root=workspace(t,{'src/main.cjs':`(async()=>{const {pathToFileURL}=require('node:url');try{await import(new URL('./assets/oracle-loader.ts${suffix}',pathToFileURL(process.env.NTS_ORACLE_EMIT_MANIFEST)));}catch{}console.log('done');})();\n`}),entry=join(root,'src/main.cjs');
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[join(root,'src')],toolchain,directory:join(root,'prepared')})),execution=authoredExecution(prepared,entry);
    const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:root,encoding:'utf8',env:{...process.env,...execution.env}});
    assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'done\n');assert.equal(oracleLoaderReady(execution).ready,false,'a second bootstrap identity must hold before its code');
  }
});


test('governed absolute CommonJS holds when public extension keys expand its domain',async t=>{
  const body="const path=require('node:path');if(process.argv[2]==='changed')Object.defineProperty(require.extensions,'/../../../outside.cjs',{value:require.extensions['.js'],configurable:true,enumerable:true,writable:true});console.log(require(path.join(__dirname,'pkg/value')));\n";
  const root=workspace(t,{'src/main.cts':body,'src/reference.cjs':body,'src/pkg/value/index.js':'module.exports=23;\n','outside.cjs':'module.exports=19;\n'});
  writeFileSync(join(root,'package.json'),'{"type":"commonjs"}');
  const project=join(root,'src/tsconfig.json');writeFileSync(project,JSON.stringify({extends:'../tsconfig.json',files:['main.cts'],include:[]}));
  const prepared=(await prepare(root,'src/main.cts',{project,runtimeRoots:[join(root,'src/pkg')]}));
  for(const changed of [false,true]){
    const mode=changed?'changed':'default',reference=spawnSync(process.execPath,[join(root,'src/reference.cjs'),mode],{cwd:root,encoding:'utf8'});
    assert.equal(reference.status,0,reference.stderr);assert.equal(reference.stdout,changed?'19\n':'23\n');
    const execution=oracleExecution(prepared),actual=spawnSync(process.execPath,[...execution.args,join(root,'src/main.cts'),mode],{cwd:root,encoding:'utf8',env:{...process.env,...execution.env}}),health=oracleLoaderReady(execution);
    t.diagnostic(JSON.stringify({changed,reference:{status:reference.status,stdout:reference.stdout,stderr:reference.stderr},actual:{status:actual.status,stdout:actual.stdout,stderr:actual.stderr},health}));
    if(!changed){assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,reference.stdout);assert.deepEqual(health,{ready:true});}
    else {assert.equal(health.ready,false,'a changed extension domain must hold before Node can choose a guessed fallback');if(!health.ready)assert.match(health.why,/CommonJS extension domain/);}
  }
});


test('governed ESM proves the package domain before a successful main fallback',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-esm-domain-'));t.after(()=>removeOracleSnapshot(root));
  const app=join(root,'app'),outside=join(root,'outside');mkdirSync(join(app,'node_modules/pkg'),{recursive:true});mkdirSync(outside);
  const entry=join(app,'main.mjs');writeFileSync(entry,"import value from 'pkg';console.log(value);\n");
  writeFileSync(join(app,'package.json'),'{"type":"module"}');
  writeFileSync(join(app,'node_modules/pkg/package.json'),JSON.stringify({main:'../../../outside/value.cjs'}));
  writeFileSync(join(app,'node_modules/pkg/index.js'),'module.exports=23;\n');writeFileSync(join(outside,'value.cjs'),'module.exports=19;\n');
  const reference=spawnSync(process.execPath,[entry],{cwd:app,encoding:'utf8'});assert.equal(reference.status,0,reference.stderr);assert.equal(reference.stdout,'19\n');
  for(const captureOutside of [true,false]){
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:captureOutside?[app,outside]:[app],toolchain,directory:join(root,captureOutside?'control':'subject')})),execution=oracleExecution(prepared);
    const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:app,encoding:'utf8',env:{...process.env,...execution.env}}),health=oracleLoaderReady(execution);
    t.diagnostic(JSON.stringify({captureOutside,reference:{status:reference.status,stdout:reference.stdout,stderr:reference.stderr},actual:{status:actual.status,stdout:actual.stdout,stderr:actual.stderr},health}));
    if(captureOutside){assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,reference.stdout);assert.deepEqual(health,{ready:true});}
    else assert.equal(health.ready,false,'a successful owned fallback cannot turn an unobserved ESM main candidate into absence');
  }
});


test('program code without an authenticated driver cannot obtain a wrapper capability',async t=>{
  const root=workspace(t,{'src/main.cjs':"(async()=>{const assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');const api=await import(new URL('./assets/oracle-loader.ts',pathToFileURL(process.env.NTS_ORACLE_EMIT_MANIFEST)));assert.equal(typeof api.oracleHarnessCapability,'function');assert.throws(()=>api.oracleHarnessCapability(),/unavailable or already consumed/);console.log('denied');})();\n"}),entry=join(root,'src/main.cjs');
  const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[join(root,'src')],toolchain,directory:join(root,'prepared')})),execution=authoredExecution(prepared,entry);
  const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:root,encoding:'utf8',env:{...process.env,...execution.env}});
  assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'denied\n');const health=oracleLoaderReady(execution);assert.equal(health.ready,false);if(!health.ready)assert.match(health.why,/harness capability is unavailable or already consumed/);
});

test('every reserved child bootstrap completes exactly once before owner readiness',t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-child-events-'));t.after(()=>removeOracleSnapshot(root));
  const template={manifest:join(root,'manifest.json'),loaderState:'unused',snapshot:{version:1,manifestSha256:'0'.repeat(64),index:{path:'runtime-index/'+ '0'.repeat(64)+'.json',sha256:'0'.repeat(64)}},args:[],env:{}} as unknown as OraclePrepared;
  const line=(status:string,extra:Record<string,unknown>={})=>JSON.stringify({version:1,status,...extra})+'\n';
  const check=(raw:string)=>{const execution=oracleExecution(template);try{writeFileSync(execution.loaderState,raw);const result=oracleLoaderReady(execution);assert.equal(oracleLoaderReady(execution),result);return result;}finally{closeOracleExecution(execution);}};
  const ready=line('ready'),start=line('child-start',{execution:'execution-one'}),end=line('child-begin',{execution:'execution-one'})+line('child-ready',{execution:'execution-one'});
  for(const raw of ['{\"version\":1.0,\"status\":\"ready\"}\n','{\"version\":1e0,\"status\":\"ready\"}\n',ready,ready+start+end,start+ready+end]){
    assert.deepEqual(check(raw),{ready:true});
  }
  for(const raw of ['{\"version\":\"1\",\"status\":\"ready\"}\n','{\"version\":true,\"status\":\"ready\"}\n',ready+start,ready+end,ready+start+start+end,ready+start+end+end,
    ready+start+line('child-ready',{execution:'execution-two'}),
    ready+line('child-start',{execution:'execution-'}),ready+line('child-start',{execution:'execution-one/child'}),
    ready+line('child-start',{execution:1}),ready+line('child-start',{execution:'execution-one',extra:true}),
    (ready+start+end).trimEnd(),ready+start+end+line('instrument',{reason:'child failed after bootstrap'})]){
    assert.equal(check(raw).ready,false,raw);
  }
});

test('an execution reads its retained stream after pathname replacement and caches that drained result',t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-event-owner-'));t.after(()=>removeOracleSnapshot(root));
  const template={manifest:join(root,'manifest.json'),loaderState:'unused',snapshot:{version:1,manifestSha256:'0'.repeat(64),index:{path:'runtime-index/'+ '0'.repeat(64)+'.json',sha256:'0'.repeat(64)}},args:[],env:{}} as unknown as OraclePrepared;
  const execution=oracleExecution(template),original=execution.loaderState+'.original';
  try{
    writeFileSync(execution.loaderState,JSON.stringify({version:1,status:'ready'})+'\n');
    renameSync(execution.loaderState,original);
    writeFileSync(execution.loaderState,JSON.stringify({version:1,status:'ready'})+'\n');
    appendFileSync(original,JSON.stringify({version:1,status:'instrument',reason:'original stream owner'})+'\n');
    const result=oracleLoaderReady(execution);assert.deepEqual(result,{ready:false,why:'original stream owner'});
    writeFileSync(original,JSON.stringify({version:1,status:'ready'})+'\n');
    assert.equal(oracleLoaderReady(execution),result,'the drained verdict belongs to that one execution');
  }finally{closeOracleExecution(execution);}
});

test('owned execution descriptors close after success, holds, failed launch and thrown errors',t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-event-fds-'));t.after(()=>removeOracleSnapshot(root));
  const template={manifest:join(root,'manifest.json'),loaderState:'unused',snapshot:{version:1,manifestSha256:'0'.repeat(64),index:{path:'runtime-index/'+ '0'.repeat(64)+'.json',sha256:'0'.repeat(64)}},args:[],env:{}} as unknown as OraclePrepared;
  assert.equal(typeof Reflect.get(oracleOwner,'closeOracleExecution'),'function');
  const before=readdirSync('/proc/self/fd').length;
  for(let index=0;index<32;index++){
    const execution=oracleExecution(template),mode=index%4;
    assert.equal(readdirSync('/proc/self/fd').length,before+1);
    try{
      if(mode===3)throw Error('owned descriptor error control');
      if(mode===2){const run=spawnSync(join(root,'missing-node'),[]);assert.ok(run.error);continue;}
      const raw=mode===0?JSON.stringify({version:1,status:'ready'})+'\n':'{';
      const run=spawnSync(process.execPath,['-e','require("node:fs").writeFileSync(process.argv[1],process.argv[2])',execution.loaderState,raw]);
      assert.equal(run.status,0,run.stderr?.toString());assert.equal(oracleLoaderReady(execution).ready,mode===0);
    }catch(error){assert.equal(mode,3);assert.equal(String(error),'Error: owned descriptor error control');}
    finally{closeOracleExecution(execution);}
  }
  assert.equal(readdirSync('/proc/self/fd').length,before,'descriptor count must not grow across execution outcomes');
});

test('a successful Node result still needs an exact captured owner after domain proof',async t=>{
  const root=workspace(t,{'src/main.ts':"export {};const spec='./value.mjs';console.log((await import(spec)).value);\n",'src/value.mjs':'export const value=19;\n'});
  const outside=join(root,'outside.mjs'),marker=join(root,'outside-ran');
  writeFileSync(outside,"import {writeFileSync} from 'node:fs';writeFileSync("+JSON.stringify(marker)+",'ran');export const value=23;\n");
  // Exclude the outside source from the project's literal runtime root by
  // placing the project under src; both arms share its actual file bytes.
  const project=ordinaryProject(root,['main.ts'],'src/tsconfig.json');
  for(const changed of [false,true]){
    const witness=join(root,changed?'redirect.mjs':'control.mjs');
    writeFileSync(witness,"import {registerHooks} from 'node:module';registerHooks({resolve(specifier,context,next){const result=next(specifier,context);return "+changed+"&&specifier.endsWith('/value.mjs')?{...result,url:"+JSON.stringify(pathToFileURL(outside).href)+"}:result;}});\n");
    const prepared=(await prepareOracle({entry:join(root,'src/main.ts'),project,runtimeRoots:[join(root,'src/value.mjs')],preloads:[witnessOwner(root,witness)],directory:join(root,changed?'subject':'control'),toolchain})),execution=oracleExecution(prepared);
    const run=spawnSync(process.execPath,['--import',pathToFileURL(witness).href,...execution.args,join(root,'src/main.ts')],{encoding:'utf8',env:{...process.env,...execution.env}}),health=oracleLoaderReady(execution);
    if(!changed){assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');assert.deepEqual(health,{ready:true});}
    else {assert.equal(health.ready,false);assert.equal(existsSync(marker),false,'the unowned result must hold before its code runs');}
  }
});


test('governed lookups revalidate queried package bytes, link text and file kind after bootstrap',async t=>{
  for(const mutation of ['package','link','kind'])await t.test(mutation,async ()=>{
    for(const changed of [false,true]){
      const root=mkdtempSync(join(tmpdir(),'nts-oracle-query-'+mutation+'-'));t.after(()=>removeOracleSnapshot(root));
      const app=join(root,'app');mkdirSync(app);mkdirSync(join(root,'outside'));
      writeFileSync(join(root,'outside/value.cjs'),'module.exports=23;\n');
      let change:string,request:string;
      if(mutation==='package'){
        mkdirSync(join(app,'node_modules/pkg'),{recursive:true});
        writeFileSync(join(app,'node_modules/pkg/package.json'),JSON.stringify({main:'./value.cjs'}));
        writeFileSync(join(app,'node_modules/pkg/value.cjs'),'module.exports=19;\n');
        writeFileSync(join(app,'node_modules/pkg/index.js'),'module.exports=17;\n');
        change="chmodSync(new URL('./node_modules/pkg/package.json',import.meta.url),0o600);writeFileSync(new URL('./node_modules/pkg/package.json',import.meta.url),JSON.stringify({main:'../../../outside/value.cjs'}));";
        request='pkg';
      }else if(mutation==='link'){
        mkdirSync(join(app,'one'));writeFileSync(join(app,'one/value.mjs'),'export default 19;\n');
        symlinkSync('one',join(app,'alias'));
        change="chmodSync(new URL('./',import.meta.url),0o700);unlinkSync(new URL('./alias',import.meta.url));symlinkSync('./one',new URL('./alias',import.meta.url));";
        request='./alias/value.mjs';
      }else{
        writeFileSync(join(app,'value.mjs'),'export default 19;\n');writeFileSync(join(app,'other.mjs'),'export default 23;\n');
        change="chmodSync(new URL('./',import.meta.url),0o700);unlinkSync(new URL('./value.mjs',import.meta.url));symlinkSync('./other.mjs',new URL('./value.mjs',import.meta.url));";
        request='./value.mjs';
      }
      const entry=join(app,'main.mjs');
      writeFileSync(entry,"import {chmodSync,writeFileSync,unlinkSync,symlinkSync} from 'node:fs';const request="+JSON.stringify(request)+";console.log('bootstrap');if(process.argv[2]==='change'){"+change+"}try{console.log((await import(request)).default);}catch(error){console.log(error.message);}\n");
      const prepared=(await prepareOracle({entry,project:null,runtimeRoots:mutation==='package'?[app,join(app,'node_modules/pkg')]:[app],toolchain,directory:join(root,'prepared')})),execution=oracleExecution(prepared);
      const args=changed?['change']:[],actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry),...args],{cwd:app,encoding:'utf8',env:{...process.env,...execution.env}}),health=oracleLoaderReady(execution);
      const reference=spawnSync(process.execPath,[entry,...args],{cwd:app,encoding:'utf8'});
      t.diagnostic(JSON.stringify({mutation,changed,actual:{status:actual.status,stdout:actual.stdout,stderr:actual.stderr},reference:{status:reference.status,stdout:reference.stdout,stderr:reference.stderr},health}));
      assert.equal(actual.status,0,actual.stderr);assert.equal(reference.status,0,reference.stderr);
      assert.ok(actual.stdout.startsWith('bootstrap\n'),'the application must run after a successful bootstrap before mutating the query');
      if(!changed){assert.equal(reference.stdout,'bootstrap\n19\n');assert.equal(actual.stdout,reference.stdout);assert.deepEqual(health,{ready:true});}
      else {assert.equal(health.ready,false,'the changed query answer must hold before Node resolves it');if(!health.ready)assert.match(health.why,/oracle filesystem (file|readlink|runtimeKind) changed/);}
    }
  });
});

test('the shared runtime emit target lowers decorators and preserves owner field semantics',async t=>{
  const body=`function doubled(target:()=>number){return function(){return target()*2;};}
export class Thing { DECORATOR value(){return 5;} }
console.log(new Thing().value());
`;
  const control=workspace(t,{'src/main.ts':body.replace('DECORATOR','')},{target:'ESNext'});
  const clean=(await prepare(control)),cleanRun=execute(control,clean);assert.equal(cleanRun.status,0,cleanRun.stderr);assert.equal(cleanRun.stdout,'5\n');
  const subject=workspace(t,{'src/main.ts':body.replace('DECORATOR','@doubled')},{target:'ESNext'});
  const prepared=(await prepare(subject)),run=execute(subject,prepared);assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'10\n');
  const stored=JSON.parse(readFileSync(prepared.manifest,'utf8'));
  assert.equal(stored.groups[0].options.target,13,'one ES2026 emit target is shared by supported Nodes');
  assert.equal(stored.groups[0].options.useDefineForClassFields,true,'the ESNext owner default is carried explicitly');
  assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
});


test('the runtime target carries default set and define field behavior from each owner',async t=>{
  const body=`class Base { declare item:number; }
Object.defineProperty(Base.prototype,'item',{configurable:true,get(){return 0;},set(value:number){console.log('setter',value);}});
class Derived extends Base { item=7; }
new Derived();export {};
`;
  for(const [target,expected,define] of [['ES2021','setter 7\n',false],['ES2022','',true]] as const)await t.test(target,async ()=>{
    const root=workspace(t,{'src/main.ts':body},{target});
    const prepared=(await prepare(root)),actual=execute(root,prepared);
    assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,expected);
    assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
    const stored=JSON.parse(readFileSync(prepared.manifest,'utf8'));
    assert.equal(stored.groups[0].options.target,13);
    assert.equal(stored.groups[0].options.useDefineForClassFields,define);
  });
});

test('the runtime target preserves an implicit library and module program exactly',async t=>{
  for(const target of ['ESNext',undefined])await t.test(target??'default',async ()=>{
    const root=workspace(t,{'src/main.ts':'console.log(19);export {};\n'});
    writeFileSync(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{...(target?{target}:{}),strict:true,noEmit:true,types:[]},files:['src/main.ts']}));
    const prepared=(await prepare(root)),actual=execute(root,prepared);
    assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'19\n');
    const record=JSON.parse(readFileSync(join(dirname(prepared.manifest),'program/program-result.json'),'utf8'));
    assert.deepEqual(record.proof.beforeFiles,record.proof.afterFiles);
    assert.deepEqual(record.proof.beforeEdges,record.proof.afterEdges);
    assert.deepEqual(record.proof.beforeDiagnostics,record.proof.afterDiagnostics);
    assert.equal(record.options.target,13);
    assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
  });
});


test('owner target-dependent defaults equal the pinned compiler for every accepted target',()=>{
  // getCompilerOptions exposes raw options, not effective defaults. Compare
  // the pinned SDK's implicit program directly with the explicitly carried
  // values. The syntax distinguishes ES2015/2020/2022/Next module defaults.
  const compiler=verifyToolchain(toolchain).compiler;
  const require=createRequire(join(toolchain,'package.json')),{API}=require('typescript/sync'),{serverFS}=require('typescript/fs');
  const targets=[undefined,'ES5',...Array.from({length:12},(_,index)=>'ES'+(2015+index)),'ESNext'];
  const area=mkdtempSync(join(tmpdir(),'nts-oracle-defaults-')),api=new API({cwd:area,tsserverPath:compiler,fs:{
    readFile:serverFS.useOS,fileExists:serverFS.useOS,directoryExists:serverFS.useOS,
    getAccessibleEntries:serverFS.useOS,realpath:serverFS.useOS,stat:serverFS.useOS,
    writeFile:serverFS.error,removeFile:serverFS.error,
  }});
  const diagnostics=(program:import('typescript/sync').Program)=>[
    program.getConfigFileParsingDiagnostics(),program.getProgramDiagnostics(),program.getGlobalDiagnostics(),
    program.getSyntacticDiagnostics(),program.getSemanticDiagnostics(),program.getDeclarationDiagnostics(),
  ];
  try{
    const entry=join(area,'main.ts');
    writeFileSync(entry,`import data from './data.json' with {type:'json'};
export const value=data.value;await Promise.resolve();void import('./other.js');
class Base { declare item:number; }
Object.defineProperty(Base.prototype,'item',{configurable:true,set(value:number){console.log(value);}});
class Derived extends Base { item=7; } export const field=new Derived();\n`);
    writeFileSync(join(area,'data.json'),'{"value":19}');writeFileSync(join(area,'other.ts'),'export const value=23;\n');
    for(const target of targets){
      const config=join(area,(target??'unspecified')+'.json');
      writeFileSync(config,JSON.stringify({compilerOptions:{...(target?{target}:{}),strict:true,noEmit:true,types:[]},files:['main.ts','other.ts']}));
      const parsed=api.parseConfigFile(config),snapshot=api.createSnapshot({openProjects:[config]});let explicit;
      try{
        assert.deepEqual(parsed.errors,[]);const implicit=snapshot.getConfiguredProject(config).program;
        if(target==='ES5'){
          assert.ok(implicit.getProgramDiagnostics().some((diagnostic:Diagnostic)=>diagnostic.code===5108),'the pinned compiler rejects removed ES5 before emission');
          continue;
        }
        const options={...parsed.options};
        for(const key of ['module','useDefineForClassFields'] as const){const item=oracleOwner.ORACLE_EMIT_OPTIONS.find(item=>item.name===key)!;Reflect.set(options,key,item.value('',parsed.options));}
        explicit=snapshot.update({createPrograms:[{rootFiles:parsed.fileNames,compilerOptions:options}]});
        const carried=explicit.operation.createdPrograms[0];
        assert.deepEqual(carried.getSourceFileNames(),implicit.getSourceFileNames(),target??'unspecified');
        assert.deepEqual(diagnostics(carried),diagnostics(implicit),target??'unspecified');
        // This public API intentionally emits despite checking-only options.
        // It tests default resolution, and grants no strict-admission verdict.
        assert.deepEqual([...carried.getJavaScriptEmit([entry]).outputFiles],[...implicit.getJavaScriptEmit([entry]).outputFiles],target??'unspecified');
      }finally{explicit?.dispose();snapshot.dispose();api.clearSourceFileCache();}
    }
  }finally{api.close();removeOracleSnapshot(area);}
});


test('the pinned runtime syntax covers decorators, resources and RegExp modifiers',async t=>{
  const body=`function doubled(target:()=>number){return function(){return target()*2;};}
class Thing { @doubled value(){return 5;} }
using resource=null;
console.log(JSON.stringify([new Thing().value(),resource===null,/[a&&a]/v.test('a'),/(?i:a)/.test('A')]));export {};\n`;
  const root=workspace(t,{'src/main.ts':body},{target:'ESNext'}),prepared=(await prepare(root)),actual=execute(root,prepared);
  assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'[10,true,true,true]\n');
  assert.equal(oracleOwner.ORACLE_RUNTIME_TARGET,13);assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
  const tooOld=workspace(t,{'src/main.ts':body},{target:'ES2024'});
  (await assert.rejects(async ()=>(await prepare(tooOld)),error=>error instanceof TypeScriptDiagnosticError&&/TS18062/.test(error.message)));
});

type OwnerObservationRecord={observations:HostObservation[];proof:{beforeFiles:string[];beforeEdges:{file:string;imports:{resolved:{resolvedFileName:string}|null}[]}[]}};
type OwnerObservationCall={project:string;directory:string;mode:'emit'|'hit'|'held';inputsSha256:string};

async function ownerObservationInvalidation(t:TestContext,kind:'listing'|'failed-lookup'){
  const outside=mkdtempSync(join(tmpdir(),'nts-owner-observation-'));
  const root=workspace(t,{'src/main.ts':'console.log(19);\n'},{types:[],typeRoots:[]});
  const candidate=join(outside,'negative','candidate.d.ts');
  if(kind==='failed-lookup'){
    const fallback=join(outside,'negative','candidate','index.d.ts');
    mkdirSync(dirname(fallback),{recursive:true});writeFileSync(fallback,'export type Marker=number;\n');
    const specifier=relative(join(root,'src'),join(outside,'negative','candidate')).replaceAll('\\','/');
    writeFileSync(join(root,'src/main.ts'),`import type {Marker} from ${JSON.stringify(specifier)};const value:Marker=19;console.log(value);\n`);
    ordinaryProject(root,['src/main.ts']);
  }
  const planned=await sealOracleRun(gateEnvironment(hostEnvironment(process.env),{run:join(outside,'registered'),oracleAdmissionContext:'gate'}));
  const keys=['NTS_ORACLE_DEPENDENCIES','NTS_GATE_ENV_CONTEXT'] as const,previous=keys.map(key=>process.env[key]);
  const cap=JSON.parse(planned.env.NTS_ORACLE_DEPENDENCIES!),records:OwnerObservationRecord[]=[];let green=false;
  try{
    for(const key of keys)process.env[key]=planned.env[key];
    for(let index=0;index<3;index++){
      if(index===2){
        if(kind==='listing')writeFileSync(join(root,'src','appeared.txt'),'a directory observation, not a TypeScript input\n');
        else writeFileSync(candidate,'export type Marker=number;\n');
      }
      const directory=join(outside,'worker-'+index),worker=new OracleWorker(directory,toolchain);
      try{
        const context=JSON.parse(readFileSync(join(directory,'owner-cache.json'),'utf8'));assert.equal(context.shared,true);
        const prepared=oracleExecution((await worker.prepare({entry:join(root,'src/main.ts'),directory:join(outside,'output-'+index)})));
        try{
          const run=execute(root,prepared);assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');
          assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
          const calls=readFileSync(join(cap.directory,'oracle-owner-calls.jsonl'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line) as OwnerObservationCall).filter(row=>row.project===join(root,'tsconfig.json'));
          const last=calls.at(-1);assert.ok(last);records.push(JSON.parse(readFileSync(join(last.directory,last.inputsSha256+'.json'),'utf8')));
        }finally{closeOracleExecution(prepared);}
      }finally{worker.close();}
    }
    const calls=readFileSync(join(cap.directory,'oracle-owner-calls.jsonl'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line) as OwnerObservationCall).filter(row=>row.project===join(root,'tsconfig.json'));
    assert.deepEqual(calls.map(row=>row.mode),['emit','hit','emit']);
    assert.equal(calls[0]!.inputsSha256,calls[1]!.inputsSha256);assert.notEqual(calls[1]!.inputsSha256,calls[2]!.inputsSha256);
    const fact=(record:OwnerObservationRecord,kind:HostObservation['kind'],path:string)=>record.observations.find(row=>row.kind===kind&&row.path===path);
    if(kind==='listing'){
      const before=fact(records[0]!,'entries',join(root,'src')),after=fact(records[2]!,'entries',join(root,'src'));
      assert.ok(before&&after);assert.equal((before.value as DirectoryEntries).files.includes('appeared.txt'),false);assert.equal((after.value as DirectoryEntries).files.includes('appeared.txt'),true);
      assert.deepEqual(records[0]!.proof.beforeFiles,records[2]!.proof.beforeFiles,'only the consulted listing changes, not the program inputs');
    }else{
      assert.equal(fact(records[0]!,'fileExists',candidate)?.value,false,'the original checker really tried this missing module');
      assert.equal(fact(records[2]!,'fileExists',candidate)?.value,true);
      const entries=(record:OwnerObservationRecord)=>record.observations.filter(row=>row.kind==='entries');
      assert.deepEqual(entries(records[0]!),entries(records[2]!),'failed lookup invalidation is independent of directory listings');
      const target=(record:OwnerObservationRecord)=>record.proof.beforeEdges.find(row=>row.file===join(root,'src/main.ts'))!.imports[0]!.resolved!.resolvedFileName;
      assert.equal(target(records[0]!),join(outside,'negative','candidate','index.d.ts'));assert.equal(target(records[2]!),candidate);
    }
    t.diagnostic(JSON.stringify({kind,owner:join(root,'tsconfig.json'),calls,observations:records.map(record=>record.observations)}));green=true;
  }finally{
    for(const [index,key] of keys.entries())if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];
    finishRunTemporary(planned.temporary,planned.env.HOME!,green);if(green)removeOracleSnapshot(outside);
  }
}

test('a consulted directory entry invalidates a shared owner emission',async t=>ownerObservationInvalidation(t,'listing'));
test('a previously missing module invalidates a shared owner emission',async t=>ownerObservationInvalidation(t,'failed-lookup'));


test('plain Node entry qualification follows only captured corpus aliases',async t=>{
  const root=workspace(t,{'tooling/driver.mjs':"export {};\n"});
  const corpus=mkdtempSync(join(tmpdir(),'nts-corpus-alias-'));t.after(()=>removeOracleSnapshot(corpus));
  const file=join(corpus,'case.cjs');writeFileSync(file,'console.log(19);\n');
  const alias=join(root,'suite');symlinkSync(corpus,alias);
  const entry=join(root,'tooling/driver.mjs'),prepared=(await prepareOracle({entry,project:null,runtimeRoots:[alias],toolchain,directory:join(root,'prepared')}));
  const driver=oracleRuntimeFile(prepared,entry),stored=JSON.parse(readFileSync(prepared.manifest,'utf8'));
  assert.ok(stored.inputs[file]);assert.equal(stored.inputs[join(alias,'case.cjs')],undefined);
  assert.throws(()=>oracleExecution(prepared,driver,[join(root,'unobserved','case.cjs')]),/plain Node input has no captured original bytes/);
  for(const source of [file,join(alias,'case.cjs')]){
    const execution=oracleExecution(prepared,driver,[source]);
    const handoff=JSON.parse(readFileSync(join(dirname(execution.loaderState),'plain-node-inputs.json'),'utf8'));
    assert.deepEqual(handoff.inputs,[{path:file,sha256:stored.inputs[file]}]);
    const run=spawnSync(process.execPath,[...execution.args,driver],{cwd:root,encoding:'utf8',env:{...process.env,...execution.env}});
    assert.equal(run.status,0,run.stderr);assert.deepEqual(oracleLoaderReady(execution),{ready:true});
  }
});

test('the configured web host keeps its cross-project checking and emission context',async t=>{
  const root=workspace(t,{'src/main.ts':'console.log(19);\n'},{types:[]});
  const project=join(REPOSITORY,'runtime/web-platform/host/tsconfig.json'),entry=join(dirname(project),'node-runtime.ts');
  const original=JSON.parse(readFileSync(project,'utf8'));
  assert.equal(original.compilerOptions.rootDir,'..');
  const prepared=(await prepare(root,'src/main.ts',{preloads:[{entry,project}]}));
  const stored=JSON.parse(readFileSync(prepared.manifest,'utf8')),host=stored.groups.find((group:oracleOwner.EmitGroup)=>group.project===project);
  assert.ok(host);assert.equal(host.options.rootDir,join(REPOSITORY,'runtime/web-platform'));
  assert.ok(stored.groups.some((group:oracleOwner.EmitGroup)=>group.project===join(REPOSITORY,'runtime/ecmascript/tsconfig.json')));
  const run=execute(root,prepared);assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'19\n');
  assert.deepEqual(oracleLoaderReady(prepared),{ready:true});
});


test('the exact pinned bootstrap URL keeps its identity when imported again',async t=>{
  const root=workspace(t,{'src/main.ts':"export {};if(process.argv[2]){try{await import(process.argv[2]);console.log('ready');}catch{console.log('held');}}else console.log('ready');\n"});
  const prepared=(await prepare(root)),bootstrap=prepared.args[prepared.args.indexOf('--import')+1]!;
  assert.ok(bootstrap.startsWith('data:text/javascript,'));
  for(const mode of ['once','duplicate-preload','repeat-import','changed-url'] as const)await t.test(mode,()=>{
    const execution=oracleExecution(prepared),args=[...execution.args,...(mode==='duplicate-preload'?['--import',bootstrap]:[]),join(root,'src/main.ts'),...(mode==='repeat-import'?[bootstrap]:mode==='changed-url'?[bootstrap+'#unowned']:[])];
    const actual=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',env:{...process.env,...execution.env}}),health=oracleLoaderReady(execution);
    t.diagnostic(JSON.stringify({mode,status:actual.status,stdout:actual.stdout,stderr:actual.stderr,health}));
    assert.equal(actual.status,0,actual.stderr);
    if(mode==='changed-url'){
      assert.equal(actual.stdout,'held\n');assert.equal(health.ready,false);if(!health.ready)assert.match(health.why,/module URL has no captured owner|resolution context was not captured/);
    }else {assert.equal(actual.stdout,'ready\n');assert.deepEqual(health,{ready:true});}
  });
});

test('a child exiting during evaluation pairs its bootstrap and returns its status',async t=>{
  const root=workspace(t,{
    'tooling/driver.mjs':`import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const api=await import(new URL('./assets/oracle-loader.ts',pathToFileURL(process.env.NTS_ORACLE_EMIT_MANIFEST)));
const handle=api.oracleHarnessCapability();
const source=process.argv[2];
if(process.argv[3]==='child'){
  handle.commonJS(source);
  createRequire(source)(source);
}else{
  for(const code of [1,2,0]){
    const env=handle.child(source,source);
    const result=spawnSync(process.execPath,[...process.execArgv,process.argv[1],source,'child',String(code)],{encoding:'utf8',env:{...process.env,...env}});
    if(result.status!==code)throw Error(JSON.stringify({code,status:result.status,signal:result.signal,stderr:result.stderr,error:result.error?.message}));
    console.log(result.status);
  }
}
`,
    'case.cjs':"process.exit(Number(process.argv.at(-1)));\n",
  });
  const entry=join(root,'tooling/driver.mjs'),source=join(root,'case.cjs'),prepared=(await prepareOracle({entry,project:null,runtimeRoots:[root],toolchain,directory:join(root,'prepared')})),driver=oracleRuntimeFile(prepared,entry),execution=oracleExecution(prepared,driver,[source]);
  const actual=spawnSync(process.execPath,[...execution.args,driver,source],{cwd:root,encoding:'utf8',env:{...process.env,...execution.env}});
  assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'1\n2\n0\n');
  const rows=readFileSync(execution.loaderState,'utf8').trim().split('\n').map(line=>JSON.parse(line) as {status:string;execution?:string});
  const starts=rows.filter(row=>row.status==='child-start').map(row=>row.execution),ready=rows.filter(row=>row.status==='child-ready').map(row=>row.execution);
  assert.equal(starts.length,3);assert.equal(new Set(starts).size,3);assert.deepEqual(ready,starts);assert.deepEqual(oracleLoaderReady(execution),{ready:true});
});


test('child event grammar is identical across JavaScript and native readers',t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-child-grammar-'));t.after(()=>removeOracleSnapshot(root));
  const template={manifest:join(root,'manifest.json'),loaderState:'unused',snapshot:{version:1,manifestSha256:'0'.repeat(64),index:{path:'runtime-index/'+ '0'.repeat(64)+'.json',sha256:'0'.repeat(64)}},args:[],env:{}} as unknown as OraclePrepared;
  const matrix=JSON.parse(readFileSync(new URL('./oracle-child-events.json',import.meta.url),'utf8')) as {version:number;rows:{name:string;raw:string;ready:boolean}[]};
  assert.equal(matrix.version,1);
  for(const row of matrix.rows){
    const execution=oracleExecution(template);
    try{
      writeFileSync(execution.loaderState,row.raw);
      const health=oracleLoaderReady(execution);assert.equal(health.ready,row.ready,row.name);
      assert.equal(oracleLoaderReady(execution),health,'drained result must stay cached: '+row.name);
    }finally{closeOracleExecution(execution);}
  }
});
