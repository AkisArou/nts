import { test } from "node:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { addRecord, completeRows, noOracleRecord } from "../differential/record-oracles.ts";
const plan = { version: 1, backend: "c", source: "fixture.ts", entry: "/fixture.ts", source_digest: "source-digest", seed: null,
  generator_version: 1, generator_digest: "generator", case_key: "key", case_count: 2,
  cases: ["f 0 [0.0]", "f 1 [-0.0]"], signature: [], driver: "", resolver: "" };
test("only full protocol completion can be recorded", () => {
  assert.deepEqual(completeRows("one\ntwo\ndone 2\n", 2), ["one", "two"]);
  for (const text of ["one\n", "one\ndone 1\n", "one\ndone 2\n", "one\ntwo\n"]) {
    assert.throws(() => completeRows(text, 2), /not measured/);
  }
});
test("recording merges backend signatures and refuses reduced coverage or inadequate CPU margin", () => {
  const table = addRecord({ version: 1, rows: [] }, plan, [1, 2], 2);
  assert.equal(table.rows[0].count, 2);
  assert.throws(() => addRecord(table, plan, [1, 2], 1), /schema/);
  assert.equal(table.rows[0].cases_sha256, createHash("sha256").update(JSON.stringify(plan.cases)).digest("hex"));
  assert.throws(() => addRecord(table, { ...plan, case_key: "new", case_count: 1, cases: ["one"] }, [1, 2], 1), /lower/);
  assert.throws(() => addRecord(table, plan, [7.6, 1], 2), /twice/);
  const next = addRecord(table, { ...plan, case_key: "new" }, [1, 2], 2);
  assert.equal(next.rows.length, 1);
  assert.equal(next.rows[0].keys.c, "new");
  const shared = addRecord(next, { ...plan, backend: "llvm", case_key: "llvm-key" }, [1, 2], 2);
  assert.equal(shared.rows.length, 1);
  assert.equal(shared.rows[0].keys.llvm, "llvm-key");
  assert.equal(addRecord(shared, { ...plan, signature: ["different"] }, [2, 2], 2).rows.length, 2);
});

test("checked-in promises use compact sorted rows with complete measured identities", () => {
  const text = readFileSync(new URL("../../results/oracle-counts.json", import.meta.url), "utf8");
  assert.ok(Buffer.byteLength(text) < 1_000_000);
  const index = JSON.parse(text), lines = text.trimEnd().split("\n");
  assert.equal(index.version, 1);
  assert.equal(index.generator_version, 1);
  assert.equal(index.seed, null);
  assert.match(index.generator_digest, /^[0-9a-f]{32}$/);
  assert.equal(lines.length, index.rows.length + 2);
  const seen = new Set();
  let previous = "";
  for (const row of index.rows) {
    const identity = `${row.source}\0${row.signature}`;
    assert.ok(!seen.has(identity), identity); seen.add(identity);
    assert.ok(previous.localeCompare(identity, "en") <= 0); previous = identity;
    for (const field of [row.signature, row.cases_sha256, row.driver_sha256]) assert.match(field, /^[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(row.keys).sort(), ["c", "jvm", "llvm", "wasm"]);
    for (const key of Object.values(row.keys)) assert.match(key as string, /^[0-9a-f]{32}$/);
    if (row.kind === "no-oracle") {
      assert.equal(row.source, "tests/programs/jsx/src/main.tsx");
      assert.equal("count" in row, false);
      assert.match(row.source_digest, /^[0-9a-f]{32}$/);
      assert.equal(row.reason, "no generated cases; node cannot load .tsx directly");
      continue;
    }
    assert.equal(row.kind, "measured"); assert.equal(row.complete, true);
    assert.ok(Number.isInteger(row.count) && row.count >= 0);
    assert.equal(row.node_cpu_s.length, 2);
    assert.ok(row.node_cpu_s.every((n: number) => Number.isFinite(n) && n >= 0 && n * 2 <= 15));
  }
});

test("no-oracle records carry no numeric count and require an empty source identity", () => {
  assert.throws(() => noOracleRecord(plan, "reason"), /empty/);
  const row = noOracleRecord({ ...plan, case_count: 0, cases: [] }, "reason");
  assert.equal(row.source_digest, "source-digest");
  assert.equal("count" in row, false);
  assert.equal("node_cpu_s" in row, false);
});
