import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { testScratch } from "../gate/test-scratch.ts";
import { parseTypeScriptRecord, serializeTypeScriptRecord } from "../census/typescript-record.ts";

function compileFixture(t: TestContext): string {
  const root = testScratch(t, "benchmark-compile-row"), directory = join(root, "results/benchmarks/jvm");
  mkdirSync(directory, { recursive: true });
  const metadata = { version: 1, backend: "jvm", commit: "a".repeat(40), compiler: "b".repeat(16), harness: "c".repeat(16), under: "benchmarks/cases", scopes: ["compile"] };
  const cell = { scope: "compile", source: "1".repeat(64), driver: "2".repeat(64), outcome: { kind: "pass" } };
  writeFileSync(join(directory, "outcomes.tsv"), "# nts-benchmark-outcomes " + JSON.stringify(metadata) + "\nbenchmarks/cases/absences\t" + JSON.stringify(cell) + "\n");
  return root;
}

test("a header-only benchmark is an entirely pending inventory, while an empty measured suite is refused", async () => {
  const { parseBenchmarkRecord, serializeBenchmarkRecord, benchmarkInventory, mergeBenchmarkRecord } = await import("./outcomes.ts");
  const metadata = { version: 1, backend: "jvm", commit: "a".repeat(40), compiler: "b".repeat(16), harness: "c".repeat(16), under: "benchmarks/cases", scopes: ["compile"] };
  const header = "# nts-benchmark-outcomes " + JSON.stringify(metadata) + "\n";
  const record = parseBenchmarkRecord(header);
  assert.deepEqual(record.rows, []);
  assert.deepEqual(parseBenchmarkRecord(serializeBenchmarkRecord(record)).rows, []);
  const cells = [{ path: "benchmarks/cases/pending", scope: "compile" as const, source: "1".repeat(64), driver: "2".repeat(64) }];
  assert.deepEqual(benchmarkInventory(record, cells), cells);
  const written = parseBenchmarkRecord(mergeBenchmarkRecord(header, [{ ...cells[0]!, outcome: { kind: "pass" } }]));
  assert.deepEqual(benchmarkInventory(written, cells), []);
  const measured = '# nts-typescript-outcomes ' + JSON.stringify({version:3,backend:"c",commit:"a".repeat(40),compiler:"b".repeat(16),harness:"c".repeat(16),under:"tests/typescript"}) + "\n";
  assert.throws(() => parseTypeScriptRecord(measured), /an empty record measures nothing/);
});

test("benchmark records bind every case and scope without making compiler changes stale", async () => {
  const old = '# nts-typescript-outcomes {"version":3,"backend":"c","commit":"' + "a".repeat(40) +
    '","compiler":"bbbbbbbbbbbbbbbb","harness":"cccccccccccccccc","under":"tests/typescript"}\n' +
    'tests/typescript/control.ts\t{"kind":"pass"}\n';
  assert.equal(serializeTypeScriptRecord(parseTypeScriptRecord(old)), old, "the existing line format stays byte-compatible");
  const module = new URL("./outcomes.ts", import.meta.url);
  assert.ok(existsSync(module), "benchmark consumers need one versioned outcome record authority");
  const { parseBenchmarkRecord, serializeBenchmarkRecord, benchmarkInventory, compareBenchmarkOutcome } = await import(module.href);
  const path = "benchmarks/cases/control";
  const cell = (scope: string, outcome: object) => ({ path, scope, source: "1".repeat(64), driver: "2".repeat(64), outcome });
  const metadata = { version: 1, backend: "c", commit: "a".repeat(40), compiler: "b".repeat(16), harness: "c".repeat(16), under: "benchmarks/cases", scopes: ["compile", "scalar", "workload"] };
  const rows = [cell("compile", { kind: "pass" }), cell("scalar", { kind: "no-scalar-exports" }),
    cell("workload", { kind: "wrong", node: "3ff0000000000000", compiled: "4000000000000000" })];
  const text = serializeBenchmarkRecord({ metadata, rows });
  const parsed = parseBenchmarkRecord(text);
  assert.equal(serializeBenchmarkRecord(parsed), text);
  assert.deepEqual(parsed.rows, rows);
  assert.deepEqual(benchmarkInventory(parsed, rows), []);
  const laterCompiler = parseBenchmarkRecord(text.replace(metadata.compiler, "d".repeat(16)));
  assert.deepEqual(benchmarkInventory(laterCompiler, rows), []);
  const added = { ...rows[0], path: "benchmarks/cases/new" };
  assert.deepEqual(benchmarkInventory(parsed, [...rows, added]), [added], "a case with no row yet is pending, not a failure");
  for (const [changed, message] of [[rows.slice(1), /recorded benchmark scope gone missing: benchmarks\/cases\/control compile/],
    [rows.map((row, index) => index ? row : { ...row, source: "3".repeat(64) }), /source changed/],
    [rows.map((row, index) => index ? row : { ...row, driver: "4".repeat(64) }), /driver changed/]] as const) {
    assert.throws(() => benchmarkInventory(parsed, changed), message);
  }
  for (const malformed of [text + text.split("\n")[1] + "\n", text.replace('"scope":"compile"', '"scope":"unknown"'),
    text.replace('"source":"' + "1".repeat(64) + '"', '"source":"short"'),
    text.split("\n").filter(line => !line.includes('"scope":"workload"')).join("\n"),
    text.replace("benchmarks/cases/control", "benchmarks/cases/../escape")]) {
    assert.throws(() => parseBenchmarkRecord(malformed));
  }
  const pass = { kind: "pass" }, refusal = { kind: "refused", diagnostic: "NTS1001 unsupported shape" };
  const failed = { kind: "build-failure", stage: "link", diagnostic: "undefined symbol work" };
  assert.equal(compareBenchmarkOutcome(pass, pass).ok, true);
  assert.equal(compareBenchmarkOutcome(refusal, refusal).ok, true);
  const wrong = { kind: "wrong", node: "3ff0000000000000", compiled: "4000000000000000" };
  for (const [before, after, word] of [[refusal, pass, "FIXED"], [failed, pass, "FIXED"], [failed, refusal, "REFUSES NOW"],
    [wrong, refusal, "REFUSES NOW"], [wrong, failed, "LOUD NOW"]] as const) {
    assert.deepEqual(compareBenchmarkOutcome(before, after), { word, ok: true, loud: true }, "an improvement passes; the full check records it");
  }
  assert.deepEqual(compareBenchmarkOutcome(refusal, { ...refusal, diagnostic: "NTS1100 a later shape" }), { word: "REFUSES DIFFERENTLY", ok: true, loud: true },
    "a refusal for other reasons is accepted");
  for (const [before, after, word] of [[pass, refusal, "REGRESSED"], [pass, failed, "REGRESSED"], [refusal, failed, "REGRESSED"],
    [refusal, wrong, "REGRESSED"], [failed, wrong, "REGRESSED"], [failed, { ...failed, diagnostic: "undefined symbol rest" }, "CHANGED"],
    [wrong, { ...wrong, compiled: "4008000000000000" }, "CHANGED"]] as const) {
    assert.deepEqual(compareBenchmarkOutcome(before, after), { word, ok: false, loud: false }, "a regression or a change still fails");
  }
  const build = cell("compile", { kind: "build-failure", stage: "emit", diagnostic: "/scratch/a/program.c:17:2: invalid value 42" });
  const normalized = parseBenchmarkRecord(serializeBenchmarkRecord({ metadata, rows: [build, ...rows.slice(1)] }));
  assert.equal(normalized.rows[0].outcome.diagnostic, "<path> invalid value N");
  for (const outcome of [{ kind: "timeout" }, { kind: "memory-cap" }, { kind: "infrastructure-error" },
    { kind: "build-failure", stage: "emit", diagnostic: "the toolchain did not survive" },
    { kind: "build-failure", stage: "compiler-crash", diagnostic: "compiler killed by SIGKILL" }]) {
    assert.throws(() => serializeBenchmarkRecord({ metadata, rows: [cell("compile", outcome), ...rows.slice(1)] }));
  }
});

test("compile-only records explicitly prove no scalar or workload coverage", async () => {
  const { parseBenchmarkRecord, serializeBenchmarkRecord, requireBenchmarkScopes } = await import("./outcomes.ts");
  const metadata = { version: 1 as const, backend: "c" as const, commit: "a".repeat(40), compiler: "b".repeat(16), harness: "c".repeat(16), under: "benchmarks/cases" as const, scopes: ["compile" as const] };
  const rows = [{ path: "benchmarks/cases/control", scope: "compile" as const, source: "1".repeat(64), driver: "2".repeat(64), outcome: { kind: "refused" as const, diagnostic: "NTS4001 unsupported shape" } }];
  const contents = serializeBenchmarkRecord({ metadata, rows });
  const parsed = parseBenchmarkRecord(contents);
  requireBenchmarkScopes(parsed, ["compile"]);
  for (const scope of ["scalar", "workload"] as const) assert.throws(() => requireBenchmarkScopes(parsed, [scope]), /does not cover/);
  assert.equal(parsed.rows[0]!.outcome.kind, "refused");
  for (const scopes of [[], ["compile", "compile"], ["unknown"], ["scalar"], ["compile", "workload"]]) {
    assert.throws(() => parseBenchmarkRecord(contents.replace('"scopes":["compile"]', '"scopes":' + JSON.stringify(scopes))));
  }
});

test("no scalar exports needs a measured canonical workload beside it", async () => {
  const { serializeBenchmarkRecord } = await import("./outcomes.ts");
  const metadata = { version: 1 as const, backend: "jvm" as const, commit: "a".repeat(40), compiler: "b".repeat(16), harness: "c".repeat(16), under: "benchmarks/cases" as const, scopes: ["scalar" as const, "workload" as const] };
  const cell = (scope, outcome) => ({ path: "benchmarks/cases/control", scope, source: "1".repeat(64), driver: "2".repeat(64), outcome });
  for (const outcome of [{ kind: "pass" }, { kind: "wrong", node: "a", compiled: "b" }]) {
    assert.doesNotThrow(() => serializeBenchmarkRecord({ metadata, rows: [cell("scalar", { kind: "no-scalar-exports" }), cell("workload", outcome)] }));
  }
  for (const outcome of [{ kind: "refused", diagnostic: "NTS4001 refused" }, { kind: "build-failure", stage: "link", diagnostic: "cannot build" }]) {
    assert.throws(() => serializeBenchmarkRecord({ metadata, rows: [cell("scalar", { kind: "no-scalar-exports" }), cell("workload", outcome)] }), /measured workload/);
  }
});

test("the full check's writer adds pending rows and rewrites improved ones, every other line byte for byte", async () => {
  const { mergeBenchmarkRecord, serializeBenchmarkRecord } = await import("./outcomes.ts");
  const metadata = { version: 1 as const, backend: "c" as const, commit: "a".repeat(40), compiler: "b".repeat(16), harness: "c".repeat(16), under: "benchmarks/cases" as const, scopes: ["compile" as const] };
  const cell = (name: string, outcome: { kind: "pass" } | { kind: "refused"; diagnostic: string }) =>
    ({ path: `benchmarks/cases/${name}`, scope: "compile" as const, source: "1".repeat(64), driver: "2".repeat(64), outcome });
  const refused = { kind: "refused" as const, diagnostic: "NTS4001 unsupported shape" };
  const before = serializeBenchmarkRecord({ metadata, rows: [cell("alpha", { kind: "pass" }), cell("gamma", refused), cell("omega", refused)] });
  const after = serializeBenchmarkRecord({ metadata, rows: [cell("alpha", { kind: "pass" }), cell("beta", { kind: "pass" }), cell("gamma", { kind: "pass" }), cell("omega", refused)] });
  const lines = before.split("\n"), merged = mergeBenchmarkRecord(before, [cell("gamma", { kind: "pass" }), cell("beta", { kind: "pass" })]);
  assert.equal(merged, after, "the merge writes what a full record would");
  assert.deepEqual(merged.split("\n").filter(line => lines.includes(line)), [lines[0], lines[1], lines[3], ""], "header and untouched rows stay byte for byte");
  assert.equal(mergeBenchmarkRecord(before, []), before, "nothing pending changes nothing");
  assert.throws(() => mergeBenchmarkRecord(before, [cell("beta", { kind: "pass" }), cell("beta", refused)]), /duplicate/);
});

const FIELD = "timeout";
test("a compile past its bound is a recorded timeout, ranked as a loud defect", async () => {
  const { parseBenchmarkOutcome, serializeBenchmarkRecord, compareBenchmarkOutcome } = await import(new URL("./outcomes.ts", import.meta.url).href);
  const { compileOutcome } = await import(new URL("./compile-producer.ts", import.meta.url).href);
  const timeout = { kind: "timeout", stage: "compile" };
  assert.deepEqual(parseBenchmarkOutcome(timeout), timeout);
  // A command the supervisor stopped at its compile bound (ActiveResult's field of that name).
  const stopped = (extra: object) => ({ [FIELD]: "nts used its 600 s CPU bound", status: null, signal: "SIGKILL", out: "", stdout: "", stderr: "", elapsedMs: 1, ...extra });
  assert.deepEqual(compileOutcome(stopped({}), "emit"), timeout);
  assert.throws(() => compileOutcome(stopped({ memoryKilled: true }), "emit"), /NOT MEASURED/, "a memory kill is never a timeout");
  const metadata = { version: 1, backend: "jvm", commit: "a".repeat(40), compiler: "b".repeat(16), harness: "c".repeat(16), under: "benchmarks/cases", scopes: ["compile"] };
  const row = (outcome: object) => ({ path: "benchmarks/cases/spin", scope: "compile", source: "1".repeat(64), driver: "2".repeat(64), outcome });
  assert.doesNotThrow(() => serializeBenchmarkRecord({ metadata, rows: [row(timeout)] }));
  assert.throws(() => serializeBenchmarkRecord({ metadata, rows: [row({ kind: "timeout", stage: "run" })] }), /only compiling/);
  assert.equal(compareBenchmarkOutcome(timeout, timeout).word, "reproduces");
  assert.equal(compareBenchmarkOutcome({ kind: "pass" }, timeout).word, "REGRESSED");
  assert.equal(compareBenchmarkOutcome(timeout, { kind: "pass" }).word, "FIXED");
  assert.equal(compareBenchmarkOutcome(timeout, { kind: "refused", diagnostic: "NTS1001 x" }).word, "REFUSES NOW");
  assert.equal(compareBenchmarkOutcome({ kind: "wrong", node: "1", compiled: "2" }, timeout).word, "LOUD NOW");
});

test("a compile timeout elsewhere is judged against the benchmark's compile row", async t => {
  const { judgeCompileTimeout, recordedCompileOutcome, parseBenchmarkRecord } = await import(new URL("./outcomes.ts", import.meta.url).href);
  const { compileTimeoutLine } = await import(new URL("./compile-outcome.ts", import.meta.url).href);
  assert.equal(judgeCompileTimeout({ kind: "timeout", stage: "compile" }), "as recorded");
  assert.equal(judgeCompileTimeout(null), "pending");
  for (const recorded of [{ kind: "pass" }, { kind: "refused", diagnostic: "NTS1001 x" }, { kind: "build-failure", stage: "emit", diagnostic: "error: x" }]) {
    assert.equal(judgeCompileTimeout(recorded), "worse", recorded.kind);
  }
  const header = `# nts-benchmark-outcomes {"version":1,"backend":"jvm","commit":"${"a".repeat(40)}","compiler":"${"b".repeat(16)}","harness":"${"c".repeat(16)}","under":"benchmarks/cases","scopes":["compile"]}\n`;
  const row = (name: string, outcome: object) => `benchmarks/cases/${name}\t${JSON.stringify({ scope: "compile", source: "1".repeat(64), driver: "2".repeat(64), outcome })}\n`;
  const record = parseBenchmarkRecord(header + row("spin", { kind: "timeout", stage: "compile" }));
  assert.deepEqual(recordedCompileOutcome(record, "benchmarks/cases/spin"), { kind: "timeout", stage: "compile" });
  assert.equal(recordedCompileOutcome(record, "benchmarks/cases/new"), null);
  const root = compileFixture(t);
  assert.equal(compileTimeoutLine(root, "jvm", "benchmarks/cases/absences"), "worse: the record says pass");
  assert.match(compileTimeoutLine(root, "jvm", "benchmarks/cases/no-such-case"), /^pending: benchmarks\/cases\/no-such-case is not recorded in results\/benchmarks\/jvm\/outcomes\.tsv yet$/);
});

test("a compile that declined elsewhere is judged against the benchmark's compile row", async t => {
  const { judgeCompileDecline } = await import(new URL("./outcomes.ts", import.meta.url).href);
  const { compileDeclineLine } = await import(new URL("./compile-outcome.ts", import.meta.url).href);
  for (const recorded of [{ kind: "refused", diagnostic: "NTS1001 x" }, { kind: "build-failure", stage: "compiler-crash", diagnostic: "invalid HIR" }, { kind: "timeout", stage: "compile" }]) {
    assert.equal(judgeCompileDecline(recorded), "as recorded", recorded.kind);
  }
  assert.equal(judgeCompileDecline({ kind: "pass" }), "worse");
  assert.equal(judgeCompileDecline(null), "pending");
  const root = compileFixture(t);
  assert.equal(compileDeclineLine(root, "jvm", "benchmarks/cases/absences"), "worse: the record says pass");
  assert.match(compileDeclineLine(root, "jvm", "benchmarks/cases/no-such-case"), /^pending: benchmarks\/cases\/no-such-case is not recorded in results\/benchmarks\/jvm\/outcomes\.tsv yet$/);
});
