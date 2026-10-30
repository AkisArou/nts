import assert from "node:assert/strict";
import {test} from "node:test";
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnTest} from "./test-wait.ts";

const ROOT=fileURLToPath(new URL("../../",import.meta.url));
const ACTIVE=new URL("./active-command.ts",import.meta.url).href;
const INTEGRITY=new URL("../conformance/integrity.ts",import.meta.url).href;

function probe(behavior:string,failed=false,entry=INTEGRITY){
  const base=join(homedir(),".cache/nts-scratch");mkdirSync(base,{recursive:true});
  const dir=mkdtempSync(join(base,"integrity-supervision-"));
  try{
    const compiler=join(dir,"nts"),frame=join(dir,"instrument.json");
    writeFileSync(compiler,`#!/usr/bin/env node
const args=process.argv.slice(2),project=args.at(-1);
const body=process.env.CONTROL_FAILED==="1"&&project.endsWith("a-completed")?"  %0 = call absent()\\n":"";
if(args[0]==="hir")process.stdout.write("func control() -> void {\\n"+body+"}\\n\\n1 function(s), nothing refused\\n");
if(project.endsWith("b-pending")&&args[0]==="hir"&&process.env.CONTROL_BEHAVIOR.startsWith("mixed-")){
  if((args[1]==="--prepared")===(process.env.CONTROL_BEHAVIOR==="mixed-hang-first"))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
  else process.kill(process.pid,"SIGTERM");
}
if(project.endsWith("b-pending")&&args[0]==="hir"&&args[1]!=="--prepared"){
  if(["busy","runaway"].includes(process.env.CONTROL_BEHAVIOR)){
    const start=process.cpuUsage();while(process.cpuUsage(start).user+process.cpuUsage(start).system<600000){}
  }else if(process.env.CONTROL_BEHAVIOR==="signal")process.kill(process.pid,"SIGTERM");
  else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
}
`);chmodSync(compiler,0o755);
    const source=`import {mock} from "node:test";
const actual=await import(${JSON.stringify(ACTIVE)});
mock.module(${JSON.stringify(ACTIVE)},{namedExports:{...actual,activeCommand:(command,args,options)=>
  process.env.CONTROL_BEHAVIOR==="spawn-error"?Promise.resolve({status:0,signal:null,stdout:"func control() -> void {\\n}\\n1 function(s), nothing refused\\n",stderr:"",out:"",elapsedMs:0,error:new Error("spawn failed after a tempting listing")}):
  actual.activeCommand(command,args,{...options,idleMs:300,pollMs:10,cpuBudgetSeconds:process.env.CONTROL_BEHAVIOR==="runaway"&&args[0]==="hir"&&args[1]!=="--prepared"&&args.at(-1).endsWith("b-pending")?0.1:5})}});
process.argv=[process.execPath,${JSON.stringify(entry)},"runtime/node/a-completed","runtime/node/b-pending"];
await import(${JSON.stringify(entry)});
`;
    const env:NodeJS.ProcessEnv={...process.env,NTS_BIN:compiler,NTS_INTEGRITY_JOBS:"1",NTS_GATE_COSTS_DIR:join(dir,"costs"),
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
    assert.equal(result.frame.kind,"tooling-setup");assert.equal(result.frame.verdict,"NOT RUN");
    assert.match(result.stdout,/SIGTERM/);assert.match(result.stdout,/NOT RUN \(hung\)/);
    if(failed)assert.match(result.stdout,/call-resolves/);
  });
}
for(const failed of [false,true])test(`integrity publishes CPU-budget evidence after draining completed failures (${failed})`,()=>{
  const result=probe("runaway",failed);assert.equal(result.status,failed?1:124,result.stdout+result.stderr);
  assert.equal(result.frame.kind,"runaway");assert.equal(result.frame.verdict,failed?"FAIL":"NOT RUN");
  assert.equal((result.frame.completedFailures??0)>0,failed);
});
