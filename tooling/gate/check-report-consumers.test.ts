import assert from "node:assert/strict";
import { spawnTest } from "./test-wait.ts";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";

const source = dirname(fileURLToPath(import.meta.url));

function sandbox(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "nts-check-consumers-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ["tooling/gate", "tooling/jvm", "tooling/differential", "tooling/conformance", "tooling/sweep", "tooling/npm-survey",
    "tooling/conformance/web-platform/compiled", "tests/programs/control",
    "tests/programs/invalid", "tests/programs/unsupported", "benchmarks/cases/control"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  for (const script of ["gate.sh", "rc.sh", "bench-agree.sh", "declines.sh"]) {
    copyFileSync(join(source, script), join(root, "tooling/gate", script));
  }
  copyFileSync(join(source, "../jvm/agrees-with-c.sh"), join(root, "tooling/jvm/agrees-with-c.sh"));
  copyFileSync(join(source, "../differential/check-report.ts"), join(root, "tooling/differential/check-report.ts"));
  copyFileSync(join(source, "../differential/check-report-types.ts"), join(root, "tooling/differential/check-report-types.ts"));
  copyFileSync(join(source, "../differential/check-consumers.ts"), join(root, "tooling/differential/check-consumers.ts"));
  copyFileSync(join(source, "active-command.ts"), join(root, "tooling/gate/active-command.ts"));
  copyFileSync(join(source, "step-result.ts"), join(root, "tooling/gate/step-result.ts"));
  copyFileSync(join(source, "../sweep/run.sh"), join(root, "tooling/sweep/run.sh"));
  copyFileSync(join(source, "../npm-survey/verdict.ts"), join(root, "tooling/npm-survey/verdict.ts"));
  copyFileSync(join(source, "../conformance/web-platform/compiled/check.sh"), join(root, "tooling/conformance/web-platform/compiled/check.sh"));
  writeFileSync(join(root, "tooling/gate/tokens.mjs"), "export async function withToken(fn) { return fn(); }\n");
  writeFileSync(join(root, "tooling/sweep/sweep.mjs"), "console.log('export function work(n: number): number { return n; }');\n");
  writeFileSync(join(root, "tooling/conformance/web-platform/compiled/tsconfig.json"), "{}");
  copyFileSync(join(source, "../conformance/observation-text.ts"), join(root, "tooling/conformance/observation-text.ts"));
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

for (const script of ["gate.sh", "rc.sh", "bench-agree.sh"]) {
  test(`${script} reads structured dispositions and refuses text/field mutations`, (t) => {
    const { root, compiler } = sandbox(t);
    const run = (mutation = "") => spawnTest(script === "rc.sh" ? "bash" : "sh",
      [join(root, "tooling/gate", script), ...(script === "bench-agree.sh" ? ["control"] : [])], {
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
    if (script === "bench-agree.sh") {
      assert.equal(unavailable.status, 0, unavailable.stdout + unavailable.stderr);
      assert.match(unavailable.stdout, /no compiled benchmark cases compared/);
    } else {
      assert.notEqual(unavailable.status, 0, "a corpus with no compared example cannot pass");
    }
  });
}

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
  const preload = join(root, "idle-control.mjs"), active = pathToFileURL(join(root, "tooling/gate/active-command.ts")).href;
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
