import {ORACLE_EXECUTION_FILES} from '../differential/oracle-runtime.ts';
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {fixtureEnvironment} from "../gate/test-environment.ts";
import * as oracleOwner from '../differential/oracle-emit.ts';
import assert from 'node:assert/strict';
import {chmodSync,readdirSync,cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {spawnSync,type SpawnSyncOptionsWithStringEncoding,type SpawnSyncReturns} from 'node:child_process';
import {OracleWorker,REPOSITORY,prepareOracle,oracleExecution as newOracleExecution,oracleLoaderReady,oracleRuntimeFile,removeOracleSnapshot,finishOracleSnapshot} from '../differential/oracle-emit.ts';
import {oracleToolchainLocation} from '../gate/canonical-environment.ts';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {test,afterEach,type TestContext} from 'node:test';
import {readStepInstrument} from '../gate/step-result.ts';
import {instrumentPolicy} from '../gate/step-result.ts';
import {nodeModuleFiles,nodeGlobalGroups,nodeGlobalEntry,nodeSiblingModules,nodePreloadPlan} from './node-preloads.ts';

import {setupOracleTestEnvironment} from '../differential/oracle-test-fixture.ts';
import {newTestScratch} from '../gate/test-scratch.ts';
import {captureRunTemporary,finishRunTemporary,pruneRunTemporaries} from '../gate/run-temporary.ts';

await setupOracleTestEnvironment();

// Forward the runner's real stderr while retaining it for assertions. Case
// admission and preparation progress must reach the outer tooling collector;
// buffering a whole nested run made active work look like a silent test file.
function runNodeCase(t:TestContext,command:string,args:string[],options:SpawnSyncOptionsWithStringEncoding):SpawnSyncReturns<string>{
  const root=newTestScratch('node-preload-progress'),stderr=join(root,'stderr');writeFileSync(stderr,'');
  process.stderr.write(`node-preloads case starts: ${t.name}\n`);
  try{
    const relay='preload_case_stderr=$1; shift; exec 3> >(tee "$preload_case_stderr" >&2); preload_case_tee=$!; "$@" 2>&3 3>&-; preload_case_status=$?; exec 3>&-; wait "$preload_case_tee" || exit 125; exit "$preload_case_status"';
    const result=spawnSync('bash',['-c',relay,'_',stderr,command,...args],{...options,stdio:['ignore','pipe','inherit']});
    process.stderr.write(`node-preloads case finishes: ${t.name}: ${result.status??result.signal}\n`);
    return {...result,stderr:readFileSync(stderr,'utf8')};
  }finally{rmSync(root,{recursive:true,force:true});}
}

const executions=new Set<ReturnType<typeof newOracleExecution>>();
function oracleExecution(...args:Parameters<typeof newOracleExecution>){const execution=newOracleExecution(...args);executions.add(execution);return execution;}
afterEach(()=>{const close=Reflect.get(oracleOwner,'closeOracleExecution');if(typeof close==='function')for(const execution of executions)close(execution);executions.clear();});

function fixture(t:TestContext,{runner=false}:{runner?:boolean}={}){
  const root=mkdtempSync(join(tmpdir(),'nts-node-preloads-'));t.after(()=>removeOracleSnapshot(root));
  const write=(file:string,body:string)=>{file=join(root,file);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,body);};
  if(runner){
    copyModuleClosure(['tooling/conformance/run.mjs'],root,{owningProject:true});
    copyModuleClosure(ORACLE_EXECUTION_FILES.map(name=>'tooling/differential/'+name),root);
  }else write('tooling/conformance/run-one.mjs',"export {};\n");
  for(const name of ['subject','sibling']){write(`runtime/node/${name}/src/main.ts`,'export const value:number=1;\n');write(`runtime/node/${name}/tsconfig.json`,'{"files":["src/main.ts"]}');}
  return {root,write};
}
test('runtime preload declarations do not load the parent planner or filesystem',t=>{
  const {root,write}=fixture(t);write('runtime/node/subject/uses','sibling\n');write('runtime/node/subject/globals','abort\n');
  const runtime=new URL('./node-preload-runtime.ts',import.meta.url).href,planner=new URL('./node-preloads.ts',import.meta.url).href;
  const source=`import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){if(specifier==='acorn'||specifier.endsWith('/oracle-filesystem.ts'))throw Error('parent-only dependency: '+specifier);return next(specifier,context);}});
await assert.rejects(import(${JSON.stringify(planner)}),/parent-only dependency/);
const runtime=await import(${JSON.stringify(runtime)}),root=${JSON.stringify(root)},subject=runtime.nodeModuleFiles(root,'subject');
assert.equal(subject.entry,root+'/runtime/node/subject/src/main.ts');assert.deepEqual(runtime.nodeGlobalGroups(subject.dir),['abort']);
assert.equal(runtime.nodeGlobalEntry(subject.dir,'abort'),root+'/runtime/web-platform/src/core/abort.ts');
assert.equal(runtime.nodeSiblingModules(root,subject.dir)[0].name,'sibling');console.log('runtime-only declarations ready');`;
  const result=runNodeCase(t,process.execPath,['--input-type=module','-e',source],{encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.equal(result.stdout,'runtime-only declarations ready\n');
});
test('runtime and finite preparation share exact globals, subpaths and sibling order',t=>{
  const {root,write}=fixture(t),subject=nodeModuleFiles(root,'subject');
  write('runtime/node/subject/uses','# comment\nsibling/iter\nsibling\n');
  write('runtime/node/subject/globals','abort\nencoding\n');
  for(const name of ['abort','encoding'])write(`runtime/web-platform/src/core/${name}.ts`,'export {};');
  assert.deepEqual(nodeGlobalGroups(subject.dir),['abort','encoding']);
  assert.equal(nodeGlobalEntry(subject.dir,'abort'),join(root,'runtime/web-platform/src/core/abort.ts'));
  const siblings=nodeSiblingModules(root,subject.dir);assert.deepEqual(siblings.map(row=>row.requestedSubpath),['sibling/iter',null]);
  const plan=nodePreloadPlan(root,'subject',false);
  assert.deepEqual(plan.declarations.descriptor.siblings,siblings);
  assert.deepEqual(plan.preloads.map(row=>row.entry),[subject.entry,...['abort','encoding'].map(name=>nodeGlobalEntry(subject.dir,name)),siblings[0]!.entry]);
  assert.ok(plan.declarations.files[join(subject.dir,'uses')]);
});
test('static shim imports add their TypeScript roots transitively and capture every JS decision',t=>{
  const {root,write}=fixture(t);
  write('runtime/node/subject/bindings.node.mjs',"import '../shared/first.mjs';\n");
  write('runtime/node/shared/first.mjs',"export * from './second.mjs';\n");
  write('runtime/node/shared/second.mjs',"import './host.ts';\n");write('runtime/node/shared/host.ts','export {};');
  const plan=nodePreloadPlan(root,'subject',false),host=join(root,'runtime/node/shared/host.ts');
  assert.ok(plan.preloads.some(row=>row.entry===host));
  for(const path of ['subject/bindings.node.mjs','shared/first.mjs','shared/second.mjs'])assert.ok(plan.declarations.files[join(root,'runtime/node',path)]);
  assert.ok(plan.declarations.absent.includes(join(root,'runtime/node/subject/shape.mjs')));
});
test('changed declared data changes the plan; missing required roots never produce a fallback',t=>{
  const {root,write}=fixture(t),before=nodePreloadPlan(root,'subject',false);
  write('runtime/node/subject/uses','sibling\n');const after=nodePreloadPlan(root,'subject',false);
  assert.notDeepEqual(after.declarations,before.declarations);
  write('runtime/node/subject/uses','missing\n');assert.throws(()=>nodePreloadPlan(root,'subject',false),/missing.*src.*main.ts/);
});
test('compiled preparation omits subject source and binding shim while retaining declared dependencies',t=>{
  const {root,write}=fixture(t);write('runtime/node/subject/uses','sibling\n');
  write('runtime/node/subject/bindings.node.mjs',"import './unavailable.ts';");
  const plan=nodePreloadPlan(root,'subject',true);
  assert.deepEqual(plan.preloads.map(row=>row.entry),[join(root,'runtime/node/sibling/src/main.ts')]);
  assert.throws(()=>nodePreloadPlan(root,'subject',false),/unavailable.ts/);
});
test('unknown global groups retain the runtime error and are rejected by preparation too',t=>{
  const {root,write}=fixture(t);write('runtime/node/subject/globals','unknown\n');
  const module=nodeModuleFiles(root,'subject');assert.deepEqual(nodeGlobalGroups(module.dir),['unknown']);
  assert.throws(()=>nodeGlobalEntry(module.dir,'unknown'),/unknown canonical global group.*unknown/);
  assert.throws(()=>nodePreloadPlan(root,'subject',false),/unknown canonical global group.*unknown/);
});


test('the actual runner drains nested loader events and keeps the following file independent',t=>{
  const {root,write}=fixture(t,{runner:true});
  // A closed failure is an evictable cache. This fixture owns its registry;
  // concurrent real runs must never decide whether its retained image exists.
  const home=join(root,'home'),neighbor=join(root,'neighbor-home');
  mkdirSync(home);mkdirSync(neighbor);
  const env={...fixtureEnvironment(t),HOME:home};
  // These are the production consumers, not a fake launcher or status reader.

  for(const file of ['package.json','tsconfig.fixtures.json','tsconfig.base.json'])cpSync(join(REPOSITORY,file),join(root,file));
  symlinkSync(join(REPOSITORY,'node_modules'),join(root,'node_modules'));
  mkdirSync(join(root,'third_party/node/test/parallel'),{recursive:true});
  mkdirSync(join(root,'third_party/node/test/fixtures'),{recursive:true});
  cpSync(join(REPOSITORY,'third_party/node/test/fixtures/utf8_test_text.txt'),join(root,'third_party/node/test/fixtures/utf8_test_text.txt'));
  write('runtime/node/subject/src/main.ts','enum E {Answer=42} export function answer():number{return E.Answer;}\n');
  write('runtime/node/subject/tsconfig.json',JSON.stringify({extends:join(root,'tsconfig.fixtures.json'),files:['src/main.ts']}));
  write('runtime/node/subject/test/00-child.js',`
const assert=require('node:assert/strict');assert.equal(require('subject').answer(),42);
if(process.argv.includes('nested')){
  const fs=require('node:fs');
  const state=process.env.NTS_ORACLE_EMIT_STATUS;
  assert.ok(fs.readFileSync(state,'utf8').split('\\n').filter(line=>line.includes('"ready"')).length>=2);
  fs.appendFileSync(state,JSON.stringify({version:1,status:'instrument',reason:'nested-child control'})+'\\n');
}else{
  const result=require('node:child_process').spawnSync(process.execPath,[__filename,'nested'],{encoding:'utf8',env:{}});
  assert.equal(result.status,0,result.stderr);
}
`);
  write('runtime/node/subject/test/01-clean.js',"require('node:assert/strict').equal(require('subject').answer(),42);\n");
  write('runtime/node/subject/test/02-capability.js',"(async()=>{const url=require('node:url').pathToFileURL(require('node:path').join(__dirname,'scope-provider.mjs'));const value=await import(url.href);require('node:assert/strict').equal(value.denied,true);})();\n");
  write('runtime/node/subject/test/scope-provider.mjs',"import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';const api=await import(new URL('./assets/oracle-loader.ts',pathToFileURL(process.env.NTS_ORACLE_EMIT_MANIFEST)));assert.throws(()=>api.oracleHarnessCapability(),/unavailable or already consumed/);export const denied=true;\n");
  const run=runNodeCase(t,process.execPath,[join(root,'tooling/conformance/run.mjs'),'--module','subject','--json'],{cwd:root,encoding:'utf8',env:{...env,NTS_CONFORMANCE_TIMEOUT_MS:'60000'}});
  assert.equal(run.status,124,run.stderr+'\n'+run.stdout);
  const record=JSON.parse(run.stdout);assert.deepEqual(record.rows.map(row=>[row.name,row.kind]),[['local/00-child.js','not-measured'],['local/01-clean.js','pass'],['local/02-capability.js','not-measured']],JSON.stringify(record,null,2));
  assert.match(record.rows[0].why,/nested-child control/);assert.match(record.rows[2].why,/harness capability is unavailable or already consumed/);assert.equal(record.tally['not-measured'],2);assert.equal(record.tally.pass,1);
  assert.ok(record.preparation.identity.declarationsSha256);
  assert.equal(record.preparation.cleanup.state,'retained after failure or explicit keep');
  assert.ok(existsSync(record.preparation.cleanup.path));
  const registry=join(home,'.cache/nts-gate/closed-temporaries');
  const closed=existsSync(registry)?readdirSync(registry).map(name=>JSON.parse(readFileSync(join(registry,name),'utf8')).owned.path):[];
  assert.deepEqual(closed,record.preparation.temporary.enclosing?[]:[record.preparation.temporary.path],
    'a nested job shares its enclosing run retention; an independent job belongs to the fixture HOME');
  const other=captureRunTemporary(join(neighbor,'.cache/run'));writeFileSync(join(other.path,'generated'),'neighbor');
  finishRunTemporary(other,neighbor,false,{minimumFreeBytes:0,maxBytes:Number.MAX_SAFE_INTEGER,write:()=>{}});
  assert.deepEqual(pruneRunTemporaries(neighbor,{minimumFreeBytes:0,maxBytes:0,write:()=>{}}).removed,[other.path]);
  assert.ok(existsSync(record.preparation.cleanup.path),'an independent registry prune cannot evict this preparation');
  assert.match(run.stderr,/kept Node preparation:/);
  assert.match(run.stderr,/"state":"retained after red"/);
  const clean=runNodeCase(t,process.execPath,[join(root,'tooling/conformance/run.mjs'),'--module','subject','--only','01-clean.js','--json'],{cwd:root,encoding:'utf8',env});
  assert.equal(clean.status,0,clean.stderr+'\n'+clean.stdout);
  const completed=JSON.parse(clean.stdout);assert.equal(completed.tally.pass,1);
  assert.ok(completed.oracleScopes.some(row=>row.test==='local/01-clean.js'&&row.category==='plain node (outside capture)'&&row.attested===false&&row.path===join(root,'runtime/node/subject/test/01-clean.js')));
  assert.equal(completed.preparation.cleanup.state,'removed after success');assert.equal(existsSync(completed.preparation.cleanup.path),false);
  assert.equal(existsSync(completed.preparation.temporary.path),false);assert.match(clean.stderr,/"state":"removed after green"/);
  const cost=completed.preparation.applicationCapture;assert.ok(cost.wallMs>0);assert.ok(cost.cpuUsec>0);assert.ok(cost.bytes>0);assert.ok(cost.allocatedBytes>0);assert.ok(cost.regularFiles>0);
  assert.equal(clean.stderr.split('\n').filter(line=>line.startsWith('oracle application capture: ')).length,1,'one job owns one application capture cost');
  assert.ok(cost.wallMs>=cost.treeCopy.wallMs);assert.ok(cost.publication.scope.includes('both host replays'));
});

test('a newly nearer project config invalidates the prepared discovery decision',async t=>{
  const {root,write}=fixture(t);
  write('package.json','{"type":"module"}\n');
  write('tooling/conformance/run-one.mjs',"import '../../runtime/node/subject/src/main.ts';\n");
  write('runtime/node/subject/src/main.ts',"class Base{} Object.defineProperty(Base.prototype,'value',{set(v:number){console.log('setter',v)},configurable:true}); class Derived extends Base{value=7} new Derived();console.log('done');\n");
  write('runtime/node/subject/tsconfig.json',JSON.stringify({
    extends:join(REPOSITORY,'tsconfig.fixtures.json'),
    compilerOptions:{useDefineForClassFields:true},files:['src/main.ts'],
  }));
  const plan=nodePreloadPlan(root,'subject',false);
  const prepared=(await prepareOracle({...plan,project:null,directory:join(root,'first'),toolchain:oracleToolchainLocation()}));
  const run=(prepared:Awaited<ReturnType<typeof prepareOracle>>)=>{
    const execution=oracleExecution(prepared,plan.entry);
    const actual=runNodeCase(t,process.execPath,[...execution.args,plan.entry],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),...execution.env}});
    return {actual,health:oracleLoaderReady(execution),snapshot:finishOracleSnapshot(prepared)};
  };
  const unchanged=run(prepared);
  assert.equal(unchanged.actual.status,0,unchanged.actual.stderr);
  assert.equal(unchanged.actual.stdout,'done\n');
  assert.deepEqual(unchanged.health,{ready:true});assert.deepEqual(unchanged.snapshot,{ready:true});
  const waiting=await prepareOracle({...plan,project:null,directory:join(root,'waiting'),toolchain:oracleToolchainLocation()});
  // This one new file changes the chosen project without changing old inputs.
  write('runtime/node/subject/src/tsconfig.json',JSON.stringify({
    extends:'../tsconfig.json',compilerOptions:{useDefineForClassFields:false},files:['main.ts'],
  }));
  const stale=run(waiting);
  assert.equal(stale.snapshot.ready,false,'appeared nearer config must hold the old prepared oracle');
  if(!stale.snapshot.ready)assert.match(stale.snapshot.why,/snapshot finalization held/);
  const current=nodePreloadPlan(root,'subject',false);
  const fresh=(await prepareOracle({...current,project:null,directory:join(root,'fresh'),toolchain:oracleToolchainLocation()}));
  const selected=run(fresh);
  assert.equal(selected.actual.status,0,selected.actual.stderr);
  assert.equal(selected.actual.stdout,'setter 7\ndone\n');
  assert.deepEqual(selected.health,{ready:true});assert.deepEqual(selected.snapshot,{ready:true});
});

test('a no-execArgv child validates copied infrastructure before its top-level code runs',async t=>{
  const {root,write}=fixture(t,{runner:true});

  for(const file of ['package.json','tsconfig.fixtures.json','tsconfig.base.json'])cpSync(join(REPOSITORY,file),join(root,file));
  symlinkSync(join(REPOSITORY,'node_modules'),join(root,'node_modules'));
  mkdirSync(join(root,'third_party/node/test/parallel'),{recursive:true});mkdirSync(join(root,'third_party/node/test/fixtures'),{recursive:true});
  cpSync(join(REPOSITORY,'third_party/node/test/fixtures/utf8_test_text.txt'),join(root,'third_party/node/test/fixtures/utf8_test_text.txt'));
  write('runtime/node/subject/src/main.ts','export const value:number=1;\n');
  write('runtime/node/subject/tsconfig.json',JSON.stringify({extends:join(root,'tsconfig.fixtures.json'),files:['src/main.ts']}));
  write('runtime/node/subject/test/control.js',"require('node:assert/strict').equal(require('subject').value,1);\n");
  const plan=nodePreloadPlan(root,'subject',false),prepared=(await prepareOracle({...plan,project:null,directory:join(root,'preparation'),toolchain:oracleToolchainLocation()}));
  const driver=oracleRuntimeFile(prepared,plan.entry),file=oracleRuntimeFile(prepared,join(root,'runtime/node/subject/test/control.js'));
  const run=()=>{const own=oracleExecution(prepared,driver,[join(root,'runtime/node/subject/test/control.js')]);return {own,result:runNodeCase(t,process.execPath,[driver,'subject',file,'-'],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),...own.env}})};};
  const healthy=run();assert.equal(healthy.result.status,0,healthy.result.stderr);assert.match(healthy.result.stdout,/"kind":"pass"/);assert.deepEqual(oracleLoaderReady(healthy.own),{ready:true});
  const common=oracleRuntimeFile(prepared,join(root,'tooling/conformance/common.mjs')),effect=join(root,'forbidden-side-effect');
  chmodSync(common,0o644);
  writeFileSync(common,"import {writeFileSync as forbiddenWrite} from 'node:fs';forbiddenWrite("+JSON.stringify(effect)+",'ran');\n"+readFileSync(common,'utf8'));
  const changed=run();assert.notEqual(changed.result.status,0);assert.equal(existsSync(effect),false,'changed infrastructure must not execute before validation');
  assert.equal(oracleLoaderReady(changed.own).ready,false);
});



test('a declared harness TS entry is an ordinary root of its nearest project',async t=>{
  const {root,write}=fixture(t),entry=join(root,'runtime/node/subject/host.ts'),project=join(root,'runtime/node/subject/tsconfig.json');
  write('runtime/node/subject/host.ts','export const value=19;\n');
  write('runtime/node/subject/src/main.ts',"import {value} from '../host.ts';export {value};\n");
  const options={allowImportingTsExtensions:true,noEmit:true};
  write('runtime/node/subject/tsconfig.json',JSON.stringify({compilerOptions:options,files:['src/main.ts','host.ts']}));
  const sentinel=Error('ordinary-root control reached compiler'),worker=new OracleWorker(join(root,'worker'),oracleToolchainLocation());let calls=0;
  try{
    const request={entry:join(root,'tooling/conformance/run-one.mjs'),project:null,preloads:[{entry,project}],directory:join(root,'control-output')};
    await assert.rejects(worker.prepareBatch([request],async()=>{calls++;throw sentinel;}),error=>error===sentinel);
    assert.equal(calls,1);
    // Only remove the ordinary root. Its import from main remains unchanged.
    write('runtime/node/subject/tsconfig.json',JSON.stringify({compilerOptions:options,files:['src/main.ts']}));
    await assert.rejects(worker.prepareBatch([{...request,directory:join(root,'subject-output')}],async()=>{calls++;throw sentinel;}),error=>{
      assert.notEqual(error,sentinel,'import reach must not replace ordinary-root ownership');
      assert.ok(String(error).includes(entry),String(error));assert.ok(String(error).includes(project),String(error));return true;
    });
    assert.equal(calls,1,'an unowned entry must hold before another compiler command');
  }finally{worker.close();}
});

test('all Node harness plans enroll each declared TS entry in its nearest ordinary project',async t=>{
  const modules=readdirSync(join(REPOSITORY,'runtime/node')).filter(name=>existsSync(join(REPOSITORY,'runtime/node',name,'src/main.ts'))&&existsSync(join(REPOSITORY,'runtime/node',name,'tsconfig.json'))).sort();
  assert.equal(modules.length,28);
  const entries=new Map<string,{entry:string;project:string|null}>();
  for(const name of modules)for(const preload of nodePreloadPlan(REPOSITORY,name,false).preloads)entries.set(preload.entry,preload);
  assert.ok(entries.size>=33,'the actual harness closure must remain nonempty');
  const root=mkdtempSync(join(tmpdir(),'nts-node-project-closure-'));t.after(()=>removeOracleSnapshot(root));
  const worker=new OracleWorker(join(root,'worker'),oracleToolchainLocation()),sentinel=Error('complete ordinary-root closure reached compiler');let commands=0;
  try{
    // Query the very same captured SDK config parser used by stageGroup.
    for(const {entry,project} of entries.values()){
      assert.ok(project,'Node harness TS entry has no nearest project: '+entry);
      const roots=(worker as any).api.parseConfigFile(project).fileNames;
      assert.ok(roots.includes(entry),'Node harness TS entry is not an ordinary root: '+entry+'; project: '+project);
    }
    await assert.rejects(worker.prepareBatch([{entry:join(REPOSITORY,'tooling/conformance/run-one.mjs'),project:null,preloads:[...entries.values()],directory:join(root,'emit')}],async()=>{commands++;throw sentinel;}),error=>error===sentinel);
    assert.equal(commands,1);
  }finally{worker.close();}
});


test('a distinct sibling child receives exact scope through its private parent handle',async t=>{
  const {root,write}=fixture(t,{runner:true});

  for(const file of ['package.json','tsconfig.fixtures.json','tsconfig.base.json'])cpSync(join(REPOSITORY,file),join(root,file));
  symlinkSync(join(REPOSITORY,'node_modules'),join(root,'node_modules'));
  mkdirSync(join(root,'third_party/node/test/parallel'),{recursive:true});mkdirSync(join(root,'third_party/node/test/fixtures'),{recursive:true});
  cpSync(join(REPOSITORY,'third_party/node/test/fixtures/utf8_test_text.txt'),join(root,'third_party/node/test/fixtures/utf8_test_text.txt'));
  write('runtime/node/subject/src/main.ts','export const value:number=19;\n');
  write('runtime/node/subject/tsconfig.json',JSON.stringify({extends:join(root,'tsconfig.fixtures.json'),files:['src/main.ts']}));
  const child="require('node:assert/strict').equal(require('subject').value,19);console.log('delegated child executed');require('node:fs').appendFileSync(process.env.NTS_ORACLE_EMIT_STATUS,JSON.stringify({version:1,status:'instrument',reason:'delegated child control'})+'\\n');\n";
  write('runtime/node/subject/test/01-child.js',child);
  write('foreign/main.mjs','export const foreign=23;\n');
  const foreign=oracleExecution((await prepareOracle({entry:join(root,'foreign/main.mjs'),directory:join(root,'foreign-prepared'),project:null,runtimeRoots:[join(root,'foreign')]})));
  for(const [distinct,denied,eventDenied,changedEnvironment] of [[false,false,false,false],[true,false,false,false],[true,true,false,false],[true,true,true,false],[true,false,true,false],[true,false,false,true]]){
    await t.test(JSON.stringify({distinct,denied,eventDenied,changedEnvironment}),()=>{
    const target=distinct?"require('node:path').join(__dirname,'01-child.js')":"__filename";
    const errorReceipt=join(root,'delegation-error.json');
    write('runtime/node/subject/test/00-parent.js',"if(process.argv.includes('nested')){"+child+"}else{const fs=require('node:fs'),path=require('node:path'),states=path.join(path.dirname(process.env.NTS_ORACLE_EMIT_MANIFEST),'states'),mode=fs.statSync(states).mode&0o7777,event=process.env.NTS_ORACLE_EMIT_STATUS,eventMode=fs.statSync(event).mode&0o7777,denied="+denied+",eventDenied="+eventDenied+";if(denied)fs.chmodSync(states,0o500);if(eventDenied)fs.chmodSync(event,0o400);if("+changedEnvironment+")Object.assign(process.env,"+JSON.stringify({...foreign.env,NTS_ORACLE_DEPENDENCIES:'{}'})+");try{const result=require('node:child_process').spawnSync(process.execPath,["+target+",'nested'],{encoding:'utf8',env:{}});require('node:assert/strict').equal(result.status,0,result.stderr);require('node:assert/strict').ok(result.stdout.includes('delegated child executed'));}catch(error){if(!denied&&!eventDenied&&!"+changedEnvironment+")throw error;fs.writeFileSync("+JSON.stringify(errorReceipt)+",JSON.stringify({code:error.code??error.cause?.code,message:error.message}));}finally{if(eventDenied)fs.chmodSync(event,eventMode);if(denied)fs.chmodSync(states,mode);}}\n");
    const run=runNodeCase(t,process.execPath,[join(root,'tooling/conformance/run.mjs'),'--module','subject','--only','00-parent.js','--json'],{cwd:root,encoding:'utf8',env:fixtureEnvironment(t)});
    if(denied||eventDenied){const observed=JSON.parse(readFileSync(errorReceipt,'utf8'));if(denied)assert.equal(observed.code,'EACCES');t.diagnostic(JSON.stringify({denied,eventDenied,observed,status:run.status}));}
    assert.equal(run.status,124,run.stderr+run.stdout);
    const report=JSON.parse(run.stdout);t.diagnostic(JSON.stringify({distinct,changedEnvironment,rows:report.rows,scopes:report.oracleScopes}));
    assert.equal(report.rows.length,1);assert.equal(report.rows[0].kind,'not-measured');assert.match(report.rows[0].why,eventDenied?/child|event/:denied?/child execution was not prepared/:/delegated child control/,'child setup and execution failures both keep the parent held');
    if(!denied&&!eventDenied)assert.ok(report.oracleScopes.some(row=>row.path===join(root,'runtime/node/subject/test',distinct?'01-child.js':'00-parent.js')&&row.attested===false));
    });
  }
});


test('the actual runner retains a complete pre-result failure beside its short summary',t=>{
  const {root,write}=fixture(t,{runner:true}),message='pre-result cause '+'.'.repeat(160)+' exact-terminal-cause';

  for(const file of ['package.json','tsconfig.fixtures.json','tsconfig.base.json'])cpSync(join(REPOSITORY,file),join(root,file));
  symlinkSync(join(REPOSITORY,'node_modules'),join(root,'node_modules'));
  mkdirSync(join(root,'third_party/node/test/parallel'),{recursive:true});
  write('tooling/conformance/run-one.mjs','throw Error('+JSON.stringify(message)+');\n');
  write('runtime/node/subject/src/main.ts','export const value:number=19;\n');
  write('runtime/node/subject/tsconfig.json',JSON.stringify({extends:join(root,'tsconfig.fixtures.json'),files:['src/main.ts']}));
  write('runtime/node/subject/test/control.js','console.log(19);\n');
  const run=runNodeCase(t,process.execPath,[join(root,'tooling/conformance/run.mjs'),'--module','subject','--json'],{cwd:root,encoding:'utf8',env:fixtureEnvironment(t)});
  assert.equal(run.status,1,run.stderr+'\n'+run.stdout);
  const report=JSON.parse(run.stdout);assert.equal(report.rows.length,1);assert.equal(report.rows[0].kind,'fail');
  assert.ok(report.rows[0].why.length<=120);assert.ok(report.rows[0].detail?.includes(message),JSON.stringify(report.rows[0]));
});


test('the prepared runner preserves authored origins and infrastructure source identity',t=>{
  const {root,write}=fixture(t,{runner:true});

  for(const file of ['package.json','tsconfig.fixtures.json','tsconfig.base.json'])cpSync(join(REPOSITORY,file),join(root,file));
  symlinkSync(join(REPOSITORY,'node_modules'),join(root,'node_modules'));
  mkdirSync(join(root,'third_party/node/test/parallel'),{recursive:true});
  mkdirSync(join(root,'third_party/node/test/fixtures'),{recursive:true});
  cpSync(join(REPOSITORY,'third_party/node/test/fixtures/utf8_test_text.txt'),join(root,'third_party/node/test/fixtures/utf8_test_text.txt'));
  write('third_party/node/test/common/index.js',"throw Error('the original common helper must be substituted');\n");
  write('third_party/node/test/common/index.mjs',"import './index.js'; export const mustCall=()=>{throw Error('original common helper executed');};\n");
  write('runtime/node/subject/src/main.ts','export function answer():number{return 42;}\n');
  write('runtime/node/subject/tsconfig.json',JSON.stringify({extends:join(root,'tsconfig.fixtures.json'),files:['src/main.ts']}));
  for(const [prefix,value] of [['runtime/node/subject/test',19],['tooling/conformance',23]] as const){
    write(prefix+'/node_modules/origin-only/package.json','{"type":"commonjs","main":"index.cjs"}');
    write(prefix+'/node_modules/origin-only/index.cjs','module.exports='+value+';\n');
  }
  write('runtime/node/subject/test/00-authored-origin.js',"require('node:assert/strict').equal(require('origin-only'),19);\n");
  // The local list intentionally selects CommonJS .js files. Put actual ESM
  // controls in the upstream list, which selects .mjs without changing policy.
  write('third_party/node/test/parallel/test-subject-01-common-identity.mjs',"import {mustCall} from '../common/index.mjs'; mustCall(()=>{},1)();\n");
  write('third_party/node/test/parallel/other/index.mjs','export const value=23;\n');
  write('third_party/node/test/parallel/test-subject-02-unrelated-index.mjs',"import assert from 'node:assert/strict'; import {value} from './other/index.mjs'; assert.equal(value,23);\n");
  const run=runNodeCase(t,process.execPath,[join(root,'tooling/conformance/run.mjs'),'--module','subject','--json'],{cwd:root,encoding:'utf8',env:fixtureEnvironment(t)});
  assert.equal(run.status,0,run.stderr+'\n'+run.stdout);
  const record=JSON.parse(run.stdout) as {rows:{name:string;kind:string}[];tally:Record<string,number>};
  assert.deepEqual(record.rows.map(row=>[row.name,row.kind]),[['test-subject-01-common-identity.mjs','pass'],['test-subject-02-unrelated-index.mjs','pass'],['local/00-authored-origin.js','pass']]);
  assert.equal(record.tally.pass,3);assert.equal(record.tally['not-measured']??0,0);
});


test('the module runner finalizes the original snapshot before any measured report',async t=>{
  for(const mutation of ['none','original-source','original-listing','omit-finalizer'] as const)await t.test(mutation,()=>{
    const {root,write}=fixture(t,{runner:true});

    for(const file of ['package.json','tsconfig.fixtures.json','tsconfig.base.json'])cpSync(join(REPOSITORY,file),join(root,file));
    symlinkSync(join(REPOSITORY,'node_modules'),join(root,'node_modules'));
    mkdirSync(join(root,'third_party/node/test/parallel'),{recursive:true});
    mkdirSync(join(root,'third_party/node/test/fixtures'),{recursive:true});
    cpSync(join(REPOSITORY,'third_party/node/test/fixtures/utf8_test_text.txt'),join(root,'third_party/node/test/fixtures/utf8_test_text.txt'));
    write('runtime/node/subject/src/main.ts','export const value=19;\n');
    write('runtime/node/subject/tsconfig.json',JSON.stringify({extends:join(root,'tsconfig.fixtures.json'),files:['src/main.ts']}));
    const change=mutation==='original-source'
      ?"require('node:fs').appendFileSync(__filename,'\\n// changed original\\n');"
      :mutation==='original-listing'
        ?"require('node:fs').writeFileSync(require('node:path').join(__dirname,'appeared.txt'),'listing changed');"
        :'';
    write('runtime/node/subject/test/00-provisional.js',change+"require('node:assert/strict').equal(require('subject').value,19);\n");
    const runner=join(root,'tooling/conformance/run.mjs');
    if(mutation==='omit-finalizer'){
      const original=readFileSync(runner,'utf8'),changed=original.replaceAll('finishOracleSnapshot(preparedModule)','({ready:true})');
      assert.notEqual(changed,original);writeFileSync(runner,changed);
    }
    const instrument=join(root,'step-instrument.json'),step='snapshot-parent',attempt='guard';
    const run=runNodeCase(t,process.execPath,[runner,'--module','subject','--json'],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),NTS_GATE_STEP:step,NTS_GATE_STEP_ATTEMPT:attempt,NTS_GATE_STEP_RESULT:instrument}});
    const record=JSON.parse(run.stdout) as {rows:{kind:string;why?:string}[];preparation:{finalization:{ready:boolean}}};
    t.diagnostic(JSON.stringify({mutation,status:run.status,record,stderr:run.stderr}));
    assert.equal(record.rows.length,1);
    if(mutation==='none'){
      assert.equal(run.status,0,run.stderr);assert.equal(record.rows[0]!.kind,'pass');assert.deepEqual(record.preparation.finalization,{ready:true});assert.equal(existsSync(instrument),false);
    }else{
      assert.notEqual(run.status,0);assert.equal(record.rows[0]!.kind,'not-measured');assert.match(record.rows[0]!.why!,/oracle snapshot finalization/);
      const result=readStepInstrument(instrument,step,attempt)!;
      assert.equal(result.verdict,'INSTRUMENT');assert.equal(result.kind,'tooling-setup');assert.equal(instrumentPolicy(result.kind)?.disposition === "operator-hold",true);
    }
  });
});

function workerFixture(t:TestContext){
  const {root,write}=fixture(t,{runner:true});

  for(const file of ['package.json','tsconfig.fixtures.json','tsconfig.base.json'])cpSync(join(REPOSITORY,file),join(root,file));
  symlinkSync(join(REPOSITORY,'node_modules'),join(root,'node_modules'));
  mkdirSync(join(root,'third_party/node/test/parallel'),{recursive:true});
  write('third_party/node/package.json','{"type":"commonjs"}\n');
  write('third_party/node/test/fixtures/utf8_test_text.txt','owned guard data\n');
  write('third_party/node/test/common/index.js','module.exports={value:19};\n');
  write('runtime/node/subject/src/main.ts','export const value:number=19;\n');
  write('runtime/node/subject/tsconfig.json',JSON.stringify({extends:join(root,'tsconfig.fixtures.json'),files:['src/main.ts']}));
  write('runtime/node/subject/child-fixtures','fixtures/test-worker-role.js\n');
  write('third_party/node/test/fixtures/test-worker-role.js',`
const {parentPort,workerData}=require('node:worker_threads');
const common=require('../common');
const before=process.env.NTS_WORKER_ROLE_GUARD;
process.env.NTS_WORKER_ROLE_GUARD='child';
parentPort.postMessage({value:workerData.value+common.value,before});
process.exit(workerData.exit);
`);
  return {root,write};
}

test('closed Worker realms keep private scope, user data and environment semantics',t=>{
  const {root,write}=workerFixture(t);
  write('runtime/node/subject/test/00-worker.js',`
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Worker,SHARE_ENV}=require('node:worker_threads');
const target=path.resolve(__dirname,'../../../../third_party/node/test/fixtures/test-worker-role.js');
(async()=>{
  for(const mode of ['inherited','empty','shared']){
    process.env.NTS_WORKER_ROLE_GUARD='parent';
    const options={workerData:{value:23,exit:7}};
    if(mode==='empty')options.env={};
    if(mode==='shared')options.env=SHARE_ENV;
    const worker=new Worker(target,options);
    const [message,status]=await Promise.all([
      new Promise((done,reject)=>{worker.once('message',done);worker.once('error',reject);}),
      new Promise((done,reject)=>{worker.once('exit',done);worker.once('error',reject);}),
    ]);
    assert.deepEqual(message,{value:42,before:mode==='empty'?undefined:'parent'});assert.equal(status,7);
    assert.equal(process.env.NTS_WORKER_ROLE_GUARD,mode==='shared'?'child':'parent');
  }
  const descriptorCount=()=>fs.readdirSync('/proc/self/fd').length,before=descriptorCount();
  for(let index=0;index<6;index++){
    const worker=new Worker(target,{workerData:{value:23,exit:7}});
    const [message,status]=await Promise.all([
      new Promise((done,reject)=>{worker.once('message',done);worker.once('error',reject);}),
      new Promise((done,reject)=>{worker.once('exit',done);worker.once('error',reject);}),
    ]);
    assert.equal(message.value,42);assert.equal(status,7);await new Promise(done=>setImmediate(done));
    assert.equal(descriptorCount(),before,'successful Worker launch readers close');
  }
  for(let index=0;index<5;index++){
    assert.throws(()=>new Worker(target,{execArgv:['--not-a-node-option']}),{code:'ERR_WORKER_INVALID_EXEC_ARGV'});
    await new Promise(done=>setImmediate(done));assert.equal(descriptorCount(),before,'failed Worker launch readers close');
  }
  const state=process.env.NTS_ORACLE_EMIT_STATUS;
  if(state){
    const rows=fs.readFileSync(state,'utf8').trim().split('\\n').map(line=>JSON.parse(line));
    assert.equal(rows.filter(row=>row.status==='child-start').length,14);
    assert.equal(new Set(rows.filter(row=>row.status==='child-start').map(row=>row.execution)).size,14);
    assert.equal(rows.filter(row=>row.status==='child-begin').length,9);
    assert.equal(rows.filter(row=>row.status==='child-ready').length,9);
    assert.equal(rows.filter(row=>row.status==='child-launch-failed').length,5);
  }
})().catch(error=>{process.nextTick(()=>{throw error;});});
`);
  const parent=join(root,'runtime/node/subject/test/00-worker.js');
  const reference=`const {createRequire}=require('node:module');const fs=require('node:fs'),path=require('node:path'),file=${JSON.stringify(parent)};new Function('require','__dirname',fs.readFileSync(file,'utf8'))(createRequire(file),path.dirname(file));`;
  write('reference.cjs',reference);
  const plain=runNodeCase(t,process.execPath,[join(root,'reference.cjs')],{cwd:root,encoding:'utf8'});
  assert.equal(plain.status,0,plain.stderr);
  const run=runNodeCase(t,process.execPath,[join(root,'tooling/conformance/run.mjs'),'--module','subject','--json'],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),NTS_CONFORMANCE_TIMEOUT_MS:'60000'}});
  assert.equal(run.status,0,run.stderr+'\n'+run.stdout);
  const record=JSON.parse(run.stdout);assert.deepEqual(record.rows.map(row=>[row.name,row.kind]),[['local/00-worker.js','pass']]);assert.equal(record.tally.pass,1);
});

test('Worker driver substitution and begun bootstrap failure stay held after a caught exit',async t=>{
  for(const kind of ['driver','dependency','bootstrap'] as const)await t.test(kind,()=>{
    const {root,write}=workerFixture(t);
    write('third_party/node/test/fixtures/other-worker.mjs',`import {parentPort,workerData} from 'node:worker_threads';import {pathToFileURL} from 'node:url';const api=await import(new URL('./assets/oracle-loader.ts',pathToFileURL(workerData.oracle.NTS_ORACLE_EMIT_MANIFEST)));const handle=api.oracleHarnessCapability();parentPort.postMessage({usable:typeof handle.commonJS==='function'});\n`);
    write('runtime/node/subject/test/00-worker.js',`
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const {Worker}=require('node:worker_threads'),Base=Object.getPrototypeOf(Worker),kind=${JSON.stringify(kind)};
Object.setPrototypeOf(Worker,class extends Base {
  constructor(filename,options){
    const context=options.workerData.oracle;
    if(kind==='bootstrap'){
      const asset=path.join(path.dirname(context.NTS_ORACLE_EMIT_MANIFEST),'assets/oracle-runtime.mjs');fs.chmodSync(asset,0o600);fs.appendFileSync(asset,'\\n// changed bootstrap bytes\\n');
    }else if(kind==='dependency'){
      const cap=JSON.parse(context.NTS_ORACLE_DEPENDENCIES);cap.sourceRevision='wrong';
      options={...options,workerData:{...options.workerData,oracle:{...context,NTS_ORACLE_DEPENDENCIES:JSON.stringify(cap)}}};
    }else{
      const other=path.resolve(path.dirname(filename),'../../third_party/node/test/fixtures/other-worker.mjs');
      const file=path.join(path.dirname(context.NTS_ORACLE_EMIT_STATUS),'module-inputs.json'),record=JSON.parse(fs.readFileSync(file,'utf8'));
      record.driver={path:other,sha256:crypto.createHash('sha256').update(fs.readFileSync(other)).digest('hex')};fs.writeFileSync(file,JSON.stringify(record)+'\\n');filename=other;
    }
    super(filename,options);
  }
});


const target=path.resolve(__dirname,'../../../../third_party/node/test/fixtures/test-worker-role.js'),worker=new Worker(target,{workerData:{value:23,exit:7}});
let messages=0,error;
worker.on('message',()=>messages++);worker.on('error',value=>{error=value;});
worker.once('exit',status=>{
  assert.equal(status,1);assert.equal(messages,0,'a substituted driver never obtains a usable wrapper');assert.ok(error);
  const rows=fs.readFileSync(process.env.NTS_ORACLE_EMIT_STATUS,'utf8').trim().split('\\n').map(line=>JSON.parse(line));
  assert.equal(rows.filter(row=>row.status==='child-start').length,1);
  assert.equal(rows.filter(row=>row.status==='child-begin').length,kind==='dependency'?1:0);
  assert.equal(rows.filter(row=>row.status==='child-ready').length,0);
  assert.equal(rows.filter(row=>row.status==='child-launch-failed').length,0,'a broken bootstrap is never an ordinary launch failure');
  console.log('caught-worker-failure-'+kind);
});
`);
    const run=runNodeCase(t,process.execPath,[join(root,'tooling/conformance/run.mjs'),'--module','subject','--json'],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),NTS_CONFORMANCE_TIMEOUT_MS:'60000'}});
    assert.equal(run.status,124,run.stderr+'\n'+run.stdout);
    const record=JSON.parse(run.stdout),row=record.rows[0];assert.equal(row.kind,'not-measured');
    assert.match(row.why,kind==='driver'?/worker driver has no exact parent role/:kind==='dependency'?/dependency snapshot identity mismatch/:/generated bootstrap asset changed: assets\/oracle-runtime\.mjs/);
    assert.match(row.detail,/caught-worker-failure-/,'the parent catches the error and exit before its owner publishes the hold');
  });
});

test('the producer cannot replace a declared Worker role with another owned file',async t=>{
  const {root,write}=workerFixture(t),source=join(root,'tooling/conformance/run-cjs-worker.mjs');
  const other=join(root,'tooling/conformance/other-worker.mjs');write('tooling/conformance/other-worker.mjs',readFileSync(source,'utf8'));
  const plan=nodePreloadPlan(root,'subject',false),outputs=[join(root,'role-control'),join(root,'role-subject')];for(const output of outputs)mkdirSync(output);
  const request={...plan,project:null,runtimeRoots:[...plan.runtimeRoots,other],outputRoots:outputs,toolchain:oracleToolchainLocation()};
  const control=await prepareOracle({...request,directory:outputs[0]!});
  assert.ok(oracleRuntimeFile(control,source));assert.ok(oracleRuntimeFile(control,other),'the replacement is independently captured');
  assert.deepEqual(readFileSync(oracleRuntimeFile(control,source)),readFileSync(oracleRuntimeFile(control,other)),'even equal bytes do not change the declared driver identity');
  assert.deepEqual(finishOracleSnapshot(control),{ready:true});
  const {createHash}=await import('node:crypto'),sha256=createHash('sha256').update(readFileSync(other)).digest('hex');
  const declarations={...plan.declarations,files:{...plan.declarations.files,[other]:sha256},descriptor:{...plan.declarations.descriptor,drivers:{commonjsWorker:{source:other,sha256}}}};
  await assert.rejects(prepareOracle({...request,directory:outputs[1]!,declarations}),/worker driver has no exact captured identity/);
});

test('an eval-string Worker remains a named owner hold when its caller catches it',t=>{
  const {root,write}=workerFixture(t);
  write('runtime/node/subject/test/00-worker.js',"const {Worker}=require('node:worker_threads');try{new Worker('1+1',{eval:true});}catch{}\n");
  const run=runNodeCase(t,process.execPath,[join(root,'tooling/conformance/run.mjs'),'--module','subject','--json'],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),NTS_CONFORMANCE_TIMEOUT_MS:'60000'}});
  assert.equal(run.status,124,run.stderr+'\n'+run.stdout);const record=JSON.parse(run.stdout);
  assert.equal(record.rows[0].kind,'not-measured');assert.match(record.rows[0].why,/oracle eval Worker entry has no captured driver/);
});

test('a Worker cannot run unknown pre-bootstrap loader code',t=>{
  const {root,write}=workerFixture(t),effect=join(root,'unowned-loader-ran');
  const loader='data:text/javascript,'+encodeURIComponent("import {writeFileSync} from 'node:fs';writeFileSync("+JSON.stringify(effect)+",'ran');");
  write('runtime/node/subject/test/00-worker.js',`const {Worker}=require('node:worker_threads');const path=require('node:path');const target=path.resolve(__dirname,'../../../../third_party/node/test/fixtures/test-worker-role.js');try{new Worker(target,{workerData:{value:23,exit:7},execArgv:['--experimental-loader',${JSON.stringify(loader)}]}).on('error',()=>{});}catch{}\n`);
  const run=runNodeCase(t,process.execPath,[join(root,'tooling/conformance/run.mjs'),'--module','subject','--json'],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),NTS_CONFORMANCE_TIMEOUT_MS:'60000'}});
  assert.equal(run.status,124,run.stderr+'\n'+run.stdout);assert.equal(existsSync(effect),false,'a custom loader is rejected before it can execute');
  const record=JSON.parse(run.stdout);assert.match(record.rows[0].why,/oracle Worker pre-bootstrap code was not captured/);
});

test('an asynchronous Worker initialization failure closes only its unbegun reservation',t=>{
  const {root,write}=workerFixture(t);
  write('runtime/node/subject/test/00-worker.js',`
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {Worker}=require('node:worker_threads'),{spawnSync}=require('node:child_process');
const target=path.resolve(__dirname,'../../../../third_party/node/test/fixtures/test-worker-role.js');
const limit=spawnSync('prlimit',['--pid',String(process.pid),'--nofile=64:64'],{encoding:'utf8'});assert.equal(limit.status,0,limit.stderr);
const held=[];for(;;){try{held.push(fs.openSync(target,'r'));}catch(error){assert.equal(error.code,'EMFILE');break;}}
for(let index=0;index<4;index++)fs.closeSync(held.pop());
const worker=new Worker(target,{workerData:{value:23,exit:7}});let error,messages=0;
worker.on('message',()=>messages++);worker.on('error',value=>{error=value;});
worker.once('exit',status=>{
  for(const descriptor of held)fs.closeSync(descriptor);
  assert.equal(status,0);assert.equal(messages,0);assert.equal(error.code,'ERR_WORKER_INIT_FAILED');assert.match(error.message,/EMFILE/);
  if(process.env.NTS_ORACLE_EMIT_STATUS){
    const rows=fs.readFileSync(process.env.NTS_ORACLE_EMIT_STATUS,'utf8').trim().split('\\n').map(line=>JSON.parse(line));
    assert.equal(rows.filter(row=>row.status==='child-start').length,1);
    assert.equal(rows.filter(row=>row.status==='child-begin').length,0);
    assert.equal(rows.filter(row=>row.status==='child-ready').length,0);
    assert.equal(rows.filter(row=>row.status==='child-launch-failed').length,1);
  }
});
`);
  const parent=join(root,'runtime/node/subject/test/00-worker.js');
  write('reference.cjs',`const {createRequire}=require('node:module');const fs=require('node:fs'),path=require('node:path'),file=${JSON.stringify(parent)};new Function('require','__dirname',fs.readFileSync(file,'utf8'))(createRequire(file),path.dirname(file));`);
  const plain=runNodeCase(t,process.execPath,[join(root,'reference.cjs')],{cwd:root,encoding:'utf8'});assert.equal(plain.status,0,plain.stderr);
  write('runtime/node/subject/test/01-clean.js',"require('node:assert/strict').equal(require('subject').value,19);\n");
  const run=runNodeCase(t,process.execPath,[join(root,'tooling/conformance/run.mjs'),'--module','subject','--json'],{cwd:root,encoding:'utf8',env:{...fixtureEnvironment(t),NTS_CONFORMANCE_TIMEOUT_MS:'60000'}});
  assert.equal(run.status,0,run.stderr+'\n'+run.stdout);const record=JSON.parse(run.stdout);
  assert.deepEqual(record.rows.map(row=>[row.name,row.kind]),[['local/00-worker.js','pass'],['local/01-clean.js','pass']]);assert.equal(record.tally.pass,2);
});
