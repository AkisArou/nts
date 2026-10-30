import { test } from "node:test";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { GENERATOR, fixtureOf, parseLegacyTable, readRecords, readRecordsAt, recordPath, writeRecords, type OracleRow, type OracleTable } from "../differential/oracle-records.ts";

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
  const cache = join(homedir(), ".cache/nts-oracle-record-tests");
  mkdirSync(cache, { recursive: true });
  const root = mkdtempSync(join(cache, "records-"));
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

test("missing records fail except for a recorder's explicitly named new fixture", () => fixture((root, table) => {
  subject(root, "second");
  assert.throws(() => readRecords(root), /missing fixture record tests\/programs\/second/);
  assert.deepEqual(readRecords(root, new Set(["tests/programs/second"])), table);
  assert.throws(() => writeRecords(root, table), /incomplete fixture inventory/);
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
