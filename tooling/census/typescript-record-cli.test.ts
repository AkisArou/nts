// Exercise the real consumer with versioned saved observations. No source case
// or checked-in record is mutated; the compiler still runs its own self-checks.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { harnessHashOf } from "./project.ts";
import { parseObservation, parseTypeScriptRecord, serializeTypeScriptRecord, TYPESCRIPT_OBSERVATIONS_VERSION, type TypeScriptObservation } from "./typescript-record.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const binary = resolve(root, process.env.NTS_BIN ?? "target/release/nts");
const pass: TypeScriptObservation = { kind: "pass" };
const wrong: TypeScriptObservation = { kind: "wrong", errorClass: "Test262Error",
  failure: { exit: 1, signal: null, output: "uncaught Test262Error: Expected 7, got 8" } };
const refused: TypeScriptObservation = { kind: "refused", diagnostics: [{ code: "NTS1001", where: "body" }] };
const invalid: TypeScriptObservation = { kind: "invalid-hir", validator: "CallArgumentType { expected: Float64, found: Erased }" };
const abort: TypeScriptObservation = { kind: "runtime-abort", failure: { exit: null, signal: "SIGABRT", output: "program aborted" } };
const host = (from: string, to: string, frame: number): TypeScriptObservation => ({ kind: "runtime-abort",
  failure: { exit: 1, signal: null, output: `Exception in thread "main" java.lang.ClassCastException: class nts.gen.${from} cannot be cast to class nts.gen.${to}\n\tat nts.gen.Program.method${frame}(Unknown Source)` } });
function row(observed: TypeScriptObservation): object {
  switch (observed.kind) {
    case "pass": return { bucket: "strict-pass" };
    case "wrong": return { bucket: "threw", thrown: observed.errorClass, runtimeFailure: observed.failure };
    case "refused": return { bucket: "unsupported", why: "lowering", first: "test refusal", named: [],
      diagnostics: observed.diagnostics.map(d => ({ ...d, message: "test refusal", raw: "test refusal", named: [] })) };
    case "invalid-hir": return { bucket: "invalid-hir", validatorError: observed.validator };
    case "runtime-abort": return { bucket: "crash", runtimeFailure: observed.failure };
  }
}

test("the CLI holds every recorded outcome and fails closed before recorded selection", t => {
  assert.ok(existsSync(binary), `compiler missing: ${binary}; set NTS_BIN to a built pin`);
  const base = join(homedir(), ".cache/nts/typescript-record-cli-tests");
  mkdirSync(base, { recursive: true });
  const scratch = mkdtempSync(join(base, "t-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const recorded = parseTypeScriptRecord(readFileSync(join(root, "results/typescript/c/cases.tsv"), "utf8"));
  const target = [...recorded.cases.keys()][0];
  const fingerprint = createHash("sha256").update(readFileSync(binary)).digest("hex").slice(0, 16);
  const one = join(scratch, "one.tsv"), expected = join(scratch, "expected.tsv"), rows = join(scratch, "rows.jsonl"), json = join(scratch, "report.json");
  writeFileSync(one, serializeTypeScriptRecord({ metadata: recorded.metadata, cases: new Map([[target, pass]]) }));
  function invoke(contents: string, observed: object, observations = TYPESCRIPT_OBSERVATIONS_VERSION) {
    writeFileSync(expected, contents);
    writeFileSync(rows, JSON.stringify({ fingerprint, under: "tests/typescript", harness: harnessHashOf("ts"), observations }) + "\n" +
      JSON.stringify({ path: target, ...observed }) + "\n");
    rmSync(json, { force: true });
    return spawnSync(process.execPath, ["tooling/census/conformance262.ts", "--suite", "typescript", "--backend", "c",
      "--check", expected, "--paths-from", one, "--sample", "1", "--jobs", "1", "--rows", rows, "--resume", "--json", json],
      { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, NTS_BIN: binary, NTS_CENSUS_DIR: join(scratch, "run") } });
  }
  for (const [before, after, word, status] of [
    [pass, wrong, "REGRESSED", 1], [refused, wrong, "CHANGED", 1], [invalid, abort, "CHANGED", 1],
    [wrong, { ...wrong, failure: { ...wrong.failure, output: wrong.failure.output + "9" } }, "CHANGED", 1],
    [wrong, refused, "REFUSES NOW", 0], [invalid, pass, "FIXED", 0], [refused, refused, "reproduces", 0],
    [host("Cell$29$", "Type27", 42), host("Cell$39$", "Type37", 52), "reproduces", 0],
    [host("Cell$29$", "Type27", 42), host("Tuple25", "Type37", 52), "CHANGED", 1],
  ] as const) {
    const cases = new Map(recorded.cases);
    cases.set(target, before);
    const result = invoke(serializeTypeScriptRecord({ metadata: recorded.metadata, cases }), row(after));
    assert.equal(result.status, status, result.stdout + result.stderr);
    const report = JSON.parse(readFileSync(json, "utf8"));
    assert.equal(report.record_version, 2);
    assert.deepEqual(report.observations[target], parseObservation(after));
    assert.equal(report.comparison[word]?.length ?? 0, word === "reproduces" ? 0 : 1);
  }
  const withRefusal = new Map(recorded.cases);
  withRefusal.set(target, refused);
  const reworded = row(refused) as { diagnostics: { message: string; raw: string }[] };
  reworded.diagnostics[0].message = "reworded reason Queue<35>";
  reworded.diagnostics[0].raw = "reworded reason Queue<35>";
  const held = invoke(serializeTypeScriptRecord({ metadata: recorded.metadata, cases: withRefusal }), reworded);
  assert.equal(held.status, 0, held.stdout + held.stderr);
  assert.deepEqual(JSON.parse(readFileSync(json, "utf8")).observations[target], refused);
  const checkerRefusal: TypeScriptObservation = { kind: "refused", diagnostics: [{ code: "TS2322", where: "body" }] };
  const changedCode = invoke(serializeTypeScriptRecord({ metadata: recorded.metadata, cases: withRefusal }), row(checkerRefusal));
  assert.equal(changedCode.status, 1, changedCode.stdout + changedCode.stderr);
  assert.equal(JSON.parse(readFileSync(json, "utf8")).comparison.CHANGED.length, 1);
  const withValidator = new Map(recorded.cases);
  withValidator.set(target, { kind: "invalid-hir", validator: "Queue<35>#push TypeId(42) type 43 at: 7" });
  const shifted = invoke(serializeTypeScriptRecord({ metadata: recorded.metadata, cases: withValidator }),
    { bucket: "invalid-hir", validatorError: "Queue<45>#push TypeId(52) type 53 at: 7" });
  assert.equal(shifted.status, 0, shifted.stdout + shifted.stderr);
  assert.equal(JSON.parse(readFileSync(json, "utf8")).observations[target].validator, "Queue<N>#push TypeId(N) type N at: 7");
  const contents = serializeTypeScriptRecord(recorded);
  for (const [mutated, message] of [
    [contents.split("\n").filter(line => !line.startsWith(target + "\t")).join("\n"), "new case has no record"],
    [contents + "tests/typescript/missing-source.ts\t{\"kind\":\"pass\"}\n", "recorded case gone missing"],
    [contents + contents.split("\n")[1] + "\n", "duplicate recorded case"],
    [contents.replace('"version":2', '"version":99'), "unsupported TypeScript record version"],
  ]) {
    const result = invoke(mutated, row(pass));
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.ok((result.stdout + result.stderr).includes(message), result.stdout + result.stderr);
    assert.equal(existsSync(json), false, "an unmeasured run must not publish a report");
  }
  const unmeasured = invoke(contents, { bucket: "timeout" });
  assert.equal(unmeasured.status, 2, unmeasured.stdout + unmeasured.stderr);
  assert.equal(existsSync(json), false, "a timeout cannot become an expected result");
  const oldRows = invoke(contents, row(pass), TYPESCRIPT_OBSERVATIONS_VERSION - 1);
  assert.equal(oldRows.status, 2, oldRows.stdout + oldRows.stderr);
  assert.equal(existsSync(json), false, "old diagnostic locations cannot become a current record");
});
