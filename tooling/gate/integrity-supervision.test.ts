import {testEnvironment} from "./test-environment.ts";
import assert from "node:assert/strict";
import {test} from "node:test";
import {chmodSync,existsSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnTest} from "./test-wait.ts";
import {newTestScratch} from "./test-scratch.ts";

const ROOT=fileURLToPath(new URL("../../",import.meta.url));
const ACTIVE=new URL("./active-command.ts",import.meta.url).href;
const INTEGRITY=new URL("../conformance/integrity.ts",import.meta.url).href;

function probe(behavior:string,failed=false,entry=INTEGRITY){
  const dir=newTestScratch("integrity-supervision");
  try{
    const compiler=join(dir,"nts"),frame=join(dir,"instrument.json");
    writeFileSync(compiler,'#!/bin/sh\nexit 127\n');chmodSync(compiler,0o755);
    const source=`import {mock} from "node:test";
import {scriptedCommand,commandSample} from ${JSON.stringify(new URL('./command-observations-fixture.ts',import.meta.url).href)};
const actual=await import(${JSON.stringify(ACTIVE)});
mock.module(${JSON.stringify(ACTIVE)},{namedExports:{...actual,activeCommand:async(command,args)=>{
  const project=args.at(-1),behavior=process.env.CONTROL_BEHAVIOR;
  const body=process.env.CONTROL_FAILED==='1'&&project.endsWith('a-completed')?'  %0 = call absent()\\n':'';
  const stdout=args[0]==='hir'?'func control() -> void {\\n'+body+'}\\n\\n1 function(s), nothing refused\\n':'';
  if(behavior==='spawn-error')return scriptedCommand(command,{},[],{stdout,error:new Error('spawn failed after a tempting listing')});
  if(project.endsWith('b-pending')&&args[0]==='hir'){
    if(behavior.startsWith('mixed-')){
      if((args[1]==='--prepared')!==(behavior==='mixed-hang-first'))return scriptedCommand(command,{},[],{stdout,status:null,signal:'SIGTERM'});
      return scriptedCommand(command,{idleMs:300},[commandSample(300)],{stdout});
    }
    if(args[1]!=='--prepared'){
      if(behavior==='signal')return scriptedCommand(command,{},[],{stdout,status:null,signal:'SIGTERM'});
      if(behavior==='busy')return scriptedCommand(command,{idleMs:300},[commandSample(9_000_000,{busy:true})],{stdout});
      if(behavior==='runaway')return scriptedCommand(command,{idleMs:300,cpuBudgetSeconds:0.1},[commandSample(300,{cpu:10,busy:true})],{stdout});
      return scriptedCommand(command,{idleMs:300},[commandSample(300)],{stdout});
    }
  }
  return scriptedCommand(command,{},[],{stdout});
}}});
process.argv=[process.execPath,${JSON.stringify(entry)},"runtime/node/a-completed","runtime/node/b-pending"];
await import(${JSON.stringify(entry)});
`;
    const env:NodeJS.ProcessEnv={...testEnvironment(),NTS_BIN:compiler,NTS_INTEGRITY_JOBS:"1",NTS_GATE_COSTS_DIR:join(dir,"costs"),
      CONTROL_FAILED:failed?"1":"0",CONTROL_BEHAVIOR:behavior,
      NTS_GATE_STEP:"integrity",NTS_GATE_STEP_ATTEMPT:"control",NTS_GATE_STEP_RESULT:frame};
    delete env.NTS_INTEGRITY_KEEP;delete env.NTS_GATE_TOKENS;
    const result=spawnTest(process.execPath,["--experimental-test-module-mocks","--input-type=module","-e",source],{cwd:ROOT,env,encoding:"utf8"});
    return {status:result.status,stdout:result.stdout,stderr:result.stderr,frame:existsSync(frame)?JSON.parse(readFileSync(frame,"utf8")):null};
  }finally{rmSync(dir,{recursive:true,force:true});}
}

test("integrity measures a CPU-active listing beyond its inactivity guard",()=>{
  const result=probe("busy");assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(result.frame,null);assert.match(result.stdout,/2 of 2 project\(s\) measured/);
});
test("integrity holds an idle listing even after it printed a valid summary",()=>{
  const result=probe("idle");assert.equal(result.status,124,result.stdout+result.stderr);
  assert.equal(result.frame.kind,"hung");assert.equal(result.frame.verdict,"NOT RUN");
  assert.equal(result.frame.completedFailures??0,0);assert.match(result.stdout,/1 project\(s\) not measured/);
});
test("integrity keeps a completed violation red when another listing hangs",()=>{
  const result=probe("idle",true);assert.equal(result.status,1,result.stdout+result.stderr);
  assert.equal(result.frame.kind,"hung");assert.equal(result.frame.verdict,"FAIL");
  assert.ok(result.frame.completedFailures>0);assert.match(result.stdout,/call-resolves/);
});
test("integrity holds a signalled listing instead of parsing its valid prefix",()=>{
  const result=probe("signal");assert.equal(result.status,124,result.stdout+result.stderr);
  assert.equal(result.frame.kind,"tooling-setup");assert.match(result.stdout,/SIGTERM/);
});
test("integrity holds a spawn error before decoding tempting complete output",()=>{
  const result=probe("spawn-error");assert.equal(result.status,124,result.stdout+result.stderr);
  assert.equal(result.frame.kind,"tooling-setup");assert.match(result.stdout,/spawn failed after a tempting listing/);
});

for(const order of ["mixed-hang-first","mixed-setup-first"]){
  for(const failed of [false,true])test(`integrity retains setup beside hung listings (${order}, completed failure=${failed})`,()=>{
    const result=probe(order,failed);assert.equal(result.status,124,result.stdout+result.stderr);
    assert.equal(result.frame.kind,"tooling-setup");assert.equal(result.frame.verdict,"INSTRUMENT");
    assert.match(result.stdout,/SIGTERM/);assert.match(result.stdout,/NOT RUN \(hung\)/);
    if(failed)assert.match(result.stdout,/call-resolves/);
  });
}
for(const failed of [false,true])test(`integrity publishes CPU-budget evidence after draining completed failures (${failed})`,()=>{
  const result=probe("runaway",failed);assert.equal(result.status,failed?1:124,result.stdout+result.stderr);
  assert.equal(result.frame.kind,"runaway");assert.equal(result.frame.verdict,failed?"FAIL":"NOT RUN");
  assert.equal((result.frame.completedFailures??0)>0,failed);
});
