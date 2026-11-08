// The dex record (tooling/android/dex-record.ts): what d8 did for each target,
// against its row. A missing row is pending, a refusal the row records holds,
// a refusal where the row says pass is red, and an acceptance where it records
// a refusal is an improvement the full check writes.
//
//   node --test tooling/android/dex-record.test.ts
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { d8Diagnostic, dexTargets, judge, observed, written, type DexOutcome } from "./dex-record.ts";
import { testScratch } from "../gate/test-scratch.ts";

const refusal = (diagnostic: string): DexOutcome => ({ kind: "build-failure", diagnostic });
const pass: DexOutcome = { kind: "pass" };
const record = (rows: Record<string, DexOutcome>) => written(null, Object.entries(rows).map(([path, outcome]) => ({ path, value: { outcome } })));

test("d8's message drops the run's work directory and the exception class it obfuscates", () => {
  const log = "Error in /w/benchmarks_cases_b/classes/nts/gen/SyntaxError.class:\n" +
    "com.android.tools.r8.internal.fx: Illegal class file: Interface nts/gen/SyntaxError must extend class java.lang.Object. Found: nts/gen/Error. Class file version 52.\nCompilation failed\n";
  assert.equal(d8Diagnostic(log, "/w"), "Illegal class file: Interface nts/gen/SyntaxError must extend class java.lang.Object. Found: nts/gen/Error. Class file version 52.");
  assert.equal(d8Diagnostic("Compilation failed\n", "/w"), "Compilation failed");
});

test("with no record every target d8 reached is pending, and the writer records them all", () => {
  const seen = new Map([["tests/programs/a", pass], ["benchmarks/cases/b", refusal("Illegal class file: x")]]);
  const judged = judge(null, seen, [...seen.keys()], true);
  assert.equal(judged.failed, 0);
  assert.deepEqual(judged.lines, [
    "pending: tests/programs/a is not recorded in results/dex/outcomes.tsv yet: d8 accepts it",
    "pending: benchmarks/cases/b is not recorded in results/dex/outcomes.tsv yet: d8 refuses it: Illegal class file: x"]);
  const text = written(null, judged.updates);
  assert.equal(text, '# nts-dex-outcomes {"version":1}\nbenchmarks/cases/b\t{"outcome":{"kind":"build-failure","diagnostic":"Illegal class file: x"}}\ntests/programs/a\t{"outcome":{"kind":"pass"}}\n');
  assert.equal(judge(text, seen, [...seen.keys()], true).lines.length, 1, "only the held refusal is named once recorded");
});

test("against its row: a pass holds, a recorded refusal holds, a new refusal is red, an acceptance is written", () => {
  const text = record({ "tests/programs/kept": pass, "tests/programs/known": refusal("Illegal class file: old"),
    "tests/programs/broken": pass, "tests/programs/fixed": refusal("Illegal class file: gone"), "tests/programs/other": refusal("Illegal class file: one") });
  const seen = new Map<string, DexOutcome>([["tests/programs/kept", pass], ["tests/programs/known", refusal("Illegal class file: old")],
    ["tests/programs/broken", refusal("Illegal class file: new")], ["tests/programs/fixed", pass], ["tests/programs/other", refusal("Illegal class file: two")]]);
  const judged = judge(text, seen, [...seen.keys()], true);
  assert.equal(judged.failed, 2, judged.lines.join("\n"));
  assert.ok(judged.lines.includes("tests/programs/known: d8 refuses it: Illegal class file: old, as its dex record says"));
  assert.ok(judged.lines.includes("tests/programs/broken: REGRESSED: d8 refuses it: Illegal class file: new, where its dex record says: d8 accepts it"));
  assert.ok(judged.lines.includes("tests/programs/other: CHANGED: d8 refuses it: Illegal class file: two, where its dex record says: d8 refuses it: Illegal class file: one"));
  assert.ok(judged.lines.some(line => line.startsWith("improved, record pending: tests/programs/fixed ")), judged.lines.join("\n"));
  assert.deepEqual(judged.updates, [{ path: "tests/programs/fixed", value: { outcome: pass } }], "only the improvement is written");
  const next = written(text, judged.updates);
  assert.match(next, /^tests\/programs\/fixed\t\{"outcome":\{"kind":"pass"\}\}$/m);
  assert.match(next, /^tests\/programs\/broken\t\{"outcome":\{"kind":"pass"\}\}$/m, "a regression is never recorded");
});

test("a full run names a row whose target is gone; a named run does not", () => {
  const text = record({ "tests/programs/gone": pass, "tests/programs/here": pass });
  const seen = new Map([["tests/programs/here", pass]]);
  const full = judge(text, seen, ["tests/programs/here"], true);
  assert.equal(full.failed, 1);
  assert.match(full.lines[0]!, /^tests\/programs\/gone: recorded in results\/dex\/outcomes\.tsv but no longer a target/);
  assert.equal(judge(text, seen, ["tests/programs/here"], false).failed, 0);
});

test("the targets are examples with their own tsconfig and every bench case, without invalid and unsupported", t => {
  const root = testScratch(t, "dex-targets");
  for (const dir of ["tests/programs/b", "tests/programs/a", "tests/programs/container/inner", "tests/programs/invalid", "benchmarks/cases/c", "benchmarks/cases/unsupported"]) mkdirSync(join(root, dir), { recursive: true });
  for (const dir of ["tests/programs/a", "tests/programs/b", "tests/programs/invalid"]) writeFileSync(join(root, dir, "tsconfig.json"), "{}");
  assert.deepEqual(dexTargets(root), ["benchmarks/cases/c", "tests/programs/a", "tests/programs/b"]);
});

test("a run's outcomes are read from each target's d8 status and log; a target that reached no d8 has none", t => {
  const work = testScratch(t, "dex-work");
  for (const [key, status, log] of [["tests_programs_a", "0", ""], ["benchmarks_cases_b", "1", `Error in ${work}/benchmarks_cases_b/classes/X.class:\ncom.x.y: Illegal class file: X\n`]] as const) {
    mkdirSync(join(work, key), { recursive: true }); writeFileSync(join(work, key, "d8.status"), `${status}\n`); writeFileSync(join(work, key, "d8.log"), log);
  }
  mkdirSync(join(work, "tests_programs_declined"));
  assert.deepEqual(observed(work, ["tests/programs/a", "benchmarks/cases/b", "tests/programs/declined"]),
    new Map<string, DexOutcome>([["tests/programs/a", pass], ["benchmarks/cases/b", refusal("Illegal class file: X")]]));
});
