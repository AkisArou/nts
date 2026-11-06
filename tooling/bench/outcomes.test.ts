import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { parseTypeScriptRecord, serializeTypeScriptRecord } from "../census/typescript-record.ts";

test("benchmark records bind every case and scope without making compiler changes stale", async () => {
  const old = '# nts-typescript-outcomes {"version":3,"backend":"c","commit":"' + "a".repeat(40) +
    '","compiler":"bbbbbbbbbbbbbbbb","harness":"cccccccccccccccc","under":"tests/typescript"}\n' +
    'tests/typescript/control.ts\t{"kind":"pass"}\n';
  assert.equal(serializeTypeScriptRecord(parseTypeScriptRecord(old)), old, "the existing line format stays byte-compatible");
  const module = new URL("./outcomes.ts", import.meta.url);
  assert.ok(existsSync(module), "benchmark consumers need one versioned outcome record authority");
  const { parseBenchmarkRecord, serializeBenchmarkRecord, assertBenchmarkInventory, compareBenchmarkOutcome } = await import(module.href);
  const path = "benchmarks/cases/control";
  const cell = (scope: string, outcome: object) => ({ path, scope, source: "1".repeat(64), driver: "2".repeat(64), outcome });
  const metadata = { version: 1, backend: "c", commit: "a".repeat(40), compiler: "b".repeat(16), harness: "c".repeat(16), under: "benchmarks/cases", scopes: ["compile", "scalar", "workload"] };
  const rows = [cell("compile", { kind: "pass" }), cell("scalar", { kind: "no-scalar-exports" }),
    cell("workload", { kind: "wrong", node: "3ff0000000000000", compiled: "4000000000000000" })];
  const text = serializeBenchmarkRecord({ metadata, rows });
  const parsed = parseBenchmarkRecord(text);
  assert.equal(serializeBenchmarkRecord(parsed), text);
  assert.deepEqual(parsed.rows, rows);
  assertBenchmarkInventory(parsed, rows);
  const laterCompiler = parseBenchmarkRecord(text.replace(metadata.compiler, "d".repeat(16)));
  assertBenchmarkInventory(laterCompiler, rows);
  for (const changed of [rows.slice(1), [...rows, { ...rows[0], path: "benchmarks/cases/new" }],
    rows.map((row, index) => index ? row : { ...row, source: "3".repeat(64) }),
    rows.map((row, index) => index ? row : { ...row, driver: "4".repeat(64) })]) {
    assert.throws(() => assertBenchmarkInventory(parsed, changed));
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
  for (const [before, after] of [[pass, refusal], [refusal, pass], [failed, pass], [failed, refusal]]) {
    assert.equal(compareBenchmarkOutcome(before, after).ok, false, "every movement requires an explicit record update");
  }
  assert.equal(compareBenchmarkOutcome(failed, pass).word, "FIXED");
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
