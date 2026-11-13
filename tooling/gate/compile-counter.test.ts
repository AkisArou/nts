import {fixtureEnvironment} from "./test-environment.ts";
import {FIXED_AMBIENT} from "./canonical-environment.ts";
import assert from "node:assert/strict";
import {chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {join,relative} from "node:path";
import {fileURLToPath} from "node:url";
import {copyModuleClosure} from "./module-closure-fixture.ts";
import {test} from "node:test";
import {COUNTER_SCOPE, COMPILE_WORK_PROFILE, COMPILE_WORK_SETTINGS, compileWorkSettings, compileWorkProblem, counterProblem, readCounterTable, calibratedTable, calibrationRecord, withCalibratedModule, withTableLines, withCalibrationEntries, tableLines, calibrationEntries, compileArm, compileCommand, compileTimeModules, discoverCompileTimeFixtures} from "./compile-counter.ts";
import {testScratch} from "./test-scratch.ts";
import {ownMemoryEnv} from "./test-memory.ts";

const counterEntry=relative(fileURLToPath(new URL('../..',import.meta.url)),fileURLToPath(new URL('./compile-time.mjs',import.meta.url)));

test("compile-time fixture discovery requires a config and includes each configured directory", t => {
  const root = testScratch(t, "counter-discovery");
  mkdirSync(join(root, "tests/compile-time"), { recursive: true });
  assert.deepEqual(discoverCompileTimeFixtures(root), []);
  mkdirSync(join(root, "tests/compile-time/fixture"), { recursive: true });
  writeFileSync(join(root, "tests/compile-time/fixture/tsconfig.json"), "{}");
  assert.deepEqual(discoverCompileTimeFixtures(root), ["tests/compile-time/fixture"]);
  mkdirSync(join(root, "tests/compile-time/nested/another"), { recursive: true });
  writeFileSync(join(root, "tests/compile-time/nested/another/tsconfig.json"), "{}");
  assert.deepEqual(discoverCompileTimeFixtures(root), ["tests/compile-time/fixture", "tests/compile-time/nested/another"]);
  mkdirSync(join(root, "runtime/node/zlib"), { recursive: true });
  mkdirSync(join(root, "runtime/node/unconfigured"), { recursive: true });
  writeFileSync(join(root, "runtime/node/zlib/tsconfig.json"), "{}");
  assert.deepEqual(compileTimeModules(root), ["runtime/node/zlib", "tests/compile-time/fixture", "tests/compile-time/nested/another"],
    "every configured runtime module and fixture, in one order");
});

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
import {instructionsWork, spawnCounted} from "./cputime.mjs";
import {spawnTest, waitFor, TEST_HANG_MS} from "./test-wait.ts";

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

function calibration(module: string, base: number, source = "a") {
  return { arm: "nogc" as const, work_profile: COMPILE_WORK_PROFILE, work_settings: COMPILE_WORK_SETTINGS,
    counter_scope: COUNTER_SCOPE, complete: true, nts_sha256: source.repeat(64), commit: source.repeat(40), raw_directory: `/raw/${source}`,
    modules: [{ module, runs: [1, 2, 3, 4, 5].map(repeat => ({ module, repeat, arm: "nogc" as const,
      work_profile: COMPILE_WORK_PROFILE, work_settings: COMPILE_WORK_SETTINGS, counter_scope: COUNTER_SCOPE,
      status: 0, instructions: (base + repeat / 100) * 1e9, cpu_s: 10, listing_functions: 1, listing_definitions: 1,
      counter_file: `/raw/${source}/${module}-${repeat}.perf` })) }] };
}

test("a selected calibration preserves every other row and its compiler/source provenance", () => {
  const a = calibration("runtime/a", 100), b = calibration("runtime/b", 200);
  const previous = { ...a, modules: [...a.modules, ...b.modules] };
  const original = calibratedTable(previous, ["runtime/a", "runtime/b"]);
  const published = { ...previous, tripwire_policy: original.policy };
  const fresh = calibration("runtime/a", 150, "b");
  const updated = withCalibratedModule(original.text, published, fresh, ["runtime/a", "runtime/b"], "runtime/a");
  const line = (text: string, module: string) => text.split("\n").find(row => row.startsWith(`${module}\t`));
  assert.equal(line(updated.text, "runtime/b"), line(original.text, "runtime/b"));
  assert.equal(line(updated.text, "runtime/a"), "runtime/a\t150.030\t10.000");
  assert.equal(updated.policy.ratio, 1.10);
  assert.match(updated.text, /# compiler-provenance: per-module/);
  assert.doesNotMatch(updated.text, /# compiler-sha256:/);
  assert.equal("nts_sha256" in updated.record, false, "a mixed record makes no global compiler claim");
  assert.deepEqual(updated.record.modules[0]!.source, { nts_sha256: "b".repeat(64), commit: "b".repeat(40), raw_directory: "/raw/b" });
  assert.deepEqual(updated.record.modules[1]!.source, { nts_sha256: "a".repeat(64), commit: "a".repeat(40), raw_directory: "/raw/a" });
  assert.deepEqual(updated.record.modules[1]!.runs, b.modules[0]!.runs);
  const again = withCalibratedModule(updated.text, updated.record, calibration("runtime/b", 250, "c"), ["runtime/a", "runtime/b"], "runtime/b");
  assert.equal(line(again.text, "runtime/a"), line(updated.text, "runtime/a"));
  assert.deepEqual(again.record.modules[0], updated.record.modules[0]);
  assert.equal(again.record.modules[1]!.source.commit, "c".repeat(40));
});

test("selected publication refuses absent modules, drift, incomplete repeats and a wider policy", () => {
  const previous = calibration("runtime/a", 100);
  const original = calibratedTable(previous, ["runtime/a"]);
  const published = { ...previous, tripwire_policy: original.policy };
  const fresh = calibration("runtime/a", 150, "b");
  const update = (summary = fresh, text = original.text) => withCalibratedModule(text, published, summary, ["runtime/a"], "runtime/a");
  assert.throws(() => withCalibratedModule(original.text, published, calibration("runtime/missing", 150, "b"), ["runtime/a"], "runtime/missing"), /unknown compile-time module: runtime\/missing/);
  assert.throws(() => update(calibration("runtime/missing", 150, "b")), /population/);
  assert.throws(() => update({ ...fresh, modules: [{ ...fresh.modules[0]!, runs: fresh.modules[0]!.runs.slice(1) }] }), /five-repeat/);
  const noisy = structuredClone(fresh); noisy.modules[0]!.runs[4]!.instructions *= 1.04;
  assert.throws(() => update(noisy), /above existing 1.10/);
  assert.throws(() => update(fresh, original.text.replace("100.030", "99.000")), /differs from its five-repeat proof/);
  assert.throws(() => update({ ...fresh, commit: "missing" }), /provenance/);
  assert.throws(() => withCalibratedModule(original.text, published, { ...fresh, arm: "rc" }, ["runtime/a"], "runtime/a"), /arm/);
  assert.throws(() => withCalibratedModule(original.text, { ...published, complete: false }, fresh, ["runtime/a"], "runtime/a"), /incomplete/);
  assert.throws(() => withCalibratedModule(original.text, { ...published, modules: [] }, fresh, ["runtime/a"], "runtime/a"), /population/);
  assert.equal(readCounterTable(original.text).rows.get("runtime/a"), 100.03);
});

test("a pending module's calibration adds its row in place, every other row and entry kept byte for byte", () => {
  const a = calibration("runtime/a", 100), c = calibration("runtime/c", 300);
  const original = calibrationRecord({ ...a, modules: [...a.modules, ...c.modules] }, ["runtime/a", "runtime/c"]);
  const fresh = calibration("runtime/b", 200, "b"), expected = ["runtime/a", "runtime/b", "runtime/c"];
  const added = withCalibratedModule(original.text, original.record, fresh, expected, "runtime/b");
  const rows = (text: string) => text.split("\n").filter(line => line && !line.startsWith("#"));
  assert.deepEqual(rows(added.text), ["runtime/a\t100.030\t10.000", "runtime/b\t200.030\t10.000", "runtime/c\t300.030\t10.000"]);
  assert.deepEqual(added.text.split("\n").filter(line => line.startsWith("#")), original.text.split("\n").filter(line => line.startsWith("#")).map(line =>
    line.startsWith("# compiler-sha256:") ? "# compiler-provenance: per-module in results/compile-counter-calibration.json" : line), "the header keeps its policy");
  assert.equal(added.policy.ratio, original.policy.ratio);
  assert.deepEqual(added.record.modules.map(module => module.module), expected);
  assert.deepEqual(added.record.modules[0], original.record.modules[0], "an existing entry keeps its runs and provenance");
  assert.deepEqual(added.record.modules[1]!.source, { nts_sha256: "b".repeat(64), commit: "b".repeat(40), raw_directory: "/raw/b" });
  // What --apply merges is the row and the entry, and that makes the very bytes the tool published.
  const json = (record: unknown) => `${JSON.stringify(record, null, 2)}\n`;
  const table = withTableLines(original.text, new Map([["runtime/b", tableLines(added.text).get("runtime/b")!]]));
  const evidence = withCalibrationEntries(json(original.record), new Map([["runtime/b", calibrationEntries(json(added.record)).get("runtime/b")!]]));
  assert.equal(table.replace(/^# compiler-sha256:.*$/m, "# compiler-provenance: per-module in results/compile-counter-calibration.json"), added.text);
  assert.equal(evidence, json(added.record));
  // The table may not have rows for modules the tree lacks, and the tree must have the module.
  assert.throws(() => withCalibratedModule(original.text, original.record, fresh, ["runtime/a", "runtime/b"], "runtime/b"), /modules the tree does not have: runtime\/c/);
  assert.throws(() => withCalibratedModule(original.text, original.record, fresh, ["runtime/a", "runtime/c"], "runtime/b"), /unknown compile-time module/);
  const noisy = structuredClone(fresh); noisy.modules[0]!.runs[4]!.instructions *= 1.04;
  assert.throws(() => withCalibratedModule(original.text, original.record, noisy, expected, "runtime/b"), /above existing 1.10/);
});

test("the recorder rejects a module the tree does not have before creating a run", t => {
  const root = testScratch(t, "counter-selection"), out = join(root, "not-created");
  const result = spawnTest(process.execPath, [fileURLToPath(new URL("compile-counter-calibrate.ts", import.meta.url)),
    "--module", "runtime/node/not-a-module", "--run-dir", out], { encoding: "utf8", env: ownMemoryEnv(join(root, "memory"), { ...fixtureEnvironment(t), NTS_BIN: process.execPath }) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown compile-time module: runtime\/node\/not-a-module/);
  assert.equal(existsSync(out), false);
});

test("the real tripwire fails missed and legacy readings and stale rows, and lists pending and improved modules", { skip: instructionsWork() ?? false }, t => {
  const root = testScratch(t, "counter-guard");
  const gate = join(root, "tooling/gate"), kept = join(root, "kept"), tableFile = join(root, "results/compile-times.tsv");
  mkdirSync(gate, { recursive: true });
  mkdirSync(join(root, "results"));
  mkdirSync(kept);
  mkdirSync(join(root, "runtime/node/subject"), { recursive: true });
  writeFileSync(join(root, "runtime/node/subject/tsconfig.json"), "{}");
  for(const input of ["tests/compile-time","runtime/web-platform"])mkdirSync(join(root,input),{recursive:true});
  copyModuleClosure([counterEntry], root,{dataNamespaces:{"runtime/node":"compile counter CLI control","runtime/web-platform":"compile counter CLI control","tests/compile-time":"compile counter CLI control"}});
  assert.deepEqual(compileTimeModules(root),["runtime/node/subject"],"the counter sees only its private project");
  const sha256 = createHash("sha256").update(readFileSync(process.execPath)).digest("hex");
  const meta = { work_profile: COMPILE_WORK_PROFILE, work_settings: COMPILE_WORK_SETTINGS, counter_scope: COUNTER_SCOPE, arm: "nogc", sha256, nts: process.execPath };
  const table = `# counter-scope: ${COUNTER_SCOPE}\n# work-profile: ${COMPILE_WORK_PROFILE}\n# regression-ratio: 1.10\nruntime/node/subject\t100\n`;
  writeFileSync(tableFile, table);
  writeFileSync(join(kept, "meta.json"), JSON.stringify(meta));
  const valid = { work_profile: COMPILE_WORK_PROFILE, work_settings: COMPILE_WORK_SETTINGS, counter_scope: COUNTER_SCOPE, arm: "nogc", status: 0, signal: null, cpu_s: 10, instructions: 100e9 };
  const check = (row: object) => {
    writeFileSync(join(kept, "runtime_node_subject.json"), JSON.stringify(row));
    return spawnTest(process.execPath, [join(root, counterEntry)], { encoding: "utf8", env: {
      ...fixtureEnvironment(t), NTS_BIN: process.execPath, NTS_COMPILE_TIMES_FROM: kept, NTS_GATE_RUN_DIR: join(root, "run"),
    } });
  };
  assert.equal(check(valid).status, 0);
  // Inside the band either way nothing is listed, so no drift is ever absorbed.
  for (const instructions of [95e9, 105e9]) {
    const quiet = check({ ...valid, instructions });
    assert.equal(quiet.status, 0, quiet.stdout + quiet.stderr);
    assert.doesNotMatch(quiet.stdout, /improved|pending:/);
  }
  // Faster than the band: listed for the records to re-record, and passing.
  const faster = check({ ...valid, instructions: 80e9 });
  assert.equal(faster.status, 0, faster.stdout + faster.stderr);
  assert.match(faster.stdout, /improved, record pending: runtime\/node\/subject in results\/compile-times\.tsv: 100\.000 G -> 80\.000 G/);
  // A module with no row yet is measured, listed as pending, and passes.
  mkdirSync(join(root, "runtime/node/fresh"), { recursive: true });
  writeFileSync(join(root, "runtime/node/fresh/tsconfig.json"), "{}");
  writeFileSync(join(kept, "runtime_node_fresh.json"), JSON.stringify(valid));
  const pending = check(valid);
  assert.equal(pending.status, 0, pending.stdout + pending.stderr);
  assert.match(pending.stdout, /pending: runtime\/node\/fresh is not recorded in results\/compile-times\.tsv yet: 100\.000 G instructions here/);
  rmSync(join(root, "runtime/node/fresh"), { recursive: true });
  // A row whose module the tree does not have is red.
  writeFileSync(tableFile, `${table}runtime/node/gone\t5\n`);
  const stale = check(valid);
  assert.equal(stale.status, 1, stale.stdout + stale.stderr);
  assert.match(stale.stdout, /STALE +runtime\/node\/gone/);
  writeFileSync(tableFile, table);
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
  writeFileSync(tableFile, table.replace("subject\t100", "subject\t2"));
  const smallBlowup = check({ ...valid, instructions: 20e9 });
  assert.equal(smallBlowup.status, 1);
  assert.match(smallBlowup.stdout, /SLOWER/);
  // tty is below 0.1 G: its published relative limit applies there too.
  writeFileSync(tableFile, table.replace("subject\t100", "subject\t0.052"));
  const tinyBlowup = check({ ...valid, instructions: 0.0624e9, cpu_s: 0.01 });
  assert.equal(tinyBlowup.status, 1, tinyBlowup.stdout + tinyBlowup.stderr);
  assert.match(tinyBlowup.stdout, /SLOWER/);
  writeFileSync(tableFile, table);
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
  const dir = testScratch(t, "counter-listing");
  const nts = join(dir, "nts");
  writeFileSync(nts, `#!/usr/bin/env node
const args=process.argv.slice(2),started=process.cpuUsage();
// A successful arm supplies positive waited-command CPU even when perf rounds
// its footer to milliseconds. The negative arm still ends by its own signal.
while(process.cpuUsage(started).user+process.cpuUsage(started).system<20_000){}
if(args[0]==="hir")process.stdout.write(\`func module#init() -> void {
b0:
  return
}
1 function(s), 0 construct(s) refused
\`);
if(args[1]==="--prepared"&&process.env.NTS_COUNTER_TEST_ENDING==="signal")process.kill(process.pid,"SIGTERM");
`);
  chmodSync(nts, 0o755);
  for (const ending of ["ok", "signal"]) {
    const kept = join(dir, ending);
    const frame = join(dir, `${ending}-instrument.json`);
    const result = spawnTest(process.execPath, [fileURLToPath(new URL("../conformance/integrity.ts", import.meta.url)), "runtime/node/counter-test"], {
      encoding: "utf8", env: { ...fixtureEnvironment(t), NTS_BIN: nts, NTS_INTEGRITY_KEEP: kept, NTS_COUNTER_TEST_ENDING: ending,
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
  const dir = testScratch(t, "counter-run");
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
  const root = testScratch(t, "counter-rc");
  const gate = join(root, "tooling/gate"), kept = join(root, "kept"), results = join(root, "results");
  mkdirSync(gate, { recursive: true }); mkdirSync(kept); mkdirSync(results);
  mkdirSync(join(root, "runtime/node/subject"), { recursive: true });
  writeFileSync(join(root, "runtime/node/subject/tsconfig.json"), "{}");
  for(const input of ["tests/compile-time","runtime/web-platform"])mkdirSync(join(root,input),{recursive:true});
  copyModuleClosure([counterEntry], root,{dataNamespaces:{"runtime/node":"compile counter CLI control","runtime/web-platform":"compile counter CLI control","tests/compile-time":"compile counter CLI control"}});
  assert.deepEqual(compileTimeModules(root),["runtime/node/subject"],"the counter sees only its private project");
  const commands = join(root, "commands.jsonl"), nts = join(root, "nts");
  writeFileSync(nts, `#!/usr/bin/env node
require('node:fs').appendFileSync(${JSON.stringify(commands)}, JSON.stringify({args:process.argv.slice(2), ambient:Object.fromEntries(${JSON.stringify([...Object.keys(FIXED_AMBIENT), "RAYON_NUM_THREADS"])}.map(key=>[key,process.env[key]]))})+'\\n');
`);
  chmodSync(nts, 0o755);
  const sha256 = createHash("sha256").update(readFileSync(nts)).digest("hex");
  writeFileSync(join(kept, "meta.json"), JSON.stringify({ work_profile: COMPILE_WORK_PROFILE, work_settings: COMPILE_WORK_SETTINGS, counter_scope: COUNTER_SCOPE, arm: "nogc", sha256, nts }));
  writeFileSync(join(kept, "runtime_node_subject.json"), JSON.stringify({ arm: "nogc", work_profile: COMPILE_WORK_PROFILE, work_settings: COMPILE_WORK_SETTINGS, counter_scope: COUNTER_SCOPE, status: 0, cpu_s: 10, instructions: 100e9 }));
  const table = `# counter-scope: ${COUNTER_SCOPE}\n# work-profile: ${COMPILE_WORK_PROFILE}\n# regression-ratio: 1.10\nruntime/node/subject\t100\n`;
  writeFileSync(join(results, "compile-times.tsv"), table);
  writeFileSync(join(results, "compile-times-rc.tsv"), `# arm: rc\n${table}`);
  const check = (arm: string) => spawnTest(process.execPath, [join(root, counterEntry), "--arm", arm], {
    encoding: "utf8", env: { ...fixtureEnvironment(t), NTS_BIN: nts, NTS_COMPILE_TIMES_FROM: kept,
      NTS_GATE_RUN_DIR: join(root, "run"), LC_ALL: "C", TZ: "Pacific/Kiritimati", NTS_GATE_TOKEN_HELD: "1", NTS_GATE_TOKENS: "" },
  });
  assert.equal(check("nogc").status, 0);
  const rc = check("rc");
  assert.equal(rc.status, 0, rc.stdout + rc.stderr);
  assert.deepEqual(JSON.parse(readFileSync(commands, "utf8").trim()), {
    args: ["hir", "--prepared", "--checkers", "1", "--rc", "runtime/node/subject"], ambient: {...FIXED_AMBIENT,RAYON_NUM_THREADS:"1"},
  });
  writeFileSync(join(results, "compile-times-rc.tsv"), `# arm: rc\n${table.replace("subject\t100", "subject\t0.000001")}`);
  assert.equal(check("nogc").status, 0);
  const slower = check("rc");
  assert.equal(slower.status, 1, slower.stdout + slower.stderr);
  assert.match(slower.stdout, /SLOWER/);
});
