import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDiagnostics } from "./attempt262.ts";
import { populationOf } from "./project.ts";
import { compareTypeScriptObservation, mergeTypeScriptRecord, observationFromRow,
  parseObservation, parseTypeScriptRecord, pendingCases, serializeTypeScriptRecord,
  type TypeScriptObservation, type TypeScriptRecord } from "./typescript-record.ts";
import { acceptedChange, improves } from "../conformance/outcome-transition.ts";

const observations: TypeScriptObservation[] = [
  { kind: "pass" },
  { kind: "wrong", errorClass: "Test262Error", failure: { exit: 1, signal: null, output: "uncaught Test262Error: Expected 7, got 8" } },
  { kind: "refused", diagnostics: [{ code: "NTS1001", where: "body" }] },
  { kind: "invalid-hir", validator: "CallArgumentType { expected: Float64, found: Erased }" },
  { kind: "runtime-abort", failure: { exit: null, signal: "SIGABRT", output: "nts: refused: index 2 is outside [0, 1)" } },
];
const paths = observations.map((_, index) => `tests/typescript/records/case-${index}.ts`);

test("wrong output before a native stop is recorded as wrong with its exact witness", () => {
  const raw = { bucket: "wrong-output", printed: { stdout: "wrong\n", stderr: "" }, nodeOutput: { stdout: "right\nfinally\n", stderr: "" },
    runtimeFailure: { exit: 1, signal: null, output: "nts: refused: unavailable representation" } };
  const observation = observationFromRow(raw);
  const before: TypeScriptRecord = { metadata: { ...record().metadata, version: 3 },
    cases: new Map([["tests/typescript/records/output.ts", observation]]) };
  assert.deepEqual(parseTypeScriptRecord(serializeTypeScriptRecord(before)), before);
  assert.equal(compareTypeScriptObservation(observations[0], observation).word, "REGRESSED");
  assert.equal(compareTypeScriptObservation(observation, observations[0]).word, "FIXED");
  assert.equal(compareTypeScriptObservation(observation, observations[2]).word, "REFUSES NOW");
  assert.equal(compareTypeScriptObservation(observation, observation).word, "reproduces");
  assert.equal(compareTypeScriptObservation(observation, observationFromRow({ ...raw, printed: { stdout: "wrong 2\n", stderr: "" } })).word, "CHANGED");
  assert.throws(() => observationFromRow({ ...raw, printed: { stdout: "right\n", stderr: "" } }), /valid prefix/);
  assert.throws(() => observationFromRow({ ...raw, runtimeFailure: { ...raw.runtimeFailure, output: "nts: uncaught Error: source" } }), /native decline/);
  assert.throws(() => parseTypeScriptRecord(serializeTypeScriptRecord(before).replace('"version":3', '"version":2')), /version 3/);
});
function record(): TypeScriptRecord {
  return { metadata: { version: 2, backend: "c", commit: "a".repeat(40), compiler: "b".repeat(16),
    harness: "c".repeat(16), under: "tests/typescript" }, cases: new Map(paths.map((path, i) => [path, observations[i]])) };
}

test("a complete record round-trips every outcome and selects refused and invalid cases too", () => {
  const before = record();
  const contents = serializeTypeScriptRecord(before);
  assert.deepEqual(parseTypeScriptRecord(contents), before);
  const sources = paths.map(path => ({ path, source_hash: path }));
  const selected = populationOf(sources, { named: { file: "record.tsv", text: contents } });
  assert.ok("population" in selected);
  assert.deepEqual(selected.population.map(row => row.path), paths);
});

test("malformed, legacy, incomplete and contradictory observations cannot be records", () => {
  for (const input of [null, { kind: "unknown" }, { kind: "pass", output: "ignored" },
    { kind: "wrong", errorClass: "Error" }, { kind: "invalid-hir", validator: "" },
    { kind: "refused", diagnostics: [] },
    { kind: "refused", diagnostics: [{ code: "bad-code", where: "none" }] },
    { kind: "refused", diagnostics: [{ code: "NTS1001", where: "elsewhere" }] },
    { kind: "runtime-abort", failure: { exit: 1, signal: "SIGABRT", output: "" } },
    { kind: "runtime-abort", failure: { exit: null, signal: null, output: "" } },
    { kind: "runtime-abort", failure: { exit: -1, signal: null, output: "" } }]) {
    assert.throws(() => parseObservation(input), JSON.stringify(input));
  }
  const contents = serializeTypeScriptRecord(record());
  for (const mutate of [
    (text: string) => text.replace('"version":2', '"version":1'),
    (text: string) => text.replace('"backend":"c"', '"backend":"wasm"'),
    (text: string) => text.replace('"under":"tests/typescript"', '"under":"tests/typescript/elsewhere"'),
    (text: string) => text.replace(paths[0], "tests/typescript/../escape.ts"),
    (text: string) => text + text.split("\n")[1] + "\n",
    (text: string) => text.split("\n")[0] + "\n",
    (text: string) => text.replace(/# nts-typescript-outcomes .*/, "# old unversioned record"),
  ]) assert.throws(() => parseTypeScriptRecord(mutate(contents)));
});

test("a case with no row is pending, and a record cannot hide a deleted case", () => {
  assert.deepEqual(pendingCases(record(), paths), []);
  assert.deepEqual(pendingCases(record(), [...paths, "tests/typescript/new.ts"]), ["tests/typescript/new.ts"], "a new case passes as pending");
  assert.throws(() => pendingCases(record(), paths.slice(1)), /recorded case gone missing: tests\/typescript\/records\/case-0\.ts/, "a stale row still fails");
  assert.throws(() => pendingCases(record(), [...paths, paths[0]]), /duplicate source/);
  const missing = record();
  missing.cases.delete(paths[0]);
  assert.deepEqual(pendingCases(missing, paths), [paths[0]]);
});

test("an improvement passes and a regression fails, by the shared ratchet", () => {
  const [pass, wrong, refused, invalid, abort] = observations;
  for (const [before, after] of [[wrong, pass], [refused, pass], [invalid, refused], [abort, refused], [wrong, abort], [wrong, invalid]]) {
    const verdict = compareTypeScriptObservation(before, after);
    assert.ok(verdict.ok && improves(verdict), `${before.kind} -> ${after.kind}: ${verdict.word}`);
  }
  for (const [before, after] of [[pass, wrong], [pass, refused], [refused, wrong], [refused, invalid], [abort, wrong], [invalid, wrong]]) {
    const verdict = compareTypeScriptObservation(before, after);
    assert.ok(!verdict.ok && !improves(verdict) && verdict.word === "REGRESSED", `${before.kind} -> ${after.kind}: ${verdict.word}`);
  }
});

test("a case refused before and after, for other reasons, is accepted but no improvement", () => {
  // tests/typescript/implicit-calls/order-entry-key-assign-setter-union.ts: the
  // Object.assign fix lifted NTS1001, and the case reached a later refusal.
  const before: TypeScriptObservation = { kind: "refused", diagnostics: [{ code: "NTS1001", where: "body" }, { code: "NTS1003", where: "body" }] };
  const after: TypeScriptObservation = { kind: "refused", diagnostics: [{ code: "NTS1003", where: "body" }, { code: "NTS1100", where: "body" }] };
  const verdict = compareTypeScriptObservation(before, after);
  assert.deepEqual(verdict, { word: "REFUSES DIFFERENTLY", ok: true, loud: true });
  assert.ok(acceptedChange(verdict) && !improves(verdict));
  const [, wrong, , invalid, abort] = observations;
  for (const [was, now] of [[wrong, { ...wrong!, errorClass: "TypeError" }], [invalid, abort]] as const) {
    assert.equal(compareTypeScriptObservation(was!, now!).word, "CHANGED", `${was!.kind} -> ${now!.kind} stays red`);
  }
});

test("the full check's writer adds pending rows and rewrites improved ones, every other line byte for byte", () => {
  // A row in an older spelling (diagnostics unsorted) is kept as it was written.
  const legacy = `${paths[2]}\t{"kind":"refused","diagnostics":[{"code":"NTS1005","where":"body"},{"code":"NTS1001","where":"body"}]}`;
  const contents = serializeTypeScriptRecord(record()).split("\n").map(line => line.startsWith(paths[2] + "\t") ? legacy : line).join("\n");
  const added = "tests/typescript/records/case-10.ts";
  const merged = mergeTypeScriptRecord(contents, new Map([[paths[3]!, { kind: "pass" }], [added, observations[1]!]]));
  const expected = record();
  expected.cases.set(paths[2]!, { kind: "refused", diagnostics: [{ code: "NTS1001", where: "body" }, { code: "NTS1005", where: "body" }] });
  expected.cases.set(paths[3]!, { kind: "pass" }).set(added, observations[1]!);
  assert.deepEqual(parseTypeScriptRecord(merged), parseTypeScriptRecord(serializeTypeScriptRecord(expected)));
  const before = contents.split("\n"), after = merged.split("\n");
  assert.deepEqual(after.map(line => line.split("\t")[0]), serializeTypeScriptRecord(expected).split("\n").map(line => line.split("\t")[0]),
    "a new row goes where a full record would put it");
  assert.deepEqual(after.filter(line => !line.startsWith(paths[3] + "\t") && !line.startsWith(added + "\t")),
    before.filter(line => !line.startsWith(paths[3] + "\t")), "header and every other row, byte for byte");
  assert.ok(after.includes(legacy), "an older spelling of an untouched row survives");
  assert.equal(mergeTypeScriptRecord(contents, new Map()), contents, "nothing pending changes nothing");
});

test("observations use the unredacted producer facts, never the display summary", () => {
  const diagnostics = parseDiagnostics("/case/src/main.ts:3:1: NTS1001 method `put` has no declaration is not supported by this lowering yet\n" +
    "/case/src/main.ts:3:1: NTS1005 dependency cascade");
  const refused = observationFromRow({ bucket: "unsupported", why: "lowering", diagnostics });
  assert.equal(refused.kind, "refused");
  assert.deepEqual(refused.diagnostics, [
    { code: "NTS1001", where: "body" },
    { code: "NTS1005", where: "body" },
  ]);
  assert.equal(observationFromRow({ bucket: "unsupported", why: "backend", diagnostics }).kind, "refused");
  assert.equal(observationFromRow({ bucket: "unsupported", why: "lowering", diagnostics: diagnostics.slice(1) }).kind,
    "refused", "a printed cascade is an observed refusal even if its root was omitted");
  const distinct = parseDiagnostics("NTS1001 type 12 cannot become type 20\nNTS1001 type 13 cannot become type 20\nNTS1001 type 12 cannot become type 20");
  assert.equal(distinct.length, 2, "display redaction cannot merge distinct raw diagnostics");
  const long = "same redacted display; " + "x".repeat(300);
  const before = observationFromRow({ bucket: "threw", thrown: "Test262Error", message: "same display",
    runtimeFailure: { exit: 1, signal: null, output: long + "7" } });
  const after = observationFromRow({ bucket: "threw", thrown: "Test262Error", message: "same display",
    runtimeFailure: { exit: 1, signal: null, output: long + "8" } });
  assert.equal(compareTypeScriptObservation(before, after).word, "CHANGED");
  assert.deepEqual(observationFromRow({ bucket: "invalid-hir", first: "redacted", validatorError: observations[3].kind === "invalid-hir" ? observations[3].validator : "" }), observations[3]);
  for (const row of [{ bucket: "timeout" }, { bucket: "memory-cap" }, { bucket: "infrastructure-error" },
    { bucket: "unsupported", why: "link", first: "" }, { bucket: "unsupported", why: "harness" },
    { bucket: "crash", why: "emit", first: "SIGABRT" }, { bucket: "invalid-hir", first: "display only" },
    { bucket: "threw", thrown: "Error", message: "display only" }]) assert.throws(() => observationFromRow(row));
});

test("the complete kind transition matrix holds regressions and permits progress", () => {
  // pass, wrong (silent), refused, invalid-hir (loud), runtime-abort (loud)
  const words = [
    ["holds", "REGRESSED", "REGRESSED", "REGRESSED", "REGRESSED"],
    ["FIXED", "reproduces", "REFUSES NOW", "LOUD NOW", "LOUD NOW"],
    ["FIXED", "REGRESSED", "reproduces", "REGRESSED", "REGRESSED"],
    ["FIXED", "REGRESSED", "REFUSES NOW", "reproduces", "CHANGED"],
    ["FIXED", "REGRESSED", "REFUSES NOW", "CHANGED", "reproduces"],
  ];
  for (let i = 0; i < observations.length; i++) for (let j = 0; j < observations.length; j++) {
    const decision = compareTypeScriptObservation(observations[i], observations[j]);
    assert.equal(decision.word, words[i][j], `${observations[i].kind} -> ${observations[j].kind}`);
    assert.equal(decision.ok, ["holds", "reproduces", "FIXED", "REFUSES NOW", "LOUD NOW"].includes(words[i][j]));
    assert.equal(decision.loud, ["FIXED", "REFUSES NOW", "LOUD NOW"].includes(words[i][j]));
  }
  for (const index of [1, 2, 3, 4]) {
    const changed = JSON.stringify(observations[index]).replace("7", "9").replace("NTS1001", "TS2322")
      .replace("Float64", "Int32").replace("index 2", "index 3");
    // A refusal for other reasons is accepted; a wrong answer or a loud defect, changed, is not.
    assert.equal(compareTypeScriptObservation(observations[index], parseObservation(JSON.parse(changed))).word,
      observations[index]!.kind === "refused" ? "REFUSES DIFFERENTLY" : "CHANGED");
  }
});

test("a refusal's prose and order do not change its sorted code/location identity", () => {
  const observed = (diagnostics: object[]) => observationFromRow({ bucket: "unsupported", why: "lowering", diagnostics });
  const before = observed([{ code: "NTS1001", raw: "old reason Queue<35>", where: "body" },
    { code: "NTS1005", raw: "cascade", where: "other" }]);
  const after = observed([{ code: "NTS1005", raw: "rewritten cascade", where: "other" },
    { code: "NTS1001", raw: "new reason Queue<47>", where: "body" },
    { code: "NTS1001", raw: "another reason", where: "body" }]);
  assert.equal(compareTypeScriptObservation(before, after).word, "reproduces");
  // A different code is a different refusal: accepted, and its row rewritten.
  const changed = observed([{ code: "TS2322", raw: "same prose", where: "body" }]);
  assert.equal(compareTypeScriptObservation(before, changed).word, "REFUSES DIFFERENTLY");
});

test("generated validator numbers move without changing names, positions or outcomes", () => {
  const validator = (text: string) => parseObservation({ kind: "invalid-hir", validator: text });
  const text = 'CallArgumentType { func: "PerChannel<50>#constructor", callee: "MemoryTable<42>#add", at: 7, expected: TypeId(35), found: type 36 }';
  const before = validator(text);
  const shifted = validator(text.replace("<50>", "<60>").replace("<42>", "<52>").replace("Id(35)", "Id(45)").replace("type 36", "type 46"));
  assert.equal(compareTypeScriptObservation(before, shifted).word, "reproduces");
  assert.equal(compareTypeScriptObservation(before, validator(text.replace("PerChannel", "OtherChannel"))).word, "CHANGED");
  assert.equal(compareTypeScriptObservation(before, validator(text.replace("at: 7", "at: 8"))).word, "CHANGED");
  const wrong = (output: string) => parseObservation({ kind: "wrong", errorClass: "Error", failure: { exit: 1, signal: null, output } });
  assert.equal(compareTypeScriptObservation(wrong("value <35>"), wrong("value <45>")).word, "CHANGED");
  const abort = (output: string) => parseObservation({ kind: "runtime-abort", failure: { exit: null, signal: "SIGABRT", output } });
  assert.equal(compareTypeScriptObservation(abort("value type 35"), abort("value type 45")).word, "CHANGED");
});

test("host exceptions retain their class and layout message without generated frames", () => {
  const host = (from: string, to: string, frame: number) => observationFromRow({ bucket: "crash", why: "host exception",
    runtimeFailure: { exit: 1, signal: null, output: `Exception in thread "main" java.lang.ClassCastException: class nts.gen.${from} cannot be cast to class nts.gen.${to}\n\tat nts.gen.Program.method${frame}(Unknown Source)` } });
  const before = host("Cell$29$", "Type27", 42);
  const shifted = host("Cell$39$", "Type37", 52);
  assert.equal(compareTypeScriptObservation(before, shifted).word, "reproduces");
  assert.equal(compareTypeScriptObservation(before, host("Tuple25", "Type37", 52)).word, "CHANGED");
  assert.equal(before.kind, "runtime-abort");
  assert.equal(before.failure.output, "java.lang.ClassCastException: class nts.gen.Cell$N$ cannot be cast to class nts.gen.TypeN");
  const native = "nts: refused: nts.gen.Cell$29$ with tag 3";
  const abort = parseObservation({ kind: "runtime-abort", failure: { exit: 1, signal: null, output: native } });
  assert.equal(abort.kind === "runtime-abort" && abort.failure.output, native);
  const wrongText = 'Exception in thread "main" java.lang.ClassCastException: nts.gen.Cell$29$\nobserved value 42';
  const wrong = parseObservation({ kind: "wrong", errorClass: "Error", failure: { exit: 1, signal: null, output: wrongText } });
  assert.equal(wrong.kind === "wrong" && wrong.failure.output, wrongText);
});
