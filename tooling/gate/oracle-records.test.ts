import { test } from "node:test";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GENERATOR, fixtureOf, parseShard, parseLegacyTable, pendingFixtures, readRecords, readRecordsAt, recordPath, writeRecords, type OracleRow, type OracleTable } from "../differential/oracle-records.ts";
import { newTestScratch } from "./test-scratch.ts";

const header = { version: 1, generator_version: 1, generator_digest: "a".repeat(32), seed: null } as const;
function row(name: string): OracleRow {
  return { kind: "measured", source: `tests/programs/${name}/src/main.ts`, signature: "b".repeat(64),
    keys: { c: "1".repeat(32), llvm: "2".repeat(32), jvm: "3".repeat(32) },
    cases_sha256: "c".repeat(64), driver_sha256: "d".repeat(64), count: 2, complete: true };
}
function subject(root: string, name: string): void {
  const file = join(root, `tests/programs/${name}/src/main.ts`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "export function work(n: number): number { return n; }\n");
  writeFileSync(join(root, `tests/programs/${name}/tsconfig.json`), '{"files":["src/main.ts"]}\n');
}
function fixture(action: (root: string, table: OracleTable) => void): void {
  const root = newTestScratch("oracle-records");
  try {
    mkdirSync(join(root, "benchmarks/cases"), { recursive: true });
    subject(root, "first");
    const table = { ...header, rows: [row("first")] };
    writeRecords(root, table);
    action(root, table);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("fixture records round-trip without changing any population metadata", () => fixture((root, table) => {
  assert.deepEqual(readRecords(root), table);
  assert.deepEqual(parseLegacyTable(table), table);
  assert.equal(fixtureOf(table.rows[0].source), "tests/programs/first");
  for (const invalid of ["tests/programs/../escape/main.ts", "tests/programs/first/../../escape.ts", "tests\\programs\\first\\main.ts"]) {
    assert.throws(() => fixtureOf(invalid), /invalid subject/);
  }
}));

test("a fixture with no record is pending, not a failure", () => fixture((root, table) => {
  assert.deepEqual(pendingFixtures(root), []);
  subject(root, "second");
  assert.deepEqual(readRecords(root), table, "the recorded fixtures read as before");
  assert.deepEqual(pendingFixtures(root), ["tests/programs/second"]);
  assert.throws(() => writeRecords(root, table), /incomplete fixture inventory/, "a full publish still names every fixture");
}));

test("recording a fixture changes only its record and leaves a matching header alone", () => fixture((root, table) => {
  const path = join(root, recordPath("tests/programs/first")), before = readFileSync(path);
  const generator = join(root, GENERATOR), inode = statSync(generator).ino;
  subject(root, "second");
  const updated = { ...table, rows: [{ ...table.rows[0], count: 99 }, row("second")] };
  writeRecords(root, updated, new Set(["tests/programs/second"]));
  assert.deepEqual(readFileSync(path), before, "an unrelated record must not be rewritten");
  assert.equal(statSync(generator).ino, inode, "a matching generator header must not be rewritten");
  assert.deepEqual(readRecords(root).rows, [row("first"), row("second")]);
}));

test("duplicate records and duplicate backend populations fail closed", () => fixture((root, table) => {
  const path = join(root, recordPath("tests/programs/first"));
  for (const duplicate of [table.rows[0], { ...table.rows[0], signature: "e".repeat(64) }]) {
    writeFileSync(path, JSON.stringify({ version: 1, fixture: "tests/programs/first", rows: [table.rows[0], duplicate] }));
    assert.throws(() => readRecords(root), /duplicate (record|population)/);
  }
}));

test("orphaned and misnamed fixture files cannot invent subjects", () => fixture((root) => {
  const path = join(root, recordPath("tests/programs/first"));
  const copy = join(root, recordPath("tests/programs/unknown"));
  copyFileSync(path, copy);
  assert.throws(() => readRecords(root), /orphaned fixture record/);
  rmSync(copy);
  rmSync(join(root, "tests/programs/first/tsconfig.json"));
  assert.throws(() => readRecords(root), /orphaned fixture record/);
}));

test("unknown header fields, malformed bounds and false no-oracle measurements are errors", () => fixture((root, table) => {
  const path = join(root, GENERATOR);
  writeFileSync(path, JSON.stringify({ ...header, extra: true }));
  assert.throws(() => readRecords(root), /unknown field extra/);
  const domain = { identity: "f".repeat(32), declaration: { version: 1, functions: { work: { n: { min: 2, max: 1, reason: "contradictory" } } } } };
  assert.throws(() => parseLegacyTable({ ...table, rows: [{ ...row("first"), input_domain: domain }] }), /contradictory domain bounds/);
  assert.throws(() => parseLegacyTable({ ...table, rows: [{ ...row("first"), kind: "no-oracle", source_digest: "a".repeat(32), reason: "not measured" }] }), /cannot claim measurements/);
}));

test("comparison pins choose their own committed record version, never working-tree bytes", () => fixture((root, table) => {
  const git = (...args: string[]): string => execFileSync("git", ["-c", "user.name=Oracle test", "-c", "user.email=oracle@example.invalid", ...args], { cwd: root, encoding: "utf8" });
  git("init", "--quiet");
  rmSync(join(root, "results/oracle-counts"), { recursive: true });
  writeFileSync(join(root, "results/oracle-counts.json"), JSON.stringify(table));
  git("add", "."); git("commit", "--quiet", "-m", "legacy authority");
  const before = git("rev-parse", "HEAD").trim();
  rmSync(join(root, "results/oracle-counts.json"));
  writeRecords(root, table);
  git("add", "-A"); git("commit", "--quiet", "-m", "fixture authorities");
  const after = git("rev-parse", "HEAD").trim();
  writeFileSync(join(root, GENERATOR), "malformed working tree");
  assert.deepEqual(readRecordsAt(root, before), table);
  assert.deepEqual(readRecordsAt(root, after), table);
  git("rm", "--quiet", "-f", recordPath("tests/programs/first"));
  git("commit", "--quiet", "-m", "drop one record");
  assert.throws(() => readRecordsAt(root, "HEAD"), /missing committed fixture record/);
}));

test("a partial committed directory never falls back to a leftover flat table", () => fixture((root, table) => {
  const git = (...args: string[]): string => execFileSync("git", ["-c", "user.name=Oracle test", "-c", "user.email=oracle@example.invalid", ...args], { cwd: root, encoding: "utf8" });
  git("init", "--quiet");
  writeFileSync(join(root, "results/oracle-counts.json"), JSON.stringify(table));
  git("add", "."); git("commit", "--quiet", "-m", "two authorities");
  assert.throws(() => readRecordsAt(root, "HEAD"), /two tracked oracle authorities/);
  git("rm", "--quiet", "-f", GENERATOR);
  git("commit", "--quiet", "-m", "missing generator");
  assert.throws(() => readRecordsAt(root, "HEAD"), /no generator header/);
}));

test("a plan budget is its entry's record, alone or beside rows, and reads back as written", () => fixture((root, table) => {
  subject(root, "slow");
  const unplanned = { source: "tests/programs/slow/src/main.ts", backends: ["c", "llvm"],
    budget: { version: 1 as const, phase: "plan" as const, outcome: "timeout" as const, bound: 600, signal: "SIGKILL", reason: "oracle planner timed out" },
    revision: { entry: "a".repeat(64), node: "b".repeat(64), producer: "c".repeat(64), policy: "d".repeat(64) } };
  const updated = { ...table, unplanned: [unplanned] };
  writeRecords(root, updated, new Set(["tests/programs/slow"]));
  const shard = JSON.parse(readFileSync(join(root, recordPath("tests/programs/slow")), "utf8"));
  assert.deepEqual(shard, { version: 2, fixture: "tests/programs/slow", rows: [], unplanned }, "no population, so no row");
  assert.deepEqual(readRecords(root), updated);
  assert.deepEqual(parseLegacyTable(updated), updated);
  for (const [changed, refusal] of [
    [{ ...shard, version: 1 }, /version 2/],
    [{ version: 2, fixture: "tests/programs/slow", rows: [] }, /invalid or misnamed/],
    [{ ...shard, unplanned: { ...unplanned, source: "tests/programs/first/src/main.ts" } }, /another fixture's source/],
    [{ ...shard, unplanned: { ...unplanned, backends: ["llvm", "c"] } }, /backends once each, in order/],
    [{ ...shard, unplanned: { ...unplanned, backends: ["c", "c"] } }, /backends once each, in order/],
    [{ ...shard, unplanned: { ...unplanned, budget: { ...unplanned.budget, phase: "execute" } } }, /invalid versioned plan budget/],
    [{ ...shard, unplanned: { ...unplanned, budget: { ...unplanned.budget, count: 3 } } }, /unknown field count/],
  ] as const) assert.throws(() => parseShard(changed, "tests/programs/slow"), refusal);
  rmSync(join(root, "tests/programs/slow/src/main.ts"));
  assert.throws(() => readRecords(root), /orphaned source record tests\/programs\/slow/, "an entry that is gone");
}));

test('budget records require revision 2 and can claim neither count nor completion',()=>{
  const budget={...row('first'),kind:'budget',source_digest:'a'.repeat(32),budget:{version:1,phase:'execute',outcome:'memory-cap',bound:2*2**30,signal:null,reason:'own resident hit'},revision:{entry:'a'.repeat(64),node:'b'.repeat(64),producer:'c'.repeat(64),policy:'d'.repeat(64)}};
  delete (budget as Partial<OracleRow>).count;delete (budget as Partial<OracleRow>).complete;
  const shard={version:2,fixture:'tests/programs/first',rows:[budget]};
  assert.equal(parseShard(shard,shard.fixture).rows[0]!.kind,'budget');
  assert.throws(()=>parseShard({...shard,version:1},shard.fixture),/budget.*version 2/);
  for(const field of ['count','complete'])assert.throws(()=>parseShard({...shard,rows:[{...budget,[field]:field==='count'?0:true}]},shard.fixture),/budget row cannot claim/);
  assert.throws(()=>parseShard({...shard,version:99},shard.fixture),/invalid or misnamed/);
});
