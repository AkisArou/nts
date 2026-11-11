import {testEnvironmentHandoff,fixtureEnvironment} from "../gate/test-environment.ts";
// The Node oracle's emission and preparation (oracle-emit.ts): prepared
// resolution invalidation, package mains, authored and governed CommonJS, the
// runtime emit target and its syntax controls. Shared helpers are in
// oracle-emit-fixture.ts.
import type {Diagnostic} from 'typescript/sync';
import * as oracleOwner from './oracle-emit.ts';
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {renameSync,appendFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join} from "node:path";
import {test} from "node:test";
import {pathToFileURL} from "node:url";
import {OracleWorker,TypeScriptDiagnosticError,REPOSITORY,removeOracleSnapshot,verifyToolchain,oracleLoaderReady,oracleRuntimeFile,type OraclePrepared,type OracleRuntimeRoute} from "./oracle-emit.ts";
import {toolchain,closeOracleExecution,oracleExecution,prepareOracle,workspace,execute,prepare,witnessOwner,ordinaryProject,authoredExecution,ownerObservationInvalidation} from './oracle-emit-fixture.ts';

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
  const expected=spawnSync(process.execPath,[entry],{env:fixtureEnvironment(t),cwd:app,encoding:'utf8'});
  assert.equal(expected.status,0,expected.stderr);assert.equal(expected.stdout,'19\n');
  for(const captured of [true,false]){
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:captured?[app,outside]:[app],toolchain,directory:join(root,captured?'control':'subject')}));
    const execution=oracleExecution(prepared),actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:app,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}});
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
  const entry=join(app,'main.cjs'),plain=spawnSync(process.execPath,[entry],{env:fixtureEnvironment(t),cwd:app,encoding:'utf8'});
  assert.equal(plain.status,0,plain.stderr);assert.equal(plain.stdout,'19\n');
  for(const captureOutside of [true,false]){
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:captureOutside?[app,outside]:[app],toolchain,directory:join(root,captureOutside?'control':'subject')}));
    const execution=oracleExecution(prepared),actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:app,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}}),health=oracleLoaderReady(execution);
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
    const expected=spawnSync(process.execPath,[entry],{env:fixtureEnvironment(t),encoding:'utf8'});assert.equal(expected.status,0,expected.stderr);assert.equal(expected.stdout,deepPackage?'23\n19\n23\n':'19\n19\n23\n');
    for(const captureOutside of [true,false]){
      const prepared=(await prepareOracle({entry,project:null,runtimeRoots:captureOutside?[app,outside]:[app],toolchain,directory:join(own,captureOutside?'control':'subject')})),execution=oracleExecution(prepared);
      const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}}),health=oracleLoaderReady(execution);
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
  const plain=spawnSync(process.execPath,[entry],{env:fixtureEnvironment(t),cwd:app,encoding:'utf8'});assert.equal(plain.status,0,plain.stderr);assert.equal(plain.stdout,'19\n');
  for(const captureOutside of [true,false]){
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:captureOutside?[app,outside]:[app],toolchain,directory:join(root,captureOutside?'control':'subject')}));
    const execution=oracleExecution(prepared),actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:app,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}}),health=oracleLoaderReady(execution);
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
  const expected=spawnSync(process.execPath,[entry],{env:fixtureEnvironment(t),cwd:app,encoding:'utf8'});
  assert.equal(expected.status,0,expected.stderr);assert.equal(expected.stdout,'MODULE_NOT_FOUND\n');
  for(const captured of [true,false])await t.test(captured?'captured missing target':'uncaptured missing target',async ()=>{
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:captured?[app,outside]:[app],toolchain,directory:join(root,captured?'control':'subject')}));
    const run=()=>{const execution=oracleExecution(prepared);return {execution,actual:spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:app,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}})};};
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
      const plain=spawnSync(process.execPath,['--input-type=module','--eval',code],{env:fixtureEnvironment(t),cwd:root,encoding:'utf8'});
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
    const expected=spawnSync(process.execPath,[entry],{env:fixtureEnvironment(t),cwd:app,encoding:'utf8'});
    assert.equal(expected.status,0,expected.stderr);
    assert.equal(expected.stdout,missing?'MODULE_NOT_FOUND\n':'19\n');
    t.diagnostic(JSON.stringify({missing,plainNode:{status:expected.status,stdout:expected.stdout,stderr:expected.stderr}}));
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[app],toolchain,directory:join(root,missing?'subject':'control')}));
    const execution=oracleExecution(prepared),captured=oracleRuntimeFile(prepared,entry);
    const actual=spawnSync(process.execPath,[...execution.args,captured],{cwd:app,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}});
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
  const expected=spawnSync(process.execPath,['--import',pathToFileURL(witness).href,entry],{env:fixtureEnvironment(t),encoding:'utf8'});
  assert.equal(expected.status,0,expected.stderr);assert.equal(expected.stdout,'true MODULE_NOT_FOUND\n');
  const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[app],preloads:[witnessOwner(root,witness)],toolchain,directory:join(root,'scratch')})),execution=oracleExecution(prepared);
  // The observation hook precedes the oracle, so it sees Node's exception
  // before the oracle receives it, rather than observing a later wrapper.
  const actual=spawnSync(process.execPath,['--import',pathToFileURL(witness).href,...execution.args,oracleRuntimeFile(prepared,entry)],{encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}});
  assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,expected.stdout);assert.deepEqual(oracleLoaderReady(execution),{ready:true});
});

test('same-worker package metadata follows fresh captured bytes at the same origin',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-package-mutation-'));let worker:OracleWorker|undefined;t.after(()=>{worker?.close();removeOracleSnapshot(root);});
  const app=join(root,'app'),pkg=join(app,'pkg'),outside=join(root,'outside');mkdirSync(pkg,{recursive:true});mkdirSync(outside);
  const entry=join(app,'main.cjs'),config=join(pkg,'package.json');
  writeFileSync(entry,"try{require(require('node:path').resolve(__dirname,'./pkg'));}catch(error){console.log(error.code);}\n");
  worker=new OracleWorker(join(root,'worker'),toolchain);
  const run=(prepared:OraclePrepared)=>{
    const own=oracleExecution(prepared),actual=spawnSync(process.execPath,[...own.args,oracleRuntimeFile(prepared,entry)],{encoding:'utf8',env:{...fixtureEnvironment(t),...own.env}});
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
    const expected=spawnSync(process.execPath,['--no-warnings',entry],{env:fixtureEnvironment(t),encoding:'utf8'});assert.equal(expected.status,0,expected.stderr);assert.equal(expected.stdout,item.stdout);
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[app],toolchain,directory:join(root,'prepared')})),own=oracleExecution(prepared);
    const index=JSON.parse(readFileSync(join(dirname(prepared.manifest),'source-index.json'),'utf8')),fact=index.trees[0].coverage.packages.find((fact:{directory:string})=>fact.directory===pkg);
    assert.equal(fact.main,item.main);assert.equal(fact.valid,at!==cases.length-1);
    const actual=spawnSync(process.execPath,[...own.args,'--no-warnings',oracleRuntimeFile(prepared,entry)],{encoding:'utf8',env:{...fixtureEnvironment(t),...own.env}});
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
    const expected=spawnSync(process.execPath,[entry],{env:fixtureEnvironment(t),cwd:app,encoding:'utf8'});
    assert.equal(expected.status,0,expected.stderr);
    assert.equal(expected.stdout,directory?'[["package.json",true]]\n':'[]\n');
    t.diagnostic(JSON.stringify({directory,plainNode:{status:expected.status,stdout:expected.stdout,stderr:expected.stderr}}));
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[app],toolchain,directory:join(root,directory?'subject':'control')}));
    const execution=oracleExecution(prepared),captured=oracleRuntimeFile(prepared,entry);
    const actual=spawnSync(process.execPath,[...execution.args,captured],{cwd:app,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}});
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
    const expected=spawnSync(process.execPath,[entry],{env:fixtureEnvironment(t),cwd:app,encoding:'utf8'});
    assert.equal(expected.status,0,expected.stderr);
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[app],toolchain,directory:join(root,dangling?'subject':'control')}));
    const execution=oracleExecution(prepared),captured=oracleRuntimeFile(prepared,entry);
    const actual=spawnSync(process.execPath,[...execution.args,captured],{cwd:app,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}});
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
  const expected=spawnSync(process.execPath,[entry],{env:fixtureEnvironment(t),encoding:'utf8'});assert.equal(expected.status,0,expected.stderr);
  const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[app],toolchain,directory:join(root,'scratch')}));
  const run=()=>{const own=oracleExecution(prepared);return {own,result:spawnSync(process.execPath,[...own.args,oracleRuntimeFile(prepared,entry)],{encoding:'utf8',env:{...fixtureEnvironment(t),...own.env}})};};
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

test('authored CommonJS keeps Node lookup paths outside capture',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-plain-cjs-'));t.after(()=>removeOracleSnapshot(root));
  const app=join(root,'app'),outside=join(root,'outside');mkdirSync(join(app,'pkg'),{recursive:true});mkdirSync(outside);
  const entry=join(app,'main.cjs');
  writeFileSync(entry,"console.log(require('./pkg'));\n");
  writeFileSync(join(app,'pkg/package.json'),JSON.stringify({main:'../../outside/value.cjs'}));
  writeFileSync(join(app,'pkg/index.js'),'module.exports=23;\n');writeFileSync(join(outside,'value.cjs'),'module.exports=19;\n');
  const plain=spawnSync(process.execPath,[entry],{env:fixtureEnvironment(t),cwd:app,encoding:'utf8'});assert.equal(plain.status,0,plain.stderr);assert.equal(plain.stdout,'19\n');
  const executions:OraclePrepared[]=[];
  for(const captureOutside of [true,false]){
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:captureOutside?[app,outside]:[app],toolchain,directory:join(root,captureOutside?'control':'subject')})),execution=authoredExecution(prepared,entry);
    const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:app,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}});
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
    const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}}),health=oracleLoaderReady(execution);
    assert.equal(actual.status,0,actual.stderr);
    if(!relative){assert.equal(actual.stdout,'19\n');assert.deepEqual(health,{ready:true});}
    else {assert.equal(health.ready,false,'a direct emitted .cjs URL cannot become authored JavaScript');if(!health.ready)assert.match(health.why,/unproved CommonJS route/);}
  }
});

test('authored CommonJS transitions keep TypeScript providers governed',async t=>{
  for(const preparedProvider of [true,false]){
    const root=workspace(t,{'src/main.cjs':"try{console.log(require('./provider.ts').value);}catch(error){console.log(error.code);}\n",'src/provider.ts':'export const value:number=19;\n'}),entry=join(root,'src/main.cjs');
    const prepared=(await prepareOracle({entry,project:null,preloads:preparedProvider?[{entry:join(root,'src/provider.ts'),project:join(root,'tsconfig.json')}]:[],runtimeRoots:[join(root,'src')],toolchain,directory:join(root,preparedProvider?'control':'subject')})),execution=authoredExecution(prepared,entry);
    const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}});
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
  const plain=spawnSync(process.execPath,[entry,'../outside.mjs'],{env:fixtureEnvironment(t),cwd:app,encoding:'utf8'});assert.equal(plain.status,0,plain.stderr);assert.equal(plain.stdout,'19\n');
  const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[app],toolchain,directory:join(root,'prepared')})),execution=authoredExecution(prepared,entry);
  const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry),'../outside.mjs'],{cwd:app,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}});
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
    const actual=spawnSync(process.execPath,[...execution.args,authored?oracleRuntimeFile(prepared,entry):entry],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}});
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
    const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}});
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
    const plain=spawnSync(process.execPath,[entry],{env:fixtureEnvironment(t),cwd:app,encoding:'utf8'});assert.equal(plain.status,0,plain.stderr);assert.equal(plain.stdout,changed?(synthetic?'19 23\n':'23 19\n'):'19 19\n');
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[app],toolchain,directory:join(root,'prepared')})),execution=authoredExecution(prepared,entry);
    const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:app,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}});
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
    const execution=authoredExecution(prepared,entry),actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry),spoof?'spoof':'control'],{cwd:app,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}});
    t.diagnostic(JSON.stringify({spoof,status:actual.status,stdout:actual.stdout,stderr:actual.stderr,health:oracleLoaderReady(execution)}));
    assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'0\n','a governed provider cannot manufacture a plain CommonJS parent');assert.equal(oracleLoaderReady(execution).ready,false);
  }
});

test('a query or fragment cannot create another bootstrap authority',async t=>{
  for(const suffix of ['?copy','#copy']){
    const root=workspace(t,{'src/main.cjs':`(async()=>{const {pathToFileURL}=require('node:url');try{await import(new URL('./assets/oracle-loader.ts${suffix}',pathToFileURL(process.env.NTS_ORACLE_EMIT_MANIFEST)));}catch{}console.log('done');})();\n`}),entry=join(root,'src/main.cjs');
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[join(root,'src')],toolchain,directory:join(root,'prepared')})),execution=authoredExecution(prepared,entry);
    const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}});
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
    const mode=changed?'changed':'default',reference=spawnSync(process.execPath,[join(root,'src/reference.cjs'),mode],{env:fixtureEnvironment(t),cwd:root,encoding:'utf8'});
    assert.equal(reference.status,0,reference.stderr);assert.equal(reference.stdout,changed?'19\n':'23\n');
    const execution=oracleExecution(prepared),actual=spawnSync(process.execPath,[...execution.args,join(root,'src/main.cts'),mode],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}}),health=oracleLoaderReady(execution);
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
  const reference=spawnSync(process.execPath,[entry],{env:fixtureEnvironment(t),cwd:app,encoding:'utf8'});assert.equal(reference.status,0,reference.stderr);assert.equal(reference.stdout,'19\n');
  for(const captureOutside of [true,false]){
    const prepared=(await prepareOracle({entry,project:null,runtimeRoots:captureOutside?[app,outside]:[app],toolchain,directory:join(root,captureOutside?'control':'subject')})),execution=oracleExecution(prepared);
    const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:app,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}}),health=oracleLoaderReady(execution);
    t.diagnostic(JSON.stringify({captureOutside,reference:{status:reference.status,stdout:reference.stdout,stderr:reference.stderr},actual:{status:actual.status,stdout:actual.stdout,stderr:actual.stderr},health}));
    if(captureOutside){assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,reference.stdout);assert.deepEqual(health,{ready:true});}
    else assert.equal(health.ready,false,'a successful owned fallback cannot turn an unobserved ESM main candidate into absence');
  }
});


test('program code without an authenticated driver cannot obtain a wrapper capability',async t=>{
  const root=workspace(t,{'src/main.cjs':"(async()=>{const assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');const api=await import(new URL('./assets/oracle-loader.ts',pathToFileURL(process.env.NTS_ORACLE_EMIT_MANIFEST)));assert.equal(typeof api.oracleHarnessCapability,'function');assert.throws(()=>api.oracleHarnessCapability(),/unavailable or already consumed/);console.log('denied');})();\n"}),entry=join(root,'src/main.cjs');
  const prepared=(await prepareOracle({entry,project:null,runtimeRoots:[join(root,'src')],toolchain,directory:join(root,'prepared')})),execution=authoredExecution(prepared,entry);
  const actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry)],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}});
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
      if(mode===2){const run=spawnSync(join(root,'missing-node'),[], {env:fixtureEnvironment(t)});assert.ok(run.error);continue;}
      const raw=mode===0?JSON.stringify({version:1,status:'ready'})+'\n':'{';
      const run=spawnSync(process.execPath,['-e','require("node:fs").writeFileSync(process.argv[1],process.argv[2])',execution.loaderState,raw], {env:fixtureEnvironment(t)});
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
    const run=spawnSync(process.execPath,['--import',pathToFileURL(witness).href,...execution.args,join(root,'src/main.ts')],{encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}}),health=oracleLoaderReady(execution);
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
      const args=changed?['change']:[],actual=spawnSync(process.execPath,[...execution.args,oracleRuntimeFile(prepared,entry),...args],{cwd:app,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}}),health=oracleLoaderReady(execution);
      const reference=spawnSync(process.execPath,[entry,...args],{env:fixtureEnvironment(t),cwd:app,encoding:'utf8'});
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
    const run=spawnSync(process.execPath,[...execution.args,driver],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}});
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
    const actual=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}}),health=oracleLoaderReady(execution);
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
    const result=spawnSync(process.execPath,[...process.execArgv,process.argv[1],source,'child',String(code)],{encoding:'utf8',env:{...${testEnvironmentHandoff()},...env}});
    if(result.status!==code)throw Error(JSON.stringify({code,status:result.status,signal:result.signal,stderr:result.stderr,error:result.error?.message}));
    console.log(result.status);
  }
}
`,
    'case.cjs':"process.exit(Number(process.argv.at(-1)));\n",
  });
  const entry=join(root,'tooling/driver.mjs'),source=join(root,'case.cjs'),prepared=(await prepareOracle({entry,project:null,runtimeRoots:[root],toolchain,directory:join(root,'prepared')})),driver=oracleRuntimeFile(prepared,entry),execution=oracleExecution(prepared,driver,[source]);
  const actual=spawnSync(process.execPath,[...execution.args,driver,source],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}});
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
