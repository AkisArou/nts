import { FIXED_AMBIENT } from "./canonical-environment.ts";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { COUNTER_SCOPE, COMPILE_WORK_PROFILE, COMPILE_WORK_SETTINGS, compileWorkSettings, compileWorkProblem, counterProblem, readCounterTable, calibratedTable, compileArm, compileCommand } from "./compile-counter.ts";

test("counted work requires observed upstream single-threaded and Rayon settings",()=>{
  assert.throws(()=>compileWorkSettings({}),/RAYON_NUM_THREADS=1/);
  assert.throws(()=>compileWorkSettings({RAYON_NUM_THREADS:"4"}),/RAYON_NUM_THREADS=1/);
  const work_settings=compileWorkSettings({RAYON_NUM_THREADS:"1"});
  assert.equal(compileWorkProblem({work_profile:COMPILE_WORK_PROFILE,work_settings}),null);
  for(const row of [
    {work_profile:"compiler-workers-v1:1",work_settings},
    {work_profile:COMPILE_WORK_PROFILE},
    {work_profile:COMPILE_WORK_PROFILE,work_settings:{...work_settings,rayon_num_threads:"4"}},
    {work_profile:COMPILE_WORK_PROFILE,work_settings:{...work_settings,single_threaded:false}},
    {work_profile:COMPILE_WORK_PROFILE,work_settings:{...work_settings,checkers:4}},
  ])assert.ok(compileWorkProblem(row));
});
import { instructionsWork, spawnCounted } from "./cputime.mjs";
import { spawnTest, waitFor, TEST_HANG_MS } from "./test-wait.ts";

test("old attached counts and positive but missed-worker counts fail closed", () => {
  const valid = { work_profile: COMPILE_WORK_PROFILE, work_settings: COMPILE_WORK_SETTINGS, counter_scope: COUNTER_SCOPE, instructions: 590879145142, cpu_s: 45.99, status: 0 };
  assert.equal(counterProblem(valid), null);
  assert.match(counterProblem({ ...valid, counter_scope: undefined })!, /scope/);
  assert.match(counterProblem({ ...valid, instructions: 319570, cpu_s: 92.90 })!, /implausible/);
  for (const instructions of [null, 0, NaN, Infinity]) assert.ok(counterProblem({ ...valid, instructions }));
  for (const cpu_s of [null, 0, NaN, Infinity]) assert.ok(counterProblem({ ...valid, cpu_s }));
  assert.ok(counterProblem({ ...valid, status: 124 }));
  assert.throws(() => readCounterTable("runtime/node/tty\t0.0\t0.0\n"), /scope/);
  assert.throws(() => readCounterTable(`# counter-scope: ${COUNTER_SCOPE}\n# work-profile: ${COMPILE_WORK_PROFILE}\nruntime/node/tty\t0\n`), /invalid/);
  assert.equal(readCounterTable(`# counter-scope: ${COUNTER_SCOPE}\n# work-profile: ${COMPILE_WORK_PROFILE}\n# regression-ratio: 1.10\nruntime/node/tty\t1.234\n`).rows.get("runtime/node/tty"), 1.234);
});

test("baseline publication refuses missing runs/populations and derives its threshold from the spread", () => {
  const runs = [1, 2, 3, 4, 5].map(repeat => ({ module: "runtime/example", repeat, work_profile: COMPILE_WORK_PROFILE, work_settings: COMPILE_WORK_SETTINGS, counter_scope: COUNTER_SCOPE,
    status: 0, instructions: (100 + repeat) * 1e9, cpu_s: 10, listing_functions: 1, listing_definitions: 1, counter_file: "raw.perf" }));
  const summary = { work_profile: COMPILE_WORK_PROFILE, work_settings: COMPILE_WORK_SETTINGS, counter_scope: COUNTER_SCOPE, complete: true, nts_sha256: "a".repeat(64), modules: [{ module: "runtime/example", runs }] };
  assert.throws(() => calibratedTable({ ...summary, work_profile: undefined }, ["runtime/example"]), /incompatible/);
  const published = calibratedTable(summary, ["runtime/example"]);
  assert.equal(published.policy.ratio, 1.20); // max/min spread 3.96%; fourfold margin rounded up.
  assert.equal(readCounterTable(published.text).rows.get("runtime/example"), 103);
  assert.throws(() => calibratedTable(summary, ["runtime/example", "missing"]), /population/);
  assert.throws(() => calibratedTable({ ...summary, modules: [{ module: "runtime/example", runs: runs.slice(1) }] }, ["runtime/example"]), /five-repeat/);
  assert.throws(() => calibratedTable({ ...summary, complete: false }, ["runtime/example"]), /incomplete/);
});

test("the real tripwire reports missed, absent and legacy readings as not measured", { skip: instructionsWork() ?? false }, t => {
  const cache = join(homedir(), ".cache/nts-counter-tests");
  mkdirSync(cache, { recursive: true });
  const root = mkdtempSync(join(cache, "guard-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const gate = join(root, "tooling/gate"), kept = join(root, "kept");
  mkdirSync(gate, { recursive: true });
  mkdirSync(kept);
  mkdirSync(join(root, "runtime/node/subject"), { recursive: true });
  writeFileSync(join(root, "runtime/node/subject/tsconfig.json"), "{}");
  for (const name of ["compile-time.mjs", "compile-counter.ts", "cputime.mjs", "tokens.mjs", "canonical-environment.ts", "run-temporary.ts"]) {
    copyFileSync(fileURLToPath(new URL(name, import.meta.url)), join(gate, name));
  }
  const sha256 = createHash("sha256").update(readFileSync(process.execPath)).digest("hex");
  const meta = { work_profile: COMPILE_WORK_PROFILE, work_settings: COMPILE_WORK_SETTINGS, counter_scope: COUNTER_SCOPE, arm: "nogc", sha256, nts: process.execPath };
  const table = `# counter-scope: ${COUNTER_SCOPE}\n# work-profile: ${COMPILE_WORK_PROFILE}\n# regression-ratio: 1.10\nruntime/node/subject\t100\n`;
  writeFileSync(join(gate, "compile-times.tsv"), table);
  writeFileSync(join(kept, "meta.json"), JSON.stringify(meta));
  const valid = { work_profile: COMPILE_WORK_PROFILE, work_settings: COMPILE_WORK_SETTINGS, counter_scope: COUNTER_SCOPE, arm: "nogc", status: 0, signal: null, cpu_s: 10, instructions: 100e9 };
  const check = (row: object) => {
    writeFileSync(join(kept, "runtime_node_subject.json"), JSON.stringify(row));
    return spawnTest(process.execPath, [join(gate, "compile-time.mjs")], { encoding: "utf8", env: {
      ...process.env, NTS_BIN: process.execPath, NTS_COMPILE_TIMES_FROM: kept, NTS_GATE_RUN_DIR: join(root, "run"),
    } });
  };
  assert.equal(check(valid).status, 0);
  for (const row of [
    { ...valid, instructions: 319570, cpu_s: 92.90 },
    { ...valid, instructions: null, cpu_s: 0.001 },
    { ...valid, counter_scope: undefined },
    { ...valid, work_profile: undefined },
    { ...valid, work_profile: "compiler-workers-v1:2" },
    { ...valid, status: undefined },
  ]) {
    const result = check(row);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /NOT MEASURED/);
  }
  const slower = check({ ...valid, instructions: 115e9 });
  assert.equal(slower.status, 1);
  assert.match(slower.stdout, /SLOWER/);
  // A tiny module's tenfold blow-up must not hide below an absolute floor.
  writeFileSync(join(gate, "compile-times.tsv"), table.replace("subject\t100", "subject\t2"));
  const smallBlowup = check({ ...valid, instructions: 20e9 });
  assert.equal(smallBlowup.status, 1);
  assert.match(smallBlowup.stdout, /SLOWER/);
  // tty is below 0.1 G: its published relative limit applies there too.
  writeFileSync(join(gate, "compile-times.tsv"), table.replace("subject\t100", "subject\t0.052"));
  const tinyBlowup = check({ ...valid, instructions: 0.0624e9, cpu_s: 0.01 });
  assert.equal(tinyBlowup.status, 1, tinyBlowup.stdout + tinyBlowup.stderr);
  assert.match(tinyBlowup.stdout, /SLOWER/);
  writeFileSync(join(gate, "compile-times.tsv"), table);
  writeFileSync(join(kept, "meta.json"), JSON.stringify({ ...meta, counter_scope: undefined }));
  const legacy = check(valid);
  assert.equal(legacy.status, 2);
  assert.match(legacy.stdout, /NOT MEASURED: incompatible counter scope/);
  writeFileSync(join(kept, "meta.json"), JSON.stringify(meta));
  for (const arm of [undefined, "rc"]) {
    writeFileSync(join(kept, "meta.json"), JSON.stringify({ ...meta, arm }));
    const wrong = check(valid);
    assert.equal(wrong.status, 2);
    assert.match(wrong.stdout, /NOT MEASURED: incompatible preparation arm/);
  }
  writeFileSync(join(kept, "meta.json"), JSON.stringify(meta));
  const mixed = check({ ...valid, arm: "rc" });
  assert.equal(mixed.status, 1);
  assert.match(mixed.stdout, /incompatible preparation arm/);
  writeFileSync(join(root, "runtime/node/subject/nts.config.ts"), "export default {};");
  const config = check(valid);
  assert.equal(config.status, 2);
  assert.match(config.stdout, /NOT MEASURED: project config can spawn descendants/);
});

test("a complete listing followed by a wrapped signal remains not measured", { skip: instructionsWork() ?? false }, t => {
  const cache = join(homedir(), ".cache/nts-counter-tests");
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, "listing-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const nts = join(dir, "nts");
  writeFileSync(nts, `#!/bin/sh
if [ "$1" = hir ]; then
cat <<'HIR'
func module#init() -> void {
b0:
  return
}
1 function(s), 0 construct(s) refused
HIR
fi
if [ "$2" = --prepared ] && [ "$NTS_COUNTER_TEST_ENDING" = signal ]; then kill -TERM $$; fi
`);
  chmodSync(nts, 0o755);
  for (const ending of ["ok", "signal"]) {
    const kept = join(dir, ending);
    const frame = join(dir, `${ending}-instrument.json`);
    const result = spawnTest(process.execPath, [fileURLToPath(new URL("../conformance/integrity.ts", import.meta.url)), "runtime/node/counter-test"], {
      encoding: "utf8", env: { ...process.env, NTS_BIN: nts, NTS_INTEGRITY_KEEP: kept, NTS_COUNTER_TEST_ENDING: ending,
        NTS_GATE_COSTS_DIR: join(dir, "costs"), NTS_GATE_TOKENS: "", NTS_GATE_TOKEN_HELD: "1", NTS_GATE_CASE_COSTS_DIR: "", NTS_GATE_RUN_DIR: dir, NTS_GATE_STEP: "integrity", NTS_GATE_STEP_ATTEMPT: "counter-control", NTS_GATE_STEP_RESULT: frame },
    });
    const row = JSON.parse(readFileSync(join(kept, "runtime_node_counter-test.json"), "utf8"));
    if (ending === "ok") {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(row.counter_error, null);
      assert.equal(existsSync(frame), false, "successful integrity must leave no instrument frame");
    } else {
      assert.equal(result.status, 124, result.stdout + result.stderr);
      const observation=JSON.parse(readFileSync(frame,"utf8"));
      assert.equal(observation.kind,"tooling-setup");
      assert.equal(observation.verdict,"INSTRUMENT");
      assert.match(observation.reason,/counter run (?:ended by|exited)/);
      assert.match(result.stdout, /NOT MEASURED/);
      assert.ok(row.counter_error);
    }
  }
});

test("from-exec inheritance counts a late thread and fork, and termination reaches the command", { skip: instructionsWork() ?? false }, async t => {
  const cache = join(homedir(), ".cache/nts-counter-tests");
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, "run-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const binary = join(dir, "counter-thread");
  const compiled = spawnTest("cc", ["-O2", "-pthread", "-o", binary, fileURLToPath(new URL("fixtures/counter-thread.c", import.meta.url))], { encoding: "utf8" });
  assert.equal(compiled.status, 0, compiled.stderr);
  const counts: number[] = [];
  for (const kind of ["thread", "thread", "thread", "fork", "terminate"]) {
    const counterFile = join(dir, `${kind}-${counts.length}.perf`);
    const { child, measurement } = spawnCounted(binary, [kind === "terminate" ? "fork-hold" : kind], { counterFile, timeoutMs: TEST_HANG_MS });
    let stdout = "", stderr = "", closed = false;
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk; });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk; });
    child.on("close", () => { closed = true; });
    try {
      await waitFor("the counter command's READY event", () => stdout.includes("READY\n"), { stopped: () => closed ? stderr || "command closed" : undefined });
      child.stdin.end("go\n");
      if (kind === "terminate") {
        await waitFor("the counter command's live descendant", () => stdout.includes("CHILD_READY\n"), { stopped: () => closed ? stderr || "command closed" : undefined });
        child.kill("SIGTERM");
      }
      const row = await measurement;
      if (kind === "terminate") {
        assert.ok(row.counter_error, "a signalled command is not a measurement");
        assert.equal(stdout.match(/TERMINATED/g)?.length, 2, "termination reached both the command and its descendant");
      } else {
        assert.equal(row.counter_error, null, JSON.stringify(row));
        assert.equal(counterProblem(row), null);
        assert.ok(row.instructions! > 100_000_000, `late ${kind} work was missed: ${JSON.stringify(row)}`);
        assert.ok(readFileSync(counterFile, "utf8").includes("seconds user"));
        counts.push(row.instructions!);
      }
    } finally {
      if (!closed) child.kill("SIGTERM");
      child.stdin.destroy();
      await measurement;
    }
  }
  // Native fixed work, with no JIT: count the same loop in both scope controls.
  const spread = Math.max(...counts) / Math.min(...counts) - 1;
  assert.ok(spread < 0.03, `counts ${counts.join(", ")}, spread ${spread}`);
});

test("preparation arms have distinct commands, tables and complete calibration evidence", () => {
  assert.equal(compileArm([]), "nogc");
  assert.equal(compileArm(["--arm", "rc"]), "rc");
  assert.throws(() => compileArm(["--arm"]), /requires/);
  assert.throws(() => compileArm(["--arm", "other"]), /requires/);
  assert.deepEqual(compileCommand("nogc", "subject"), ["hir", "--prepared", "--checkers", "1", "subject"]);
  assert.deepEqual(compileCommand("rc", "subject"), ["hir", "--prepared", "--checkers", "1", "--rc", "subject"]);
  const runs = [1, 2, 3, 4, 5].map(repeat => ({ arm: "rc" as const, module: "subject", repeat,
    work_profile: COMPILE_WORK_PROFILE, work_settings: COMPILE_WORK_SETTINGS, counter_scope: COUNTER_SCOPE, status: 0, instructions: 100e9 + repeat * 1e6, cpu_s: 10,
    listing_functions: 1, listing_definitions: 1, counter_file: "raw.perf" }));
  const summary = { arm: "rc" as const, work_profile: COMPILE_WORK_PROFILE, work_settings: COMPILE_WORK_SETTINGS, counter_scope: COUNTER_SCOPE, complete: true,
    nts_sha256: "b".repeat(64), modules: [{ module: "subject", runs }] };
  const { text, policy } = calibratedTable(summary, ["subject"]);
  assert.equal(policy.ratio, 1.10);
  assert.equal(readCounterTable(text, "rc").rows.size, 1);
  assert.throws(() => readCounterTable(text), /preparation arm/);
  assert.throws(() => readCounterTable(text.replace("# arm: rc\n", ""), "rc"), /preparation arm/);
  assert.throws(() => calibratedTable({ ...summary,
    modules: [{ module: "subject", runs: runs.map(r => ({ ...r, arm: "nogc" as const })) }] }, ["subject"]), /five-repeat/);
});

test("RC runs fresh with --rc despite a valid NoGC shared measurement, and owns its guard", { skip: instructionsWork() ?? false }, t => {
  const cache = join(homedir(), ".cache/nts-counter-tests");
  mkdirSync(cache, { recursive: true });
  const root = mkdtempSync(join(cache, "rc-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const gate = join(root, "tooling/gate"), kept = join(root, "kept");
  mkdirSync(gate, { recursive: true }); mkdirSync(kept);
  mkdirSync(join(root, "runtime/node/subject"), { recursive: true });
  writeFileSync(join(root, "runtime/node/subject/tsconfig.json"), "{}");
  for (const name of ["compile-time.mjs", "compile-counter.ts", "cputime.mjs", "tokens.mjs", "canonical-environment.ts", "run-temporary.ts"]) {
    copyFileSync(fileURLToPath(new URL(name, import.meta.url)), join(gate, name));
  }
  const commands = join(root, "commands.jsonl"), nts = join(root, "nts");
  writeFileSync(nts, `#!/usr/bin/env node
require('node:fs').appendFileSync(${JSON.stringify(commands)}, JSON.stringify({args:process.argv.slice(2), ambient:Object.fromEntries(["LANG", "LC_ALL", "TZ", "FORCE_COLOR", "TERM", "RAYON_NUM_THREADS"].map(key=>[key,process.env[key]]))})+'\\n');
`);
  chmodSync(nts, 0o755);
  const sha256 = createHash("sha256").update(readFileSync(nts)).digest("hex");
  writeFileSync(join(kept, "meta.json"), JSON.stringify({ work_profile: COMPILE_WORK_PROFILE, work_settings: COMPILE_WORK_SETTINGS, counter_scope: COUNTER_SCOPE, arm: "nogc", sha256, nts }));
  writeFileSync(join(kept, "runtime_node_subject.json"), JSON.stringify({ arm: "nogc", work_profile: COMPILE_WORK_PROFILE, work_settings: COMPILE_WORK_SETTINGS, counter_scope: COUNTER_SCOPE, status: 0, cpu_s: 10, instructions: 100e9 }));
  const table = `# counter-scope: ${COUNTER_SCOPE}\n# work-profile: ${COMPILE_WORK_PROFILE}\n# regression-ratio: 1.10\nruntime/node/subject\t100\n`;
  writeFileSync(join(gate, "compile-times.tsv"), table);
  writeFileSync(join(gate, "compile-times-rc.tsv"), `# arm: rc\n${table}`);
  const check = (arm: string) => spawnTest(process.execPath, [join(gate, "compile-time.mjs"), "--arm", arm], {
    encoding: "utf8", env: { ...process.env, NTS_BIN: nts, NTS_COMPILE_TIMES_FROM: kept,
      NTS_GATE_RUN_DIR: join(root, "run"), LC_ALL: "C", TZ: "Pacific/Kiritimati", NTS_GATE_TOKEN_HELD: "1", NTS_GATE_TOKENS: "" },
  });
  assert.equal(check("nogc").status, 0);
  const rc = check("rc");
  assert.equal(rc.status, 0, rc.stdout + rc.stderr);
  assert.deepEqual(JSON.parse(readFileSync(commands, "utf8").trim()), {
    args: ["hir", "--prepared", "--checkers", "1", "--rc", "runtime/node/subject"], ambient: {...FIXED_AMBIENT,RAYON_NUM_THREADS:"1"},
  });
  writeFileSync(join(gate, "compile-times-rc.tsv"), `# arm: rc\n${table.replace("subject\t100", "subject\t0.000001")}`);
  assert.equal(check("nogc").status, 0);
  const slower = check("rc");
  assert.equal(slower.status, 1, slower.stdout + slower.stderr);
  assert.match(slower.stdout, /SLOWER/);
});
