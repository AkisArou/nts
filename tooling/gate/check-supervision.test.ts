import assert from "node:assert/strict";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import type {TestContext} from "node:test";
import type {ActiveResult} from "./active-command.ts";
import type {CheckRunner, CheckCommandResult} from "../differential/check-report-types.ts";
import {runConsumer} from "../differential/check-report.ts";
import {CaseBudgetError, readStepInstrument, ToolingInstrumentError} from "./step-result.ts";

const HELP = "  check        compile, run, and compare against node (--json)\n";
const AGREES = JSON.stringify({version: 1, status: "agrees",
  counts: {functions: 1, expected: 1, compared: 1, unavailable: 0, runtime_declined: 0,
    timeouts: 0, approximated: 0, disagreements: 0, aborts: 0},
  oracle: {expected: 1, received: 1, complete: true}, refusals: [], disagreements: [], aborts: [], error: null});

function fixture(t: TestContext) {
  const cache = join(homedir(), ".cache/nts-check-supervision-tests"); mkdirSync(cache, {recursive: true});
  const root = mkdtempSync(join(cache, "run-")); t.after(() => rmSync(root, {recursive: true, force: true}));
  const env = {...process.env, NTS_GATE_STEP: "examples", NTS_GATE_STEP_ATTEMPT: "supervision",
    NTS_GATE_STEP_RESULT: join(root, "result.json")};
  return {root, env, frame: () => readStepInstrument(env.NTS_GATE_STEP_RESULT, env.NTS_GATE_STEP, env.NTS_GATE_STEP_ATTEMPT)};
}
const completed = (stdout: string): ActiveResult => ({status: 0, signal: null, stdout, stderr: "", out: stdout, elapsedMs: 1});
function standIn(result: CheckCommandResult): CheckRunner {
  return async (_binary, args, options) => {
    assert.equal(options.maxBuffer, args[0] === "--help" ? 1024 * 1024 : 64 * 1024 * 1024);
    return args[0] === "--help" ? completed(HELP) : result;
  };
}

test("tempting agree JSON after timeout, spawn error or signal is an instrument hold", async t => {
  const f = fixture(t);
  const cases: Partial<ActiveResult>[] = [
    {error: Object.assign(new Error("timed out"), {code: "ETIMEDOUT"})},
    {error: Object.assign(new Error("missing executable"), {code: "ENOENT"})},
    {signal: "SIGTERM", status: null},
  ];
  for (const result of cases) {
    await assert.rejects(runConsumer("/stand-in", "/project", "program", {
      cwd: f.root, env: f.env, run: standIn({...completed(AGREES), ...result}),
    }), ToolingInstrumentError);
    assert.equal(f.frame()?.kind, "tooling-setup"); assert.equal(f.frame()?.verdict, "INSTRUMENT");
  }
});

test("malformed advertised JSON and liveness observations never reach a verdict", async t => {
  const f = fixture(t);
  await assert.rejects(runConsumer("/stand-in", "/project", "program", {
    cwd: f.root, env: f.env, run: standIn(completed("{")),
  }), ToolingInstrumentError);
  assert.equal(f.frame()?.kind, "tooling-setup");
  for (const observation of [{hung: "idle check"}, {runaway: "CPU budget"}]) {
    await assert.rejects(runConsumer("/stand-in", "/project", "program", {
      cwd: f.root, env: f.env, run: standIn({...completed(AGREES), ...observation}),
    }));
    assert.equal(f.frame()?.verdict, "NOT RUN");
    assert.equal(f.frame()?.kind, "hung" in observation ? "hung" : "runaway");
  }
});

test("resident kills precede tempting completed typecheck reports", async t => {
  const f = fixture(t);
  const refused = JSON.stringify({version: 1, status: "error", counts: null, oracle: null,
    refusals: [{stage: "typecheck", code: "TS2322", message: "tempting refusal"}],
    disagreements: [], aborts: [], error: {kind: "typecheck", source: null, message: "source rejected"}});
  await assert.rejects(runConsumer("/stand-in", "/project", "refusal", {cwd: f.root, env: f.env,
    run: standIn({...completed(refused), status: 137, memoryKilled: true}),
  }), ToolingInstrumentError);
  assert.equal(f.frame()?.kind, "tooling-setup");
  await assert.rejects(runConsumer("/stand-in", "/project", "refusal", {cwd: f.root, env: f.env,
    run: standIn({...completed(refused), status: 137, memoryKilled: true,
      residentLimitBytes: 64 * 2 ** 20, residentRunBytes: 2 ** 30}),
  }), CaseBudgetError);
  assert.equal(f.frame()?.kind, "case-budget"); assert.equal(f.frame()?.verdict, "FAIL");
});

function compiler(f: ReturnType<typeof fixture>, body: string): string {
  const path = join(f.root, "compiler.mjs");
  writeFileSync(path, `#!${process.execPath}\nif(process.argv.includes('--help')){process.stdout.write(${JSON.stringify(HELP)});process.exit(0);}\n${body}\n`, {mode: 0o755});
  return path;
}

test("a real compiler child killed after valid JSON is held", async t => {
  const f = fixture(t);
  const binary = compiler(f, `process.stdout.write(${JSON.stringify(AGREES)});process.kill(process.pid,'SIGTERM');`);
  await assert.rejects(runConsumer(binary, "/project", "program", {cwd: f.root, env: f.env}), ToolingInstrumentError);
  assert.equal(f.frame()?.kind, "tooling-setup");
});

test("CPU-active check work can pass beyond a small inactivity guard", async t => {
  const f = fixture(t), release = join(f.root, "release");
  const binary = compiler(f, `import {existsSync} from 'node:fs';while(!existsSync(${JSON.stringify(release)})){};process.stdout.write(${JSON.stringify(AGREES)});`);
  const result = await runConsumer(binary, "/project", "program", {cwd: f.root, env: f.env,
    idleMs: 1000, pollMs: 50, cpuBudgetSeconds: 10,
    onActivity(event) { if (event.elapsedMs > 2000) writeFileSync(release, "complete"); },
  });
  assert.equal(result.exitCode, 0); assert.equal(result.record.outcome, "agrees");
  assert.equal(f.frame(), undefined);
});

test("refusal-only controls observe completed lowering without claiming an oracle comparison", async t => {
  const f = fixture(t);
  const report = {version:1,status:'error',counts:null,oracle:null,
    refusals:[{stage:'lowering',code:'NTS1001',message:'unsupported source construct'}],
    disagreements:[],aborts:[],error:{kind:'oracle_coverage',source:'tests/programs/unsupported/src/main.ts',message:'not an oracle fixture'}};
  const result = {...completed(JSON.stringify(report)),status:1};
  const observed = await runConsumer('/stand-in','/project','refusal',{cwd:f.root,env:f.env,run:standIn(result)});
  assert.equal(observed.exitCode,0);assert.equal(observed.incomplete,undefined);
  assert.equal(observed.record.checked,0);assert.equal(observed.record.outcome,'not measured');
  assert.equal(f.frame(),undefined,'a completed refusal-only observation publishes no comparison-success or hold frame');
  for(const consumer of ['program','benchmark'] as const) {
    await assert.rejects(runConsumer('/stand-in','/project',consumer,{cwd:f.root,env:f.env,run:standIn(result)}),ToolingInstrumentError);
    assert.equal(f.frame()?.kind,'tooling-setup');
  }
  for (const contradiction of [
    {...report, disagreements:[{compiled:'wrong',node:'right'}]},
    {...report, aborts:['unexpected native abort']},
  ]) {
    await assert.rejects(runConsumer('/stand-in','/project','refusal',{
      cwd:f.root,env:f.env,run:standIn({...result,stdout:JSON.stringify(contradiction)}),
    }),ToolingInstrumentError);
    assert.equal(f.frame()?.kind,'tooling-setup');
  }
  report.error.kind='oracle_execution';
  await assert.rejects(runConsumer('/stand-in','/project','refusal',{cwd:f.root,env:f.env,run:standIn({...result,stdout:JSON.stringify(report)})}),ToolingInstrumentError);
  for(const failure of [{signal:'SIGTERM' as const,status:null},{error:new Error('spawn failed')}]) {
    await assert.rejects(runConsumer('/stand-in','/project','refusal',{cwd:f.root,env:f.env,run:standIn({...result,...failure})}),ToolingInstrumentError);
  }
});
