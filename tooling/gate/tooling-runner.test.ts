import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {PassThrough} from "node:stream";
import {randomUUID} from "node:crypto";
import {waitFor} from "./test-wait.ts";
import {runScopedTooling} from "./tooling-runner.ts";
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
    assert.equal((await runScopedTooling([file],{fixture:true,output})).status,status);
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
