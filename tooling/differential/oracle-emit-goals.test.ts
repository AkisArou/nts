import {testEnvironment} from "../gate/test-environment.ts";
// The Node oracle's emission and preparation (oracle-emit.ts): diagnostic
// attribution and owner membership, source and project maps, output inventory,
// and module goals. Shared helpers are in oracle-emit-fixture.ts.
import type {Diagnostic} from 'typescript/sync';
import * as oracleOwner from './oracle-emit.ts';
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,parse} from "node:path";
import {test} from "node:test";
import {OracleWorker,TypeScriptDiagnosticError,REPOSITORY,removeOracleSnapshot,oracleLoaderReady,oracleRuntimeFile,type OracleOptions,type OraclePrepared,type OracleRuntimeRoute} from "./oracle-emit.ts";
import {OUTCOME_ORACLE_PRELOADS,outcomeSourceAssets} from "../conformance/outcomes-project.ts";
import {OracleFilesystem} from './oracle-filesystem.ts';
import {type EmittedFile,toolchain,oracleExecution,prepareOracle,workspace,execute,bare,prepare,ordinaryProject,diagnostics,boundedCompiler} from './oracle-emit-fixture.ts';

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
  const run=spawnSync(process.execPath,[...prepared.args,...OUTCOME_ORACLE_PRELOADS.flatMap(file=>['--import',file]),join(root,'src/main.ts')],{encoding:'utf8',cwd:root,env:{...testEnvironment(),...prepared.env}});
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
        stock=spawnSync(process.execPath,['--enable-source-maps','--no-warnings',stockFile!],{encoding:'utf8',cwd:root,env:testEnvironment()});
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
        stock=spawnSync(process.execPath,['--enable-source-maps','--no-warnings',file],{cwd:root,env:testEnvironment(),encoding:'utf8'});
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
    const actual=spawnSync(process.execPath,[...execution.args,...args],{cwd:root,encoding:'utf8',env:{...testEnvironment(),...execution.env}});
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
  const escaped=oracleExecution(fresh),outside=spawnSync(process.execPath,[...escaped.args,...captured],{cwd:root,encoding:'utf8',env:{...testEnvironment(),...escaped.env}});
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
    const execution=oracleExecution(prepared),actual=spawnSync(process.execPath,[...execution.args,join(root,'src/main.ts'),...(name?[name]:[])],{cwd:root,encoding:'utf8',env:{...testEnvironment(),...execution.env}});
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
    const bare=spawnSync(process.execPath,['--no-warnings',output],{cwd:root,env:testEnvironment(),encoding:'utf8'});
    assert.equal(bare.status,0,bare.stderr);assert.equal(oracle.status,0,oracle.stderr);
    return {oracle:oracle.stdout,bare:bare.stdout};
  };
  const subject=compare((await prepare(root)));
  writeFileSync(join(root,'src/main.ts'),body);
  const control=compare((await prepare(root)));
  assert.equal(control.oracle,'false\n');assert.equal(control.bare,'false\n');
  assert.equal(subject.bare,'false\n');assert.equal(subject.oracle,subject.bare);
});
