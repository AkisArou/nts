import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {testEnvironmentHandoff,fixtureEnvironment} from "../gate/test-environment.ts";
// The Node oracle's emission and preparation (oracle-emit.ts): captured runtime
// assets, CommonJS and ESM goals at execution, oracle identity, child event
// streams and batches. Shared helpers are in oracle-emit-fixture.ts.
import * as oracleOwner from './oracle-emit.ts';
import assert from "node:assert/strict";
import {activeCommand} from "../gate/active-command.ts";
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {cpSync,existsSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {test} from "node:test";
import {pathToFileURL} from "node:url";
import {OracleWorker,TypeScriptDiagnosticError,ORACLE_LOADER,REPOSITORY,oracleIdentity,packageIdentity,verifyToolchain,oracleLoaderReady,type OraclePrepared,type OracleRuntimeRoute,type OracleRuntimeNode,type OracleRuntimeDescriptor} from "./oracle-emit.ts";
import {nativeOutput} from "../conformance/outcomes-project.ts";
import {prepareOracles} from "./oracle-batch.ts";
import {type HostObservation} from './oracle-filesystem.ts';
import {ORACLE_EXECUTION_FILES} from './oracle-runtime.ts';
import {toolchain,closeOracleExecution,oracleExecution,prepareOracle,workspace,execute,bare,prepare,snapshotRecords,changedSnapshot,ordinaryProject,boundedCompiler} from './oracle-emit-fixture.ts';

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
    const run=spawnSync(process.execPath,[...own.args,join(root,'src/main.mjs'),key],{encoding:'utf8',env:{...fixtureEnvironment(t),...own.env}});
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
  const reference=spawnSync(process.execPath,[plain],{cwd:root,env:fixtureEnvironment(t),input:'stdin payload',encoding:'utf8'});
  assert.equal(reference.status,0,reference.stderr);assert.equal(reference.stdout,'driver true\nprogram false stdin payload\n19\n');
  const run=(own:OraclePrepared)=>spawnSync(process.execPath,[...own.args,driver],{cwd:root,env:{...fixtureEnvironment(t),...own.env},input:'stdin payload',encoding:'utf8'});
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
    const reference=spawnSync(process.execPath,[output,name],{cwd:root,env:fixtureEnvironment(t),encoding:'utf8'});
    assert.equal(reference.status,0,reference.stderr);
    assert.equal(reference.stdout,`true true true\nfalse false false\nboolean ${name==='data.txt'}\n`);
    const own=oracleExecution(prepared);
    const run=spawnSync(process.execPath,[...own.args,join(root,'src/main.mjs'),name],{cwd:root,env:{...fixtureEnvironment(t),...own.env},encoding:'utf8'});
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
      const reference=spawnSync(process.execPath,['-e','console.log(require(process.argv[1]).value)',output],{env:fixtureEnvironment(t),cwd:root,encoding:'utf8'});
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
      const oracle=execute(root,prepared),bare=spawnSync(process.execPath,['--no-warnings',join(dirname(prepared.manifest),stored.sources[join(root,'src/main.ts')])],{encoding:'utf8',env:fixtureEnvironment(t)});
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
    const old=spawnSync(process.execPath,["--experimental-transform-types","--no-warnings",entry],{env:fixtureEnvironment(t),encoding:"utf8"});
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
  const env={...fixtureEnvironment(t)};delete env.NTS_ORACLE_EMIT_MANIFEST;
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
  copyModuleClosure(["tooling/differential/oracle-emit.ts",...ORACLE_EXECUTION_FILES.map(name=>"tooling/differential/"+name)],assets);
  const entry=join(assets,"tooling/differential/oracle-emit.ts");
  const prepared=spawnSync(process.execPath,[entry,"--prepare",join(root,"src/main.ts"),join(root,"emitted"),join(root,"tsconfig.json")],{
    encoding:"utf8",cwd:root,env:{...fixtureEnvironment(t),NTS_ORACLE_TYPESCRIPT:toolchain},
  });
  assert.equal(prepared.status,0,prepared.stderr);
  const configured:OraclePrepared=JSON.parse(prepared.stdout);
  assert.ok(configured.args.some(arg=>arg.startsWith("data:text/javascript,")&&decodeURIComponent(arg).includes("assets/oracle-loader.mjs")));
  for(const name of [...ORACLE_EXECUTION_FILES,"oracle-emit.ts","oracle-loader.ts","oracle-filesystem.ts","oracle-runtime.ts","oracle-resolution.ts","oracle-assets.ts","oracle-toolchain.json"])
    assert.deepEqual(readFileSync(join(dirname(configured.manifest),"assets",name)),readFileSync(join(assets,"tooling/differential",name)));
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
  const env={...fixtureEnvironment(t)};delete env.NTS_ORACLE_TYPESCRIPT;
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
    directory:join(roots[0]!,'attribution'),toolchain,workers:1,env:fixtureEnvironment(t),memoryBytes:2*2**30,
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
    const run=await activeCommand('prlimit',['--core=0','--cpu=0:0',compiler,...args],{cwd,env:fixtureEnvironment(t),cpuBudgetSeconds:120,idleMs:120_000});
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
for(const name of children){const result=spawnSync(process.execPath,[...process.execArgv,new URL('../'+name+'.mjs',import.meta.url).pathname],{encoding:'utf8',env:${testEnvironmentHandoff(["NTS_ORACLE_EMIT_MANIFEST","NTS_ORACLE_EMIT_STATUS","NTS_ORACLE_SNAPSHOT"])}});if(result.status!==0)throw Error(result.stderr);}
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
    const result=spawnSync(process.execPath,[...own.args,join(root,'src/main.ts'),...suffix],{encoding:'utf8',env:{...fixtureEnvironment(t),...own.env}});
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
