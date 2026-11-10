// The Node oracle's emission and preparation (oracle-emit.ts): diagnostic
// parity with the pinned compiler, compiler exit status, and complete
// diagnostics for implicit roots. Shared helpers are in oracle-emit-fixture.ts.
import assert from "node:assert/strict";
import {existsSync,mkdtempSync,readFileSync,readdirSync,symlinkSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join} from "node:path";
import {test} from "node:test";
import {OracleWorker,REPOSITORY,removeOracleSnapshot} from "./oracle-emit.ts";
import {toolchain,oracleExecution,workspace,execute,ordinaryProject,diagnostics,boundedCompiler} from './oracle-emit-fixture.ts';

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
