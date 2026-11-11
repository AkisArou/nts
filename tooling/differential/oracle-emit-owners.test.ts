import {testEnvironment} from "../gate/test-environment.ts";
// The Node oracle's emission and preparation (oracle-emit.ts): owner runtime
// capture, shared owner reuse and invalidation, run seals, runtime bindings,
// output ownership and declared inputs. Shared helpers are in
// oracle-emit-fixture.ts.
import type {CheckerImportRelation} from './oracle-filesystem.ts';
import * as oracleOwner from './oracle-emit.ts';
import {gateEnvironment,hostEnvironment,sealOracleRun} from "../gate/canonical-environment.ts";
import {ownMemory} from "../gate/test-memory.ts";
import {finishRunTemporary} from '../gate/run-temporary.ts';
import {ownerEmissionCalls} from '../gate/owner-emission-calls.ts';
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,symlinkSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,relative} from "node:path";
import {test} from "node:test";
import {OracleWorker,REPOSITORY,removeOracleSnapshot,verifyToolchain,oracleLoaderReady,type OraclePrepared,type OracleRuntimeRoute,type OwnerImportRoute} from "./oracle-emit.ts";
import {OUTCOME_ORACLE_PRELOADS,outcomeSourceAssets} from "../conformance/outcomes-project.ts";
import {type HostObservation} from './oracle-filesystem.ts';
import {type EmittedFile,toolchain,oracleExecution,prepareOracle,workspace,execute,prepare,changedSnapshot,boundedCompiler} from './oracle-emit-fixture.ts';

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
    {cwd:root,env:{...testEnvironment(),...execution.env},encoding:'utf8'});
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
    // The seal's capture reserves in a ledger of the run's own, never the machine's.
    const planned=await sealOracleRun(gateEnvironment(hostEnvironment(process.env),{run:outside,oracleAdmissionContext:kind,owned:ownMemory(join(outside,'memory'))}));
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
    const run=spawnSync(process.execPath,[...prepared.args,'--no-warnings',...OUTCOME_ORACLE_PRELOADS.flatMap(file=>['--import',file]),join(root,'src/main.ts')],{cwd:root,encoding:'utf8',env:{...testEnvironment(),...prepared.env}});
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
    const emitted=spawnSync(compiler,args,{env:testEnvironment(),cwd:root,encoding:'utf8'});assert.equal(emitted.status,0,emitted.stdout+emitted.stderr);
    const stock=spawnSync(process.execPath,[join(reference,'src/main.mjs')],{env:testEnvironment(),cwd:root,encoding:'utf8'});
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
