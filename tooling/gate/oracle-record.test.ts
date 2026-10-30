import { test } from "node:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { addRecord, canonicalDriver, completeRows, noOracleRecord, recordAll, validateSourcePlan } from "../differential/record-oracles.ts";
import { readRecords } from "../differential/oracle-records.ts";
import { fileURLToPath } from "node:url";
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
  assert.throws(() => addRecord(table, { ...plan, case_key: "new", case_count: 1, cases: [plan.cases[0]] }, [1, 2], 1), /lower/);
  assert.throws(() => addRecord(table, plan, [7.6, 1], 2), /twice/);
  const next = addRecord(table, { ...plan, case_key: "new" }, [1, 2], 2);
  assert.equal(next.rows.length, 1);
  assert.equal(next.rows[0].keys.c, "new");
  const shared = addRecord(next, { ...plan, backend: "llvm", case_key: "llvm-key" }, [1, 2], 2);
  assert.equal(shared.rows.length, 1);
  assert.equal(shared.rows[0].keys.llvm, "llvm-key");
  assert.equal(addRecord(shared, { ...plan, signature: ["different"] }, [2, 2], 2).rows.length, 2);
});

test("checked-in fixture records promise complete measured identities", () => {
  const index = readRecords(fileURLToPath(new URL("../..", import.meta.url)));
  const jsx = index.rows.find((row: { source: string }) => row.source === "tests/programs/jsx/src/main.tsx");
  assert.ok(jsx);
  assert.equal(jsx.kind, "no-oracle");
  assert.equal(jsx.reason, "no generated cases; node cannot load .tsx directly");
  assert.equal(index.version, 1);
  assert.equal(index.generator_version, 1);
  assert.equal(index.seed, null);
  assert.match(index.generator_digest ?? "", /^[0-9a-f]{32}$/);
  const seen = new Set();
  let previous = "";
  for (const row of index.rows) {
    const identity = `${row.source}\0${row.signature}`;
    assert.ok(!seen.has(identity), identity); seen.add(identity);
    assert.ok(previous.localeCompare(identity, "en") <= 0); previous = identity;
    for (const field of [row.signature, row.cases_sha256, row.driver_sha256]) assert.match(field, /^[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(row.keys).sort(), ["c", "jvm", "llvm"]);
    for (const key of Object.values(row.keys)) assert.match(key as string, /^[0-9a-f]{32}$/);
    if (row.kind === "no-oracle") {
      assert.equal("count" in row, false);
      assert.equal("complete" in row, false);
      assert.match(row.source_digest ?? "", /^[0-9a-f]{32}$/);
      assert.ok(typeof row.reason === "string" && row.reason.trim().length > 0);
      continue;
    }
    assert.equal(row.kind, "measured"); assert.equal(row.complete, true);
    assert.ok(typeof row.count === "number" && Number.isInteger(row.count) && row.count >= 0);
    // Legacy measured CPU provenance remains readable. New records keep it in
    // evidence instead, so authors on different machines publish equal bytes.
    if (row.node_cpu_s) {
      assert.equal(row.node_cpu_s.length, 2);
      assert.ok(row.node_cpu_s.every((n: number) => Number.isFinite(n) && n >= 0 && n * 2 <= 15));
    }
  }
});

test("a changed declared domain permits complete narrowing, not an unchanged domain's coverage loss", () => {
  const original = addRecord({ version: 1, rows: [] }, plan, [1, 2], 2);
  const domain = { identity: "a".repeat(32), declaration: { version: 1,
    functions: { f: { n: { max: 0, reason: "zero-sized workload" } } } } };
  const narrower = { ...plan, input_domain: domain, case_key: "bounded", case_count: 1, cases: ["f 0 [0.0]"] };
  assert.throws(() => addRecord(original, narrower, [1, 2], 0), /schema/);
  const measured = addRecord(original, narrower, [1, 2], 1);
  const row = measured.rows.find(row => row.count === 1)!;
  assert.deepEqual(row.input_domain, domain);
  assert.equal(row.complete, true);
  const baseline = addRecord({ version: 1, rows: [] }, { ...plan, input_domain: domain }, [1, 2], 2);
  assert.throws(() => addRecord(baseline, narrower, [1, 2], 1), /lower/);
  const reworded = { ...domain, declaration: { ...domain.declaration,
    functions: { f: { n: { max: 0, reason: "a clearer explanation of the same workload" } } } } };
  assert.throws(() => addRecord(baseline, { ...narrower, input_domain: reworded }, [1, 2], 1), /lower/);
  assert.throws(() => addRecord(original, { ...narrower, input_domain: { ...domain, declaration: { version: 1, functions: {} } } }, [1, 2], 1), /domain schema/);
});

test("a function's domain change cannot authorize another function's lost coverage", () => {
  const both = { ...plan, case_count: 4,
    cases: ["f 0 [0.0]", "f 1 [1.0]", "g 0 [0.0]", "g 1 [1.0]"] };
  const original = addRecord({ version: 1, rows: [] }, both, [1, 2], 4);
  const domain = { identity: "a".repeat(32), declaration: { version: 1,
    functions: { f: { n: { max: 0, reason: "zero-sized workload" } } } } };
  const changed = { ...both, input_domain: domain, case_key: "bounded" };
  assert.throws(() => addRecord(original,
    { ...changed, case_count: 1, cases: [both.cases[0]] }, [1, 2], 1), /coverage for g/);
  assert.throws(() => addRecord(original,
    { ...changed, case_count: 4, cases: ["f 0 [0.0]", "f 1 [0.5]", "f 2 [1.0]", "g 0 [0.0]"] }, [1, 2], 4), /coverage for g/);
  assert.doesNotThrow(() => addRecord(original,
    { ...changed, case_count: 3, cases: [both.cases[0], ...both.cases.slice(2)] }, [1, 2], 3));
  const legacy = { ...original, rows: original.rows.map(({ populations: _ignored, ...row }) => row) };
  assert.throws(() => addRecord(legacy,
    { ...changed, case_count: 3, cases: [both.cases[0], ...both.cases.slice(2)] }, [1, 2], 3), /lower legacy/);
});

test("author paths and CPU observations do not change a published promise", () => {
  const author = (repository_root: string) => ({ ...plan, repository_root,
    source: "tests/programs/example/src/main.ts", entry: `${repository_root}/tests/programs/example/src/main.ts`,
    driver: `import ${JSON.stringify(`file://${repository_root}/tests/programs/example/src/main.ts`)};`,
    resolver: `const root = ${JSON.stringify(repository_root + "/")};` });
  const left = author("/one/checkout"), right = author("/a/deeper/author/tree");
  assert.equal(canonicalDriver(left), canonicalDriver(right));
  const a = addRecord({version:1,rows:[]}, left, [0.1,0.2], 2);
  const b = addRecord({version:1,rows:[]}, right, [1.1,1.2], 2);
  assert.deepEqual(a, b);
  assert.equal("node_cpu_s" in a.rows[0], false);
});

test("a later shortfall publishes none of a recording's rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nts-recorder-atomic-"));
  const saved = process.env.NTS_BENCH_CPUS;
  try {
    process.env.NTS_BENCH_CPUS = "4";
    const output = join(dir, "counts.json"), original = '{"version":1,"rows":[]}\n';
    writeFileSync(output, original);
    writeFileSync(join(dir, "plans.json"), JSON.stringify({version:1,failures:[],plans:[plan,{...plan,source:"bad.ts",driver:"different"}]}));
    // Inject measurement results, so a unit test never uses the reserved core.
    await assert.rejects(recordAll(dir, output, async p => ({cpu:[0.1,0.2],count:p.source === "bad.ts" ? 1 : 2})), /recording incomplete/);
    assert.equal(readFileSync(output,"utf8"), original);
  } finally {
    if (saved === undefined) delete process.env.NTS_BENCH_CPUS; else process.env.NTS_BENCH_CPUS = saved;
    rmSync(dir,{recursive:true,force:true});
  }
});

test("no-oracle records carry no numeric count and require an empty source identity", () => {
  assert.throws(() => noOracleRecord(plan, "reason"), /empty/);
  const row = noOracleRecord({ ...plan, case_count: 0, cases: [] }, "reason");
  assert.equal(row.source_digest, "source-digest");
  assert.equal("count" in row, false);
  assert.equal("node_cpu_s" in row, false);
});

test("a source plan cannot drop a refused export or record its empty population", () => {
  const sourcePlan = { ...plan, version: 2, source_exports: ["f", "g"], cases: ["f 0 [0.0]", "g 0 [0.0]"] };
  assert.equal(addRecord({ version: 1, rows: [] }, sourcePlan, [0.1, 0.2], 2).rows[0].count, 2);
  const dropped = { ...sourcePlan, cases: ["f 0 [0.0]"], case_count: 1 };
  assert.throws(() => addRecord({ version: 1, rows: [] }, dropped, [0.1, 0.2], 1), /lost or emptied source export g/);
  const empty = { ...sourcePlan, cases: [], case_count: 0 };
  assert.throws(() => addRecord({ version: 1, rows: [] }, empty, [0.1, 0.2], 0), /lost or emptied/);
  assert.throws(() => noOracleRecord(empty, "compiled nothing"), /lost or emptied/);
});

test("source-plan inventories are mandatory, unique and closed over their cases", () => {
  assert.throws(() => validateSourcePlan({ ...plan, version: 2 }), /source export inventory/);
  assert.throws(() => validateSourcePlan({ ...plan, version: 2, source_exports: ["f", "f"] }), /source export inventory/);
  assert.throws(() => validateSourcePlan({ ...plan, version: 2, source_exports: ["g"] }), /undeclared export f/);
});
