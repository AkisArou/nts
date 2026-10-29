import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {PassThrough} from "node:stream";
import {randomUUID} from "node:crypto";
import {waitFor,spawnTest} from "./test-wait.ts";
import {completedTestFailure,readToolingCompletion,readToolingRequest,ToolingTestOwners,runScopedTooling} from "./tooling-runner.ts";
import {readStepInstrument} from "./step-result.ts";
import {newToolingSlice,stopToolingSlice,toolingSlice,toolingSliceArgs,toolingSlicePrefix} from "./tooling-slice.ts";

test("tooling slice names preserve nesting and cannot name unrelated units",()=>{
  const parent=newToolingSlice(true,{}),env={NTS_TOOLING_SLICE:parent};
  const child=newToolingSlice(true,env);
  assert.ok(child.startsWith(parent.slice(0,-6)+"-test"));
  assert.equal(toolingSlice({NTS_TOOLING_SLICE:child}),child);
  assert.deepEqual(toolingSliceArgs(env),[`--slice=${parent}`]);
  assert.equal(toolingSlicePrefix("ntscensuscontrol",env),parent.slice(0,-6)+"-ntscensuscontrol");
  assert.equal(toolingSlicePrefix("ntscensuscontrol",{}),"ntscensuscontrol");
  assert.throws(()=>stopToolingSlice("app.slice"),/invalid tooling slice/);
});

test("a hung fixture's service and census scopes leave with its slice while a sibling stays active",async t=>{
  const directory=mkdtempSync(join(tmpdir(),"tooling-slice-control-"));
  const sibling=newToolingSlice(true),siblingUnit=`nts-test-tooling-sibling-${randomUUID().slice(0,8)}`;
  let ownedSlice:string|undefined;
  t.after(()=>{if(ownedSlice)stopToolingSlice(ownedSlice);stopToolingSlice(sibling);rmSync(directory,{recursive:true,force:true});});
  const systemctl=(...args:string[])=>spawnSync("systemctl",["--user",...args],{encoding:"utf8"});
  const fifo=join(directory,"hold"),state=join(directory,"ready.json"),file=join(directory,"subject.test.mjs");
  const made=spawnSync("mkfifo",[fifo],{encoding:"utf8"});assert.equal(made.status,0,made.stderr);
  const started=spawnSync("systemd-run",["--user","--quiet","--collect",...toolingSliceArgs({NTS_TOOLING_SLICE:sibling}),`--unit=${siblingUnit}`,"--property=LimitCORE=0","/usr/bin/taskset","-c","0-3,6-31","/usr/bin/cat",fifo],{encoding:"utf8"});
  assert.equal(started.status,0,started.stderr);
  const helper=new URL("./tooling-slice.ts",import.meta.url).href,memory=new URL("../census/worker-memory.ts",import.meta.url).href,waiting=new URL("./test-wait.ts",import.meta.url).href;
  const service=`nts-test-tooling-subject-${randomUUID().slice(0,8)}`;
  writeFileSync(file,`
import {spawn,spawnSync} from 'node:child_process';
import {writeFileSync,createReadStream} from 'node:fs';
import {toolingSliceArgs} from ${JSON.stringify(helper)};
import {MemoryRun} from ${JSON.stringify(memory)};
import {waitFor} from ${JSON.stringify(waiting)};
const unit=${JSON.stringify(service)},fifo=${JSON.stringify(fifo)};
const started=spawnSync('systemd-run',['--user','--quiet','--collect',...toolingSliceArgs(),'--unit='+unit,'--property=LimitCORE=0','/usr/bin/taskset','-c','0-3,6-31','/usr/bin/cat',fifo],{encoding:'utf8'});
if(started.status)throw new Error(started.stderr);
const run=new MemoryRun({budgetBytes:128*2**20,id:'tooling-containment'}),worker=run.worker(0,64*2**20),scope=worker.scope('/usr/bin/cat',[fifo]);
spawn('systemd-run',scope.argv,{env:scope.env,stdio:'ignore'});
await waitFor('the owned census scope to start',()=>worker.ready(scope));
const serviceGroup=spawnSync('systemctl',['--user','show',unit,'--property=ControlGroup','--value'],{encoding:'utf8'}).stdout.trim();
writeFileSync(${JSON.stringify(state)},JSON.stringify({unit,serviceGroup,censusGroup:run.group,workerGroup:worker.group,scope:scope.unit}));
createReadStream(fifo).resume();
`);
  let observed:any;
  const transcript=new PassThrough();let output="";transcript.on("data",data=>output+=data);
  await assert.rejects(runScopedTooling([file],{fixture:true,output:transcript,onScope:async(slice,unit,stopped)=>{
    ownedSlice=slice;
    await waitFor("the subject's real service and census readiness record",()=>existsSync(state),{stopped});
    observed=JSON.parse(readFileSync(state,"utf8"));
    assert.ok(observed.serviceGroup.includes(`/${slice}/`),observed.serviceGroup);
    assert.ok(observed.censusGroup.startsWith(observed.serviceGroup.slice(0,observed.serviceGroup.lastIndexOf('/'))+"/"),observed.censusGroup);
    const stoppedUnit=systemctl("stop",unit);assert.equal(stoppedUnit.status,0,stoppedUnit.stderr);
  }}),error=>{assert.match(String(error),/without a completed report/,output);return true;});
  assert.notEqual(systemctl("is-active",service).stdout.trim(),"active");
  assert.notEqual(systemctl("is-active",observed.scope).stdout.trim(),"active");
  await waitFor("the owned service and aggregate cgroups to disappear",()=>!existsSync('/sys/fs/cgroup'+observed.serviceGroup)&&!existsSync('/sys/fs/cgroup'+observed.censusGroup));
  assert.equal(systemctl("is-active",siblingUnit).stdout.trim(),"active","sibling run is untouched");
});

test("only completed assertion reports authorize ordinary pass and fail results",async t=>{
  const directory=mkdtempSync(join(tmpdir(),"tooling-results-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  for(const [name,body,status] of [["pass","",0],["fail","throw new Error('assertion control')",1]] as const) {
    const file=join(directory,`${name}.test.mjs`);writeFileSync(file,`import {test} from 'node:test';test('${name}',()=>{${body}});\n`);
    const output=new PassThrough();output.resume();
    const actual=await runScopedTooling([file],{fixture:true,output});
    assert.equal(actual.status,status);assert.equal(actual.completedFailures,status);
  }
});

test("a fixture that closes before readiness fails on its actual close",async t=>{
  const directory=mkdtempSync(join(tmpdir(),"tooling-early-close-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const file=join(directory,"closed.test.mjs");writeFileSync(file,"throw new Error('before readiness control');\n");
  const output=new PassThrough();output.resume();
  await assert.rejects(runScopedTooling([file],{fixture:true,output,onScope:async(_slice,_unit,stopped)=>{
    await waitFor("the readiness record",()=>existsSync(join(directory,"never-ready")),{stopped});
  }}),/test fixture stopped while waiting for the readiness record: tooling file scope closed/);
});


test("test children cannot publish into their supervising step's instrument record",async t=>{
  const directory=mkdtempSync(join(tmpdir(),"tooling-frame-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const file=join(directory,"frame.test.mjs"),result=join(directory,"public-result.json");
  const keys=["NTS_GATE_STEP_RESULT","NTS_GATE_STEP_ATTEMPT","NTS_GATE_STEP"] as const;
  const before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  t.after(()=>{for(const key of keys)if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];});
  Object.assign(process.env,{NTS_GATE_STEP_RESULT:result,NTS_GATE_STEP_ATTEMPT:"fixture-attempt",NTS_GATE_STEP:"tooling"});
  writeFileSync(file,`import {test} from 'node:test';import assert from 'node:assert/strict';test('isolated frame',()=>{assert.equal(process.env.NTS_GATE_STEP_RESULT,undefined);assert.equal(process.env.NTS_GATE_STEP_ATTEMPT,undefined);});\n`);
  const output=new PassThrough();output.resume();
  assert.equal((await runScopedTooling([file],{fixture:true,output})).status,0);
  assert.equal(existsSync(result),false);
});


test("a completed failure followed by an idle test is red while pass followed by idle holds",async t=>{
  const directory=mkdtempSync(join(tmpdir(),"tooling-mixed-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const keys=["NTS_GATE_STEP_RESULT","NTS_GATE_STEP_ATTEMPT","NTS_GATE_STEP"] as const;
  const before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  t.after(()=>{for(const key of keys)if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];});
  for(const failed of [false,true]){
    const file=join(directory,`${failed}.test.mjs`),result=join(directory,`${failed}.json`);
    writeFileSync(file,`import {test} from 'node:test';test('completed',()=>{${failed?"throw new Error('definite assertion')":""}});test('unfinished',async()=>{await new Promise(()=>{setInterval(()=>{},1000)});});`);
    Object.assign(process.env,{NTS_GATE_STEP_RESULT:result,NTS_GATE_STEP_ATTEMPT:"mixed",NTS_GATE_STEP:"tooling"});
    const output=new PassThrough();let transcript="";output.on("data",part=>transcript+=part);
    const actual=await runScopedTooling([file],{fixture:true,idleMs:1000,output});
    assert.equal(actual.status,failed?1:2,transcript);
    assert.equal(actual.completedFailures,failed?1:0,transcript);
    const observation=readStepInstrument(result,"tooling","mixed")!;
    assert.equal(observation.kind,"hung");assert.equal(observation.verdict,failed?"FAIL":"NOT RUN");
    assert.equal(observation.completedFailures??0,failed?1:0,transcript);
    if(failed)assert.match(transcript,/definite assertion/);
  }
});

test("guard cancellation is unfinished work and late completed test errors remain definite",()=>{
  for(const failureType of ["testAborted","cancelledByParent","subtestsFailed","testTimeoutFailure"])
    assert.equal(completedTestFailure({details:{passed:false,error:{failureType}}}),false);
  for(const failureType of ["testCodeFailure","hookFailed","uncaughtException","unhandledRejection",undefined]){
    assert.equal(completedTestFailure({details:{passed:false,error:{failureType}}}),true);
    assert.equal(completedTestFailure({details:{passed:false,error:{failureType}},todo:true}),false);
    assert.equal(completedTestFailure({details:{passed:false,error:{failureType}},skip:true}),false);
  }
});


test("completed uncaught exceptions and rejections remain red before a later hang",async t=>{
  const directory=mkdtempSync(join(tmpdir(),"tooling-async-mixed-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const keys=["NTS_GATE_STEP_RESULT","NTS_GATE_STEP_ATTEMPT","NTS_GATE_STEP"] as const;
  const before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  t.after(()=>{for(const key of keys)if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];});
  for(const rejection of [false,true]){
    const file=join(directory,`${rejection}.test.mjs`),frame=join(directory,`${rejection}.json`);
    const action=rejection?"Promise.reject(Error('definite rejection'))":"throw Error('definite uncaught')";
    writeFileSync(file,`import{test}from'node:test';test('completed failure',async()=>{await new Promise(resolve=>{setImmediate(()=>{${action}});setImmediate(resolve);});});test('unfinished',async()=>await new Promise(()=>{setInterval(()=>{},1000)}));`);
    Object.assign(process.env,{NTS_GATE_STEP_RESULT:frame,NTS_GATE_STEP:"tooling",NTS_GATE_STEP_ATTEMPT:"async"});
    const output=new PassThrough();let transcript="";output.on("data",part=>transcript+=part);
    const result=await runScopedTooling([file],{fixture:true,idleMs:1000,output});
    assert.equal(result.status,1,transcript);assert.equal(result.completedFailures,1,transcript);
    const row=readStepInstrument(frame,"tooling","async")!;
    assert.equal(row.verdict,"FAIL");assert.equal(row.completedFailures,1,transcript);
    assert.match(transcript,rejection?/definite rejection/:/definite uncaught/);
  }
});


test("worker completion requires nonce-bound final failure evidence",()=>{
  const valid={version:2,nonce:"owned",status:1,completedFailures:2};
  assert.deepEqual(readToolingCompletion(valid,"owned",1),{status:1,completedFailures:2});
  assert.deepEqual(readToolingCompletion({...valid,status:0,completedFailures:0},"owned",0),{status:0,completedFailures:0});
  for(const changed of [null,{}, {...valid,version:1},{...valid,nonce:"other"},
      {...valid,completedFailures:undefined},{...valid,completedFailures:-1},
      {...valid,completedFailures:0.5},{...valid,completedFailures:NaN},
      {...valid,completedFailures:Number.MAX_SAFE_INTEGER+1},
      {...valid,status:0},{...valid,status:2}])
    assert.throws(()=>readToolingCompletion(changed,"owned",typeof changed==="object"&&changed!==null&&"status" in changed?Number(changed.status):1),/completion/);
  assert.throws(()=>readToolingCompletion(valid,"owned",0),/completion/);
});

test("scoped runner passes explicit Node preloads into test children",async t=>{
  const directory=mkdtempSync(join(tmpdir(),"tooling-preload-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const preload=join(directory,"preload.mjs"),file=join(directory,"subject.test.mjs");
  writeFileSync(preload,"globalThis.ownedPreload=42;\n");
  writeFileSync(file,"import {test} from 'node:test';import assert from 'node:assert/strict';test('preloaded',()=>assert.equal(globalThis.ownedPreload,42));\n");
  const output=new PassThrough();output.resume();
  const actual=await runScopedTooling([file],{fixture:true,output,execArgv:["--import",pathToFileURL(preload).href]});
  assert.equal(actual.status,0);assert.equal(actual.completedFailures,0);
  const without=await runScopedTooling([file],{fixture:true,output});
  assert.equal(without.status,1);assert.equal(without.completedFailures,1);
});


test("completed failures defined in an imported helper belong to the owning stream",async t=>{
  const directory=mkdtempSync(join(tmpdir(),"tooling-helper-failure-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const helper=join(directory,"helper.mjs"),file=join(directory,"subject.test.mjs");
  writeFileSync(helper,"export async function run(file){await file.test('helper assertion',()=>{throw Error('helper failed')});}\n");
  writeFileSync(file,"import{test}from'node:test';import{run}from'./helper.mjs';test('owner',run);\n");
  const output=new PassThrough();output.resume();
  const result=await runScopedTooling([file],{fixture:true,output});
  assert.equal(result.status,1);assert.equal(result.completedFailures,1);
});


test("worker requests reject malformed files, arguments and idle bounds",()=>{
  const valid={files:["subject.test.ts"],complete:"/owned/complete.json",nonce:"owned"};
  assert.deepEqual(readToolingRequest(valid),valid);
  for(const changed of [null,{}, {...valid,files:[]},{...valid,files:[42]}, {...valid,complete:undefined},
      {...valid,nonce:""},{...valid,idleMs:0},{...valid,idleMs:NaN},{...valid,execArgv:[42]}])
    assert.throws(()=>readToolingRequest(changed),/worker request/);
});

test("test identities retain their entry namespace and reject missing parents",()=>{
  const owners=new ToolingTestOwners(["/owned/a.test.ts","/owned/b.test.ts"]);
  for(const entryFile of ["/owned/a.test.ts","/owned/b.test.ts"]){
    assert.equal(owners.file({entryFile,testId:1,parentId:0,file:"/helpers/shared.ts"}),entryFile);
    assert.equal(owners.file({entryFile,testId:2,parentId:1,file:"/helpers/shared.ts"}),entryFile);
  }
  assert.throws(()=>owners.file({entryFile:"/unowned/test.ts",testId:3,parentId:0}),/unowned entry/);
  assert.throws(()=>owners.file({entryFile:"/owned/a.test.ts",testId:3,parentId:99}),/parent is missing/);
});

test("active imported-helper subtests renew only their own file guard",t=>{
  const directory=mkdtempSync(join(tmpdir(),"tooling-helper-activity-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const helper=join(directory,"helper.mjs"),active=join(directory,"active.test.mjs"),idle=join(directory,"idle.test.mjs"),probe=join(directory,"probe.mjs");
  writeFileSync(helper,"export async function sequence(t){for(let i=0;i<6;i++)await t.test('active helper '+i,()=>{}); }\n");
  writeFileSync(active,"import{test}from'node:test';import{sequence}from'./helper.mjs';test('owner',sequence);\n");
  writeFileSync(idle,"import{test}from'node:test';test('idle',()=>new Promise(()=>{setInterval(()=>{},1000)}));\n");
  const runner=new URL("./tooling-runner.ts",import.meta.url).href;
  writeFileSync(probe,`
import {runTooling} from ${JSON.stringify(runner)};
import {PassThrough} from 'node:stream';
const helper=${JSON.stringify(helper)},active=${JSON.stringify(active)},idle=${JSON.stringify(idle)};
const withIdle=process.argv[2]==='idle';
{
  let now=0,progress=0;const scheduled=[];const output=new PassThrough();output.resume();
  const result=await runTooling(withIdle?[active,idle]:[active],{idleMs:10,output,resultEnv:{},instrument:{
    scheduleIdle(callback,milliseconds,file){const task={at:now+milliseconds,callback,file,cancelled:false};scheduled.push(task);return()=>{task.cancelled=true};},
    event(name,data){if(name==='test:complete'&&data.file===helper){progress++;now+=6;for(const task of [...scheduled])if(!task.cancelled&&task.at<=now){task.cancelled=true;task.callback();}}}
  }});
  console.log(JSON.stringify({withIdle,now,progress,...result}));
}
`);
  const env:NodeJS.ProcessEnv={...process.env};
  for(const key of ["NODE_TEST_CONTEXT","NODE_CHANNEL_FD","NODE_CHANNEL_SERIALIZATION_MODE"])delete env[key];
  const rows=[];let transcript="";
  for(const arg of ["active","idle"]){
    const actual=spawnTest(process.execPath,[probe,arg],{encoding:"utf8",env},"real-stream imported-helper ownership probe");
    assert.equal(actual.status,0,actual.stderr);transcript+=actual.stderr;
    rows.push(JSON.parse(actual.stdout.trim()));
  }
  assert.equal(rows[0].status,0,transcript);assert.equal(rows[0].progress,6);assert.equal(rows[0].now,36);
  assert.equal(rows[1].status,2,transcript);assert.equal(rows[1].completedFailures,0);
  assert.ok(transcript.includes(idle),transcript);
  // One difference: source location is used instead of entry/test ownership.
  const original=readFileSync(new URL("./tooling-runner.ts",import.meta.url),"utf8");
  const expression="const fileOf=(data:TestActivity)=>owners.file(data);";
  assert.ok(original.includes(expression));
  const altered=original.replace(expression,"const fileOf=(data:TestActivity)=>typeof data.file==='string'?resolve(data.file):undefined;")
    .replace(/from (["'])\.\/([^"']+)\1/g,(_whole,_quote,name)=>"from "+JSON.stringify(new URL("./"+name,import.meta.url).href));
  const mutant=join(directory,"source-location-runner.ts"),mutantProbe=join(directory,"mutant-probe.mjs");
  writeFileSync(mutant,altered);writeFileSync(mutantProbe,readFileSync(probe,"utf8").replace(runner,pathToFileURL(mutant).href));
  const changed=spawnTest(process.execPath,[mutantProbe,"active"],{encoding:"utf8",env},"source-location ownership mutant");
  assert.equal(changed.status,0,changed.stderr);const observed=JSON.parse(changed.stdout.trim());
  assert.equal(observed.status,2,"old ownership rule must lose an active helper's progress");
  assert.equal(observed.completedFailures,0);assert.ok(changed.stderr.includes(active),changed.stderr);

});
