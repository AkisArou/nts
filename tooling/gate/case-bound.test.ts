import {testEnvironment} from "./test-environment.ts";
// A case's bound under the shared supervisor: its compile past its own-CPU
// bound timed out, which is an outcome and never published as a hold; past the
// group's budget, or silent, it measured nothing (active-command.ts,
// case-bound.ts).
//
//   node --test tooling/gate/case-bound.test.ts
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { activeCommand, COMMAND_CPU_BUDGET_SECONDS, COMPILE_CPU_BOUND_SECONDS } from "./active-command.ts";
import { CASE_TIMEOUT_EXIT, CASE_UNMEASURED_EXIT, parseCaseBound, runCaseBound } from "./case-bound.ts";
import { testScratch } from "./test-scratch.ts";

const spin = [process.execPath, ["-e", "for(;;){}"]] as const;
// The parent only waits: the CPU is its child's.
const spinningChild = [process.execPath, ["-e", "require('node:child_process').spawn(process.execPath,['-e','for(;;){}'],{stdio:'inherit'})"]] as const;

function frame(t: { after: (fn: () => void) => void }) {
  const dir = testScratch(t, "case-bound");
  const path = join(dir, "result.json");
  return { path, env: { ...testEnvironment(), NTS_GATE_STEP_RESULT: path, NTS_GATE_STEP: "dex", NTS_GATE_STEP_ATTEMPT: "one" },
    read: () => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as { kind: string; verdict: string } : null };
}

test("a compile past its own-CPU bound timed out: stopped, and nothing published for the step", async t => {
  const f = frame(t);
  const result = await activeCommand(spin[0], [...spin[1]], { cwd: process.cwd(), env: f.env, ownCpuSeconds: 0.3, pollMs: 20 });
  assert.match(result.timeout ?? "", /used its 0\.3 s CPU bound: its own CPU reached/);
  assert.equal(result.runaway, undefined);
  assert.equal(result.signal, "SIGKILL");
  assert.equal(f.read(), null, "a timeout is the case's outcome, not a hold");
  assert.ok(COMPILE_CPU_BOUND_SECONDS === 600 && COMPILE_CPU_BOUND_SECONDS < COMMAND_CPU_BUDGET_SECONDS);
});

test("the bound is the command's own CPU: a child's CPU reaches only the group's budget, which is unmeasured", async t => {
  const f = frame(t);
  const result = await activeCommand(spinningChild[0], [...spinningChild[1]], { cwd: process.cwd(), env: f.env, ownCpuSeconds: 0.3, cpuBudgetSeconds: 1, pollMs: 20 });
  assert.equal(result.timeout, undefined);
  assert.match(result.runaway ?? "", /reached its 1 s budget/);
  assert.equal(f.read()?.kind, "runaway");
});

test("a build bounds each process's own CPU, so a waiting driver cannot hide a spinning linker", async t => {
  const f = frame(t);
  const result = await activeCommand(spinningChild[0], [...spinningChild[1]], { cwd: process.cwd(), env: f.env, eachProcessCpuSeconds: 0.3, cpuBudgetSeconds: 60, pollMs: 20 });
  assert.match(result.timeout ?? "", /used its 0\.3 s CPU bound: process \d+ own CPU reached/);
  assert.equal(result.runaway, undefined);
  assert.equal(result.signal, "SIGKILL");
  assert.equal(f.read(), null, "a build timeout is a recorded case failure, never a step hold");
});

test("the build bound does not add together different processes' own CPU", async t => {
  const f = frame(t);
  const worker="import time\nstart=time.process_time()\nwhile time.process_time()-start<0.2: pass";
  const driver=`import subprocess\nchildren=[subprocess.Popen(['python3','-c',${JSON.stringify(worker)}]) for _ in range(3)]\nfor child in children: assert child.wait()==0`;
  const result = await activeCommand("python3", ["-c",driver], {cwd:process.cwd(),env:f.env,eachProcessCpuSeconds:0.3,pollMs:20});
  assert.equal(result.status,0,result.out);
  assert.equal(result.timeout,undefined);
  assert.equal(f.read(),null);
});

test("the helper's exits: the command's own, 125 for a timeout, 124 for what it could not measure", async t => {
  const out: string[] = [], err: string[] = [];
  const write = { out: (text: string) => { out.push(text); }, err: (text: string) => { err.push(text); } };
  const f = frame(t);
  assert.equal(await runCaseBound({ cpuSeconds: 60, idleMs: 60_000, command: "sh", args: ["-c", "echo said; exit 3"] }, f.env, write), 3);
  assert.deepEqual(out, ["said\n"]);
  assert.equal(await runCaseBound({ cpuSeconds: 60, idleMs: 60_000, command: "sh", args: ["-c", "kill -TERM $$"] }, f.env, write), 128 + 15);
  assert.equal(await runCaseBound({ ownCpuSeconds: 0.3, cpuSeconds: 60, idleMs: 60_000, command: spin[0], args: [...spin[1]] }, f.env, write), CASE_TIMEOUT_EXIT);
  assert.match(err.at(-1)!, /^timed out: .*used its 0\.3 s CPU bound/);
  assert.equal(f.read(), null, "the timeout published nothing");
  assert.equal(await runCaseBound({ cpuSeconds: 60, idleMs: 500, command: "tail", args: ["-f", "/dev/null"] }, f.env, write), CASE_UNMEASURED_EXIT);
  assert.deepEqual([f.read()?.kind, f.read()?.verdict], ["hung", "NOT RUN"]);
  assert.equal(await runCaseBound({ cpuSeconds: 60, idleMs: 60_000, command: join(tmpdir(), "no-such-command-of-case-bound"), args: [] }, f.env, write), CASE_UNMEASURED_EXIT);
  assert.deepEqual([f.read()?.kind, f.read()?.verdict], ["tooling-setup", "INSTRUMENT"]);
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

test("supervisor receipts start on their own line after unterminated tool stderr", async t => {
  const f=frame(t);
  for(const mode of ["spin","idle"]) {
    const err:string[]=[];
    const body="process.stderr.write('partial diagnostic');"+(mode==="spin"?"for(;;){}":"Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)");
    const code=await runCaseBound({ownCpuSeconds:0.3,cpuSeconds:60,idleMs:200,command:process.execPath,args:["-e",body]},f.env,
      {out:()=>{},err:text=>{err.push(text);}});
    assert.equal(code,mode==="spin"?CASE_TIMEOUT_EXIT:CASE_UNMEASURED_EXIT);
    assert.match(err.join(""),mode==="spin"?/partial diagnostic\ntimed out: /:/partial diagnostic\nnot measured: /);
  }
});

test("supervisor receipts remain anchored after unterminated stdout in merged shell output", t => {
  const f=frame(t),env={...f.env};
  for(const key of ["NODE_TEST_CONTEXT","NODE_CHANNEL_FD","NODE_CHANNEL_SERIALIZATION_MODE"])delete env[key];
  for(const mode of ["spin","idle"]) {
    const body="process.stdout.write('partial stdout');"+(mode==="spin"?"for(;;){}":"Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)");
    const bound={ownCpuSeconds:0.3,cpuSeconds:60,idleMs:200,command:process.execPath,args:["-e",body]};
    const script=`import {runCaseBound} from ${JSON.stringify(new URL("./case-bound.ts",import.meta.url).href)};process.exitCode=await runCaseBound(${JSON.stringify(bound)});`;
    const result=spawnSync("sh",["-c",'exec "$@" 2>&1',"merged-bound",process.execPath,"--input-type=module","-e",script],{env,encoding:"utf8"});
    assert.equal(result.status,mode==="spin"?CASE_TIMEOUT_EXIT:CASE_UNMEASURED_EXIT,result.stdout+result.stderr);
    assert.equal(result.stderr,"");
    assert.match(result.stdout,mode==="spin"?/partial stdout\ntimed out: /:/partial stdout\nnot measured: /);
  }
});
