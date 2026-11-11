import {scriptedCommand,commandSample} from './command-observations-fixture.ts';
import type {CommandSample} from './command-liveness.ts';
import type {ActiveResult} from './active-command.ts';
import {fixtureEnvironment} from "./test-environment.ts";
// A case's bound under the shared supervisor: its compile past its own-CPU
// bound timed out, which is an outcome and never published as a hold; past the
// group's budget, or silent, it measured nothing (active-command.ts,
// case-bound.ts).
//
//   node --test tooling/gate/case-bound.test.ts
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { type activeCommand, COMMAND_CPU_BUDGET_SECONDS, COMPILE_CPU_BOUND_SECONDS } from "./active-command.ts";
import { CASE_TIMEOUT_EXIT, CASE_UNMEASURED_EXIT, parseCaseBound, runCaseBound } from "./case-bound.ts";
import { testScratch } from "./test-scratch.ts";

const observed=(samples:readonly CommandSample[],output:Partial<ActiveResult>={}):typeof activeCommand=>async(command,_args,options)=>{
  assert.equal(options.env.NTS_GATE_STEP_RESULT,undefined,'the case owns its diagnostic frame');
  return scriptedCommand(command,options,samples,output);
};
const bound=(values={})=>({cpuSeconds:60,idleMs:300,command:'compiler',args:[],...values});
const quiet={out:(_text:string)=>{},err:(_text:string)=>{}};

function frame(t: { after: (fn: () => void) => void }) {
  const dir = testScratch(t, "case-bound");
  const path = join(dir, "result.json");
  return { path, env: { ...fixtureEnvironment(t), NTS_GATE_STEP_RESULT: path, NTS_GATE_STEP: "dex", NTS_GATE_STEP_ATTEMPT: "one" },
    read: () => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as { kind: string; verdict: string } : null };
}

test("a compile past its own-CPU bound timed out: stopped, and nothing published for the step", async t => {
  const f=frame(t),err:string[]=[];
  const code=await runCaseBound(bound({ownCpuSeconds:0.3}),f.env,{...quiet,err:text=>err.push(text)},observed([commandSample(300,{own:30,busy:true})]));
  assert.equal(code,CASE_TIMEOUT_EXIT);assert.match(err.join(''),/used its 0\.3 s CPU bound: its own CPU reached/);
  assert.equal(f.read(),null,'a timeout is the case outcome, not a hold');
  assert.ok(COMPILE_CPU_BOUND_SECONDS===600&&COMPILE_CPU_BOUND_SECONDS<COMMAND_CPU_BUDGET_SECONDS);
});

test("the bound is the command's own CPU: a child's CPU reaches only the group's budget, which is unmeasured", async t => {
  const f=frame(t);
  const code=await runCaseBound(bound({ownCpuSeconds:0.3,cpuSeconds:1}),f.env,quiet,observed([commandSample(300,{cpu:100,own:0,busy:true,processOwn:{pid:71,cpu:100}})]));
  assert.equal(code,CASE_UNMEASURED_EXIT);assert.equal(f.read()?.kind,'runaway');
});

test("a build bounds each process's own CPU, so a waiting driver cannot hide a spinning linker", async t => {
  const f=frame(t),err:string[]=[];
  const code=await runCaseBound(bound({eachProcessCpuSeconds:0.3}),f.env,{...quiet,err:text=>err.push(text)},observed([commandSample(300,{cpu:30,own:0,busy:true,processOwn:{pid:71,cpu:30}})]));
  assert.equal(code,CASE_TIMEOUT_EXIT);assert.match(err.join(''),/used its 0\.3 s CPU bound: process 71 own CPU reached/);
  assert.equal(f.read(),null,'a build timeout is a recorded case failure, never a step hold');
});

test("the build bound does not add together different processes' own CPU", async t => {
  const f=frame(t);
  const code=await runCaseBound(bound({eachProcessCpuSeconds:0.3}),f.env,quiet,observed([commandSample(300,{cpu:60,own:0,busy:true,processOwn:{pid:71,cpu:20}})]));
  assert.equal(code,0);assert.equal(f.read(),null);
});

test("the helper's exits: the command's own, 125 for a timeout, 124 for what it could not measure", async t => {
  const out:string[]=[],err:string[]=[],write={out:(text:string)=>out.push(text),err:(text:string)=>err.push(text)},f=frame(t);
  assert.equal(await runCaseBound(bound(),f.env,write,observed([],{status:3,stdout:'said\n'})),3);
  assert.deepEqual(out,['said\n']);
  assert.equal(await runCaseBound(bound(),f.env,write,observed([],{status:null,signal:'SIGTERM'})),128+15);
  assert.equal(await runCaseBound(bound({ownCpuSeconds:0.3}),f.env,write,observed([commandSample(300,{own:30})])),CASE_TIMEOUT_EXIT);
  assert.match(err.at(-1)!,/^timed out: .*used its 0\.3 s CPU bound/);assert.equal(f.read(),null);
  assert.equal(await runCaseBound(bound(),f.env,write,observed([commandSample(300)])),CASE_UNMEASURED_EXIT);
  assert.deepEqual([f.read()?.kind,f.read()?.verdict],['hung','NOT RUN']);
  assert.equal(await runCaseBound(bound(),f.env,write,observed([],{error:new Error('missing executable')})),CASE_UNMEASURED_EXIT);
  assert.deepEqual([f.read()?.kind,f.read()?.verdict],['tooling-setup','INSTRUMENT']);
});

test("the helper's arguments", () => {
  assert.deepEqual(parseCaseBound(["--compile", "--", "nts", "emit-jvm", "x"]),
    { ownCpuSeconds: COMPILE_CPU_BOUND_SECONDS, cpuSeconds: COMMAND_CPU_BUDGET_SECONDS, idleMs: 5 * 60_000, command: "nts", args: ["emit-jvm", "x"] });
  assert.deepEqual(parseCaseBound(["--build", "--", "clang++", "a.o"]),
    { eachProcessCpuSeconds: COMPILE_CPU_BOUND_SECONDS, cpuSeconds: COMMAND_CPU_BUDGET_SECONDS, idleMs: 5 * 60_000, command: "clang++", args: ["a.o"] });
  assert.deepEqual(parseCaseBound(["--cpu", "14400", "--idle", "1800", "--", "node", "r.ts"]),
    { cpuSeconds: 14400, idleMs: 1_800_000, command: "node", args: ["r.ts"] });
  for (const bad of [[], ["--", ], ["nts"], ["--cpu", "0", "--", "x"], ["--idle", "soon", "--", "x"], ["--wall", "1", "--", "x"]]) {
    assert.throws(() => parseCaseBound(bad));
  }
});

test("supervisor receipts start on their own line after unterminated tool stderr",async t=>{
  const f=frame(t);
  for(const mode of ['spin','idle']){
    const err:string[]=[];
    const run=observed([commandSample(300,{own:mode==='spin'?30:0})],{stderr:'partial diagnostic'});
    const code=await runCaseBound(bound({ownCpuSeconds:0.3}),f.env,{...quiet,err:text=>err.push(text)},run);
    assert.equal(code,mode==='spin'?CASE_TIMEOUT_EXIT:CASE_UNMEASURED_EXIT);
    assert.match(err.join(''),mode==='spin'?/partial diagnostic\ntimed out: /:/partial diagnostic\nnot measured: /);
  }
});

test("supervisor receipts remain anchored after unterminated stdout in merged shell output", t => {
  const f=frame(t),env={...f.env};
  for(const key of ["NODE_TEST_CONTEXT","NODE_CHANNEL_FD","NODE_CHANNEL_SERIALIZATION_MODE"])delete env[key];
  for(const mode of ["spin","idle"]) {
    const fixtureModule=new URL('./command-observations-fixture.ts',import.meta.url).href;
    const options=bound({ownCpuSeconds:0.3});
    const script=`import {runCaseBound} from ${JSON.stringify(new URL('./case-bound.ts',import.meta.url).href)};
import {scriptedCommand,commandSample} from ${JSON.stringify(fixtureModule)};
const run=async(command,args,options)=>scriptedCommand(command,options,[commandSample(300,{own:${mode==='spin'?30:0}})],{stdout:'partial stdout'});
process.exitCode=await runCaseBound(${JSON.stringify(options)},process.env,undefined,run);`;
    const result=spawnSync("sh",["-c",'exec "$@" 2>&1',"merged-bound",process.execPath,"--input-type=module","-e",script],{env,encoding:"utf8"});
    assert.equal(result.status,mode==="spin"?CASE_TIMEOUT_EXIT:CASE_UNMEASURED_EXIT,result.stdout+result.stderr);
    assert.equal(result.stderr,"");
    assert.match(result.stdout,mode==="spin"?/partial stdout\ntimed out: /:/partial stdout\nnot measured: /);
  }
});
