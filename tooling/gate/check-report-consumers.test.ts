import assert from "node:assert/strict";
import {spawnTest} from "./test-wait.ts";
import {existsSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import {copyModuleClosure} from "./module-closure-fixture.ts";

const source = dirname(fileURLToPath(import.meta.url));

function sandbox(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "nts-check-consumers-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ["tooling/gate", "tooling/jvm", "tooling/differential", "tooling/conformance", "tooling/sweep", "tooling/npm-survey", "tooling/records", "tooling/bench", "tooling/census",
    "tooling/conformance/web-platform/compiled", "tests/programs/control",
    "tests/programs/invalid", "tests/programs/unsupported", "benchmarks/cases/control"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  for (const script of ["gate.sh", "rc.sh", "bench-agree.sh", "declines.sh"]) {
    copyFileSync(join(source, script), join(root, "tooling/gate", script));
  }
  copyFileSync(join(source, "../jvm/agrees-with-c.sh"), join(root, "tooling/jvm/agrees-with-c.sh"));
  copyModuleClosure([
    "tooling/differential/check-consumers.ts", "tooling/differential/oracle-toolchain.json",
    "tooling/conformance/pin.ts", "tooling/npm-survey/verdict.ts",
  ], root);
  // Package imports use the same provisioned toolchain as the real entry.
  symlinkSync(join(source, "../../node_modules"), join(root, "node_modules"));
  copyFileSync(join(source, "../sweep/run.sh"), join(root, "tooling/sweep/run.sh"));
  copyFileSync(join(source, "../conformance/web-platform/compiled/check.sh"), join(root, "tooling/conformance/web-platform/compiled/check.sh"));
  writeFileSync(join(root, "tooling/gate/tokens.mjs"), "export async function withToken(fn) { return fn(); }\n");
  writeFileSync(join(root, "tooling/sweep/sweep.mjs"), "console.log('export function work(n: number): number { return n; }');\n");
  writeFileSync(join(root, "tooling/conformance/web-platform/compiled/tsconfig.json"), "{}");
  writeFileSync(join(root, "tooling/gate/token.sh"), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
  for (const name of ["control", "invalid", "unsupported"]) {
    writeFileSync(join(root, "tests/programs", name, "tsconfig.json"), "{}");
  }
  writeFileSync(join(root, "benchmarks/cases/control/case.ts"), "export function work(n: number): number { return n; }");
  const compiler = join(root, "compiler.mjs");
  writeFileSync(compiler, `#!/usr/bin/env node
import {basename, dirname} from 'node:path';
if (process.argv.includes('--help')) {
  console.log('  check        compile, run, and compare against node (--json)'); process.exit(0);
}

if (!process.argv.includes('--json')) { console.error('JSON interface required'); process.exit(78); }
const name = basename(dirname(process.argv[3]));
if (process.env.CHECK_MUTATION === 'spin' && name === 'spin') for (;;) {}
const report = {version:1,status:'agrees',counts:{functions:1,expected:2,compared:2,unavailable:0,
  runtime_declined:0,timeouts:0,approximated:0,disagreements:0,aborts:0},
  oracle:{expected:2,received:2,complete:true},refusals:[],disagreements:[],aborts:[],error:null};
let status = 0;
if (name === 'invalid') {
  report.status='error'; report.counts=null; report.oracle=null;
  report.error={kind:'typecheck',source:null,message:'wording unrelated to the verdict'};
  report.refusals=[{stage:'typecheck',code:'TS2322',message:'invalid input'}]; status=1;
} else if (name === 'unsupported') {
  report.status='nothing'; Object.assign(report.counts,{functions:0,expected:0,compared:0});
  report.oracle={expected:0,received:0,complete:true};
  report.refusals=[{stage:'lowering',code:'NTS1001',message:'unsupported input'}];
} else if (process.env.CHECK_MUTATION?.startsWith('supervisor-')) {
  const mode=process.env.CHECK_MUTATION;
  report.version=2;report.status='not_measured';status=1;
  report.incomplete=[{kind:mode==='supervisor-runaway'?'runaway':'hung',reason:'owned compiled child stopped',case_index:mode==='supervisor-cleanup'?null:1}];
  if(mode!=='supervisor-cleanup') {report.counts.compared=1;report.counts.timeouts=1;}
  if(mode==='supervisor-wrong-hung') {
    report.status='disagrees';report.counts.disagreements=1;
    report.disagreements=[{compiled:'f 0 1',node:'f 0 2'}];
  }
} else if (process.env.CHECK_MUTATION === 'pending' && name === 'control') {
  report.status='pending'; report.counts=null; report.oracle=null;
} else if (process.env.CHECK_MUTATION === 'oracle-budget') {
  report.version=3; report.status='error'; report.counts=null; report.oracle=null; report.incomplete=[]; status=1;
  report.error={kind:'oracle_budget',source:'benchmarks/cases/control/case.ts',message:'ORACLE BUDGET: timeout at 60 CPU-s',
    budget:{recorded:true,value:{phase:'execute',outcome:'timeout',bound:60,signal:'SIGKILL',reason:'oracle timed out'}}};
} else if (process.env.CHECK_MUTATION === 'unavailable') {
  report.status='all_unavailable'; report.counts.compared=0; report.counts.unavailable=2;
} else if (process.env.CHECK_MUTATION === 'contradiction') {
  report.counts.compared=0; report.counts.runtime_declined=2;
} else if (process.env.CHECK_MUTATION === 'backend-refusal') {
  report.status='error'; report.counts=null; report.oracle=null;
  report.error={kind:'backend_declined',source:null,message:'backend unavailable'};
  report.refusals=[{stage:'backend',code:'NTS4009',message:'reason from the structured field'}]; status=1;
} else if (process.env.CHECK_MUTATION === 'runtime-decline') {
  report.status='all_declined'; report.counts.compared=0; report.counts.runtime_declined=2; status=1;
} else if (['wrong','wrong-jvm'].includes(process.env.CHECK_MUTATION)) {
  report.status='disagrees'; report.counts.disagreements=1;
  const changed=process.env.CHECK_MUTATION==='wrong-jvm' && process.env.NTS_BACKEND==='jvm';
  report.disagreements=[{compiled:'control at 0 '+(changed?'different':'same'),node:'node answer'}]; status=1;
} else if (process.env.CHECK_MUTATION === 'mixed' && name === 'control') {
  report.status='disagrees'; report.counts.disagreements=1;
  report.disagreements=[{compiled:'control at 0 wrong',node:'control at 0 right'}]; status=1;
} else if (process.env.CHECK_MUTATION === 'lowering-refusal') {
  report.status='all_unavailable'; report.counts.compared=0; report.counts.unavailable=2;
  report.refusals=[{stage:'lowering',code:'NTS1001',message:'source construct from a field'}];
} else if (process.env.CHECK_MUTATION === 'typecheck') {
  report.status='error'; report.counts=null; report.oracle=null;
  report.refusals=[{stage:'typecheck',code:'TS2304',message:'source type error from a field'}];
  report.error={kind:'typecheck',source:null,message:'source rejected'}; status=1;
}
console.error('  nts  decoy text answer');
console.error('  not emitted: NTS4999 decoy text refusal');
if (process.env.CHECK_MUTATION === 'legacy-text') console.log('checked 2 cases across 1 function(s)\\nagreed on every case');
else console.log(JSON.stringify(report));
if ((process.env.CHECK_MUTATION === 'hang-after-output' && name === 'control') ||
    (process.env.CHECK_MUTATION === 'mixed' && name === 'hang')) {
  setInterval(()=>{},10000); await new Promise(()=>{});
}
process.exit(status);
`, { mode: 0o755 });
  return { root, compiler };
}

test("a named program disagreement stays loud and cannot accept another fixture or failure kind", t => {
  const {root, compiler} = sandbox(t);
  const known = join(root, "tests/programs/typed-array-aliasing");
  mkdirSync(known);writeFileSync(join(known, "tsconfig.json"), "{}");
  const run = (mode: string, name: string, mutation: string) => spawnTest("sh", [join(root, `tooling/gate/${mode}.sh`), name], {
    cwd: root, encoding: "utf8", env: {...process.env, NTS_GATE_STEP_RESULT: "", NTS_BIN: compiler, CHECK_MUTATION: mutation},
  });
  for (const mode of ["gate", "rc"]) {
    const accepted = run(mode, "typed-array-aliasing", "wrong");
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    assert.match(accepted.stdout, /DIS  typed-array-aliasing: disagrees/);
    assert.match(accepted.stdout, /allowed disagreement typed-array-aliasing: node 26 answers 302/);
    const other = run(mode, "control", "wrong");assert.equal(other.status, 1, other.stdout + other.stderr);
    const typecheck = run(mode, "typed-array-aliasing", "typecheck");assert.equal(typecheck.status, 1, typecheck.stdout + typecheck.stderr);
  }
});

test("declines.sh reads backend-stage fields and keeps runtime declines separate", t => {
  const {root, compiler} = sandbox(t);
  const run = (mutation: string) => spawnTest("sh", [join(root, "tooling/gate/declines.sh")], {
    cwd: root, encoding: "utf8", 
    env: {...process.env, NTS_GATE_STEP_RESULT: "", NTS_BIN: compiler, CHECK_MUTATION: mutation},
  });
  const refused = run("backend-refusal");
  assert.equal(refused.status, 0, refused.stdout + refused.stderr);
  assert.match(refused.stdout, /NTS4009 reason from the structured field/);
  assert.doesNotMatch(refused.stdout, /decoy/);
  const declined = run("runtime-decline");
  assert.equal(declined.status, 0, declined.stdout + declined.stderr);
  assert.equal(declined.stdout, "");
  for (const mutation of ["legacy-text", "contradiction"]) {
    const result = run(mutation);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
  }
});

test("agrees-with-c.sh compares structured compiled answers and rejects answer mutations", t => {
  const {root, compiler} = sandbox(t);
  const run = (mutation: string) => spawnTest("sh", [join(root, "tooling/jvm/agrees-with-c.sh"),
    join(root, "tests/programs/control/tsconfig.json")], {
    cwd: root, encoding: "utf8", 
    env: {...process.env, NTS_GATE_STEP_RESULT: "", NTS_BIN: compiler, CHECK_MUTATION: mutation},
  });
  const control = run("wrong");
  assert.equal(control.status, 0, control.stdout + control.stderr);
  assert.match(control.stdout, /C answered 1 case\(s\).*JVM 1/);
  for (const mutation of ["wrong-jvm", "legacy-text", "contradiction", ""]) {
    const result = run(mutation);
    assert.notEqual(result.status, 0, `${mutation}: ${result.stdout}${result.stderr}`);
  }
});

for (const script of ["gate.sh", "rc.sh"]) {
  test(`${script} reads structured dispositions and refuses text/field mutations`, (t) => {
    const { root, compiler } = sandbox(t);
    const run = (mutation = "") => spawnTest(script === "rc.sh" ? "bash" : "sh",
      [join(root, "tooling/gate", script)], {
        cwd: root, encoding: "utf8", 
        env: { ...process.env, NTS_GATE_STEP_RESULT: "", NTS_BIN: compiler, NTS_GATE_JOBS: "1", CHECK_MUTATION: mutation },
      });
    const control = run();
    assert.equal(control.status, 0, control.stdout + control.stderr);
    for (const mutation of ["legacy-text", "contradiction"]) {
      const changed = run(mutation);
      assert.notEqual(changed.status, 0, `${mutation}: ${changed.stdout}${changed.stderr}`);
    }
    const unavailable = run("unavailable");
    assert.match(unavailable.stdout, /no compiled bindings were available/);
    assert.notEqual(unavailable.status, 0, "a corpus with no compared example cannot pass");
  });
}

test("bench-agree.sh holds each benchmark to its run record: what reproduces passes, a loud defect included; worse is red; no row is pending", t => {
  const { root, compiler } = sandbox(t);
  const file = join(root, "results/benchmarks/jvm/runs.tsv");
  const header = `# nts-benchmark-runs {"version":1,"backend":"jvm","commit":"${"a".repeat(40)}","compiler":"${"b".repeat(16)}","under":"benchmarks/cases"}\n`;
  const record = (outcome: object) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${header}benchmarks/cases/control\t${JSON.stringify(outcome)}\n`); };
  const run = (mutation = "", ...args: string[]) => spawnTest("sh", [join(root, "tooling/gate/bench-agree.sh"), ...args], { cwd: root, encoding: "utf8",
    env: { ...process.env, NTS_GATE_STEP_RESULT: "", NTS_BIN: compiler, NTS_GATE_JOBS: "1", CHECK_MUTATION: mutation } });
  // No record yet: every benchmark is pending, listed, and not run.
  const pending = run("wrong");
  assert.equal(pending.status, 0, pending.stdout + pending.stderr);
  assert.match(pending.stdout, /pending: benchmarks\/cases\/control is not recorded in results\/benchmarks\/jvm\/runs\.tsv yet/);
  record({ kind: "agrees" });
  const holds = run(); assert.equal(holds.status, 0, holds.stdout + holds.stderr); assert.match(holds.stdout, /1 as recorded/);
  const originalBudgetRecord = readFileSync(file, 'utf8');
  const budget = run('oracle-budget');
  assert.equal(budget.status, 0, budget.stdout + budget.stderr);
  assert.match(budget.stdout, /^ORACLE BUDGET benchmarks\/cases\/control: ORACLE BUDGET: timeout at 60 CPU-s$/m);
  assert.match(budget.stdout, /0 as recorded, 0 accepted, 0 changed/);
  assert.doesNotMatch(budget.stdout, /pending:/);
  assert.equal(readFileSync(file, 'utf8'), originalBudgetRecord, 'no native run is invented for an oracle budget');
  for (const mutation of ["legacy-text", "contradiction"]) assert.notEqual(run(mutation).status, 0, mutation);
  const worse = run("runtime-decline");
  assert.equal(worse.status, 1, worse.stdout + worse.stderr);
  assert.match(worse.stdout, /^REGRESSED  benchmarks\/cases\/control: \{"kind":"agrees"\} -> \{"kind":"aborted","failure":"the compiled program declined every case"\}$/m);
  // A recorded loud defect that persists reproduces: a known JVM abort is a finding, not a red step.
  record({ kind: "aborted", failure: "the compiled program declined every case" });
  const loud = run("runtime-decline"); assert.equal(loud.status, 0, loud.stdout + loud.stderr); assert.match(loud.stdout, /1 as recorded/);
  const silent = run("wrong"); assert.equal(silent.status, 1, "an abort that became a wrong answer got worse");
  const better = run(); assert.equal(better.status, 0, better.stdout + better.stderr);
  assert.match(better.stdout, /improved, record pending: benchmarks\/cases\/control in \S+: \{"kind":"aborted"/);
  // The full check's writer: from a clean pin of main, it writes the accepted change, every other line byte for byte.
  writeFileSync(join(root, "provenance.json"), JSON.stringify({ sha: "c".repeat(40), clean: true, applied: null,
    binary_sha256: createHash("sha256").update(readFileSync(compiler)).digest("hex") }));
  const refused = run("wrong", "--record-pending"); assert.equal(refused.status, 1);
  assert.match(refused.stdout, /not recorded: 1 recorded run\(s\) changed/);
  assert.equal(readFileSync(file, "utf8"), `${header}benchmarks/cases/control\t{"kind":"aborted","failure":"the compiled program declined every case"}\n`);
  const written = run("", "--record-pending"); assert.equal(written.status, 0, written.stdout + written.stderr);
  assert.equal(readFileSync(file, "utf8"), `${header}benchmarks/cases/control\t{"kind":"agrees"}\n`);
  rmSync(file);
  const started = run("", "--record-pending"); assert.equal(started.status, 0, started.stdout + started.stderr);
  assert.equal(readFileSync(file, "utf8").split("\n")[1], 'benchmarks/cases/control\t{"kind":"agrees"}', "a record starts from its pending rows");
  assert.match(readFileSync(file, "utf8"), /"commit":"c{40}"/);
});

test("gate.sh lists a program with no oracle record as pending, and fails one with a record", t => {
  const { root, compiler } = sandbox(t);
  mkdirSync(join(root, "tests/programs/second")); writeFileSync(join(root, "tests/programs/second/tsconfig.json"), "{}");
  const run = () => spawnTest("sh", [join(root, "tooling/gate/gate.sh")], { cwd: root, encoding: "utf8",
    env: { ...process.env, NTS_GATE_STEP_RESULT: "", NTS_BIN: compiler, NTS_GATE_JOBS: "1", CHECK_MUTATION: "pending" } });
  const pending = run();
  assert.equal(pending.status, 0, pending.stdout + pending.stderr);
  assert.match(pending.stdout, /pending: tests\/programs\/control is not recorded in results\/oracle-counts\/tests\/programs\/control\.json yet/);
  assert.match(pending.stdout, /^1 of 1 agree with node$/m, "a pending program is neither agreement nor failure");
  mkdirSync(join(root, "results/oracle-counts/tests/programs"), { recursive: true });
  writeFileSync(join(root, "results/oracle-counts/tests/programs/control.json"), "{}\n");
  const contradicted = run();
  assert.equal(contradicted.status, 1, contradicted.stdout + contradicted.stderr);
  assert.match(contradicted.stdout, /DIS  control: reported pending, but results\/oracle-counts\/tests\/programs\/control\.json exists/);
});

test("the npm survey reads diagnostic fields and refuses a broken report", t => {
  const {root, compiler} = sandbox(t), pkg = join(root, "survey-package"); mkdirSync(pkg);
  writeFileSync(join(pkg, "main.ts"), "export function work(n: number): number {return n;}\n");
  writeFileSync(join(root, "tooling/npm-survey/vendored.json"), JSON.stringify([
    {name: "example", root: pkg, entry: join(pkg, "main.ts"), deps: []},
  ]));
  const run = (mutation: string) => spawnTest(process.execPath, [join(root, "tooling/npm-survey/verdict.ts")], {
    cwd: root, encoding: "utf8", 
    env: {...process.env, NTS_GATE_STEP_RESULT: "", NTS_BIN: compiler, CHECK_MUTATION: mutation},
  });
  for (const [mutation, outcome, code] of [["lowering-refusal", "refused", ""], ["typecheck", "typecheck-failed", "TS2304"]]) {
    const result = run(mutation!); assert.equal(result.status, 0, result.stdout + result.stderr);
    const rows = JSON.parse(readFileSync(join(root, "tooling/npm-survey/verdict.json"), "utf8"));
    assert.equal(rows[0].outcome, outcome); assert.doesNotMatch(JSON.stringify(rows), /decoy/);
    if (code) assert.deepEqual(rows[0].tsErrors, [code]);
    else assert.deepEqual(rows[0].refusals, ["source construct from a field"]);
  }
  for (const mutation of ["legacy-text", "contradiction"]) {
    const result = run(mutation); assert.notEqual(result.status, 0, result.stdout + result.stderr);
  }
});

for (const script of ["tooling/sweep/run.sh", "tooling/conformance/web-platform/compiled/check.sh"]) {
  test(`${script} requires structured completed comparisons`, t => {
    const {root, compiler} = sandbox(t);
    const run = (mutation = "") => spawnTest("sh", [join(root, script)], {cwd: root, encoding: "utf8", 
      env: {...process.env, NTS_GATE_STEP_RESULT: "", NTS_BIN: compiler, CHECK_MUTATION: mutation}});
    const control = run(); assert.equal(control.status, 0, control.stdout + control.stderr);
    for (const mutation of ["unavailable", "legacy-text", "contradiction"]) {
      const result = run(mutation); assert.notEqual(result.status, 0, result.stdout + result.stderr);
    }
  });
}

test("the real gate owner holds a hung check and retains a completed failure before a hang", t => {
  const {root, compiler} = sandbox(t), bin = join(root, "bin"); mkdirSync(bin);
  const preload = join(root, "idle-control.mjs"), active = pathToFileURL(join(root, "tooling/gate/active-process.ts")).href;
  writeFileSync(preload, `import {mock} from 'node:test';const real=await import(${JSON.stringify(active)});mock.module(${JSON.stringify(active)},{namedExports:{...real,activeCommand:(command,args,options)=>real.activeCommand(command,args,{...options,idleMs:1000,pollMs:50,cpuBudgetSeconds:10})}});\n`);
  // This wrapper changes only the observer's injected guard in the test.
  writeFileSync(join(bin, "node"), `#!/bin/sh\nexec '${process.execPath}' --experimental-test-module-mocks --import '${preload}' "$@"\n`, {mode: 0o755});
  const resultPath = join(root, "instrument.json");
  const run = (mutation: string) => spawnTest("sh", [join(root, "tooling/gate/gate.sh")], {cwd: root, encoding: "utf8", 
    env: {...process.env, PATH: bin + ":" + process.env.PATH, NTS_BIN: compiler, NTS_GATE_JOBS: "1", CHECK_MUTATION: mutation,
      NTS_GATE_STEP: "examples", NTS_GATE_STEP_ATTEMPT: "real-owner", NTS_GATE_STEP_RESULT: resultPath}});
  const hung = run("hang-after-output");
  assert.equal(hung.status, 124, hung.stdout + hung.stderr); assert.doesNotMatch(hung.stdout, /^DIS/m);
  let frame = JSON.parse(readFileSync(resultPath, "utf8"));
  assert.equal(frame.kind, "hung"); assert.equal(frame.verdict, "NOT RUN"); assert.equal(frame.completedFailures ?? 0, 0);
  mkdirSync(join(root, "tests/programs/hang")); writeFileSync(join(root, "tests/programs/hang/tsconfig.json"), "{}");
  const mixed = run("mixed"); assert.equal(mixed.status, 1, mixed.stdout + mixed.stderr);
  assert.match(mixed.stdout, /DIS  control/); assert.match(mixed.stdout, /NOT MEASURED hang/);
  frame = JSON.parse(readFileSync(resultPath, "utf8"));
  assert.equal(frame.kind, "hung"); assert.equal(frame.verdict, "FAIL"); assert.equal(frame.completedFailures, 1);
  const malformed = run("legacy-text"); assert.equal(malformed.status, 124, malformed.stdout + malformed.stderr);
  frame = JSON.parse(readFileSync(resultPath, "utf8")); assert.equal(frame.kind, "tooling-setup"); assert.equal(frame.verdict, "INSTRUMENT");
});

test("the actual gate owns typed per-call stops including cleanup after all answers",t=>{
  const {root,compiler}=sandbox(t),resultPath=join(root,'instrument.json');
  const run=(mutation:string)=>{
    rmSync(resultPath,{force:true});
    return spawnTest('sh',[join(root,'tooling/gate/gate.sh'),'control'],{cwd:root,encoding:'utf8',
      env:{...process.env,NTS_BIN:compiler,CHECK_MUTATION:mutation,NTS_GATE_STEP:'examples',NTS_GATE_STEP_ATTEMPT:'call-owner',NTS_GATE_STEP_RESULT:resultPath}});
  };
  for(const mutation of ['supervisor-hung','supervisor-cleanup']) {
    const result=run(mutation);assert.equal(result.status,124,result.stdout+result.stderr);
    const frame=JSON.parse(readFileSync(resultPath,'utf8'));
    assert.equal(frame.kind,'hung');assert.equal(frame.verdict,'NOT RUN');
  }
  // A compiled call past its allowance timed out: the case's recorded outcome, red, and no hold.
  const timedOut=run('supervisor-runaway');assert.equal(timedOut.status,1,timedOut.stdout+timedOut.stderr);
  assert.match(timedOut.stdout,/^TIMEOUT  control \(run\): owned compiled child stopped$/m);assert.equal(existsSync(resultPath),false);
  const red=run('supervisor-wrong-hung');assert.equal(red.status,1,red.stdout+red.stderr);
  assert.match(red.stdout,/owned compiled child stopped/);assert.equal(existsSync(resultPath),false);
});

test("a check past its compile bound is a recorded timeout, red and named, with no hold; the next case runs", t => {
  const {root, compiler} = sandbox(t), bin = join(root, "bin"); mkdirSync(bin);
  const preload = join(root, "compile-bound.mjs"), active = pathToFileURL(join(root, "tooling/gate/active-process.ts")).href;
  // The real supervisor, with the compile bound it was asked for made small.
  writeFileSync(preload, `import {mock} from 'node:test';const real=await import(${JSON.stringify(active)});mock.module(${JSON.stringify(active)},{namedExports:{...real,activeCommand:(command,args,options)=>real.activeCommand(command,args,{...options,...(options.ownCpuSeconds?{ownCpuSeconds:0.5}:{}),pollMs:50})}});\n`);
  writeFileSync(join(bin, "node"), `#!/bin/sh\nexec '${process.execPath}' --experimental-test-module-mocks --import '${preload}' "$@"\n`, {mode: 0o755});
  mkdirSync(join(root, "tests/programs/spin")); writeFileSync(join(root, "tests/programs/spin/tsconfig.json"), "{}");
  const resultPath = join(root, "instrument.json");
  const result = spawnTest("sh", [join(root, "tooling/gate/gate.sh")], {cwd: root, encoding: "utf8",
    env: {...process.env, PATH: bin + ":" + process.env.PATH, NTS_BIN: compiler, NTS_GATE_JOBS: "1", CHECK_MUTATION: "spin",
      NTS_GATE_STEP: "examples", NTS_GATE_STEP_ATTEMPT: "compile-bound", NTS_GATE_STEP_RESULT: resultPath}});
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^TIMEOUT  spin \(compile\): .*used its 0\.5 s CPU bound/m);
  assert.match(result.stdout, /^1 of 2 agree with node$/m, "control, after spin in name order, still ran");
  assert.equal(existsSync(resultPath), false, "a timeout publishes no hold");
});

test("the real batch owner publishes typed setup and cleanup failures", t => {
  const {root, compiler} = sandbox(t), blocker = join(root, "not-a-directory"); writeFileSync(blocker, "occupied");
  const script = join(root, "lifecycle-control.mjs"), resultPath = join(root, "lifecycle-result.json");
  const run = (phase: "setup" | "cleanup") => {
    const mutation = phase === "setup"
      ? `const real=await import('node:os');const {default:unused,...named}=real;mock.module('node:os',{namedExports:{...named,homedir:()=>${JSON.stringify(blocker)}},defaultExport:{...real.default}});`
      : `const realOs=await import('node:os');const {default:unusedOs,...osNamed}=realOs;mock.module('node:os',{namedExports:{...osNamed,homedir:()=>${JSON.stringify(root)}},defaultExport:{...realOs.default}});const real=await import('node:fs');const {default:unused,...named}=real;mock.module('node:fs',{namedExports:{...named,rmSync:(path,options)=>{if(String(path).includes('/nts-check-consumers/run-'))throw new Error('cleanup control');return real.rmSync(path,options);}},defaultExport:{...real.default}});`;
    writeFileSync(script, `import {mock} from 'node:test';${mutation}\nconst {runBatch}=await import(${JSON.stringify(pathToFileURL(join(root, "tooling/differential/check-consumers.ts")).href)});process.exitCode=await runBatch('programs');\n`);
    return spawnTest(process.execPath, ["--experimental-test-module-mocks", script], {cwd: root, encoding: "utf8", 
      env: {...process.env, NTS_BIN: compiler, NTS_GATE_JOBS: "1", CHECK_MUTATION: "", NTS_GATE_STEP: "examples",
        NTS_GATE_STEP_ATTEMPT: "lifecycle", NTS_GATE_STEP_RESULT: resultPath}});
  };
  for (const phase of ["setup", "cleanup"] as const) {
    const result = run(phase); assert.equal(result.status, 124, result.stdout + result.stderr);
    const frame = JSON.parse(readFileSync(resultPath, "utf8"));
    assert.equal(frame.kind, `tooling-${phase}`); assert.equal(frame.verdict, "INSTRUMENT");
  }
});
