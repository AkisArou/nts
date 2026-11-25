import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { runAsCommand } from "../differential/command-entry/main.ts";
import { readJournal } from "./run-journal.ts";
import { workloadIdentity } from "./workload-identity.ts";
import { parseRun, renderRuns, type RunRecord, type Json } from "./run-record.ts";

export type Declaration = { name: string; workload: unknown };
export type MigrationInput = { run: string; journal: string; journalSha256: string; declarations: Declaration[] };
const negativeZero = { float64Bits: "8000000000000000" };
export function migrationInput(journal: string): MigrationInput {
  const { raw, unreached } = readJournal(journal);
  assert.equal(unreached.length, 0, "migration needs a completed journal");
  return { run: raw.metadata.id, journal: resolve(journal), journalSha256: createHash("sha256").update(readFileSync(journal)).digest("hex"),
    declarations: raw.measured.map(value => {
      const m = value as { shown: string; workload: unknown };
      // Journal frames pass through serde_json::Value, which sorts keys.
      // Restore the historical Workload/Numeric struct field order before
      // authenticating the original serialized identity.
      const w = m.workload as { roots: string[]; numeric: { callee: string; seed: number; answer?: string } | null };
      const numeric = w.numeric;
      return { name: m.shown, workload: { roots: w.roots, numeric: numeric === null ? null :
        { callee: numeric.callee, seed: numeric.seed, ...(numeric.answer === undefined ? {} : { answer: numeric.answer }) } } };
    }) };
}
export function encodeMigration(input: MigrationInput): string {
  return JSON.stringify(input, (_, value) => Object.is(value, -0) ? negativeZero : value, 2) + "\n";
}
export function decodeMigration(body: string): MigrationInput {
  return JSON.parse(body, (_, value) => value && typeof value === "object" &&
    Object.keys(value).length === 1 && value.float64Bits === negativeZero.float64Bits ? -0 : value) as MigrationInput;
}
/** The pre-fix algorithm, used only to authenticate an original identity. */
export function serializedIdentity(capture: unknown, workload: unknown): string {
  const c = capture as { algorithm: string; workload: { path: string; digest: string; rewritten_by?: unknown }[]; drivers?: unknown };
  const files = c.workload.map(f => ({ path: f.path, digest: f.digest, rewrittenBy: f.rewritten_by ?? null }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const input = JSON.stringify(workload, (_, value) => {
    if (typeof value !== "number") return value;
    const bits = Buffer.alloc(8); bits.writeDoubleBE(value);
    return { float64Bits: bits.toString("hex") };
  });
  return createHash("sha256").update(JSON.stringify({ algorithm: c.algorithm, files, input, drivers: c.drivers ?? [] })).digest("hex");
}
/** Recompute from original declarations and retained captures; never borrow another run's identities. */
export function migrateIdentities(original: RunRecord, input: MigrationInput): RunRecord {
  assert.equal(original.id, input.run, "migration journal belongs to another run");
  const declarations = new Map(input.declarations.map(d => [d.name, d.workload]));
  assert.equal(declarations.size, input.declarations.length, "duplicate migration declarations");
  const migrated = structuredClone(original);
  for (const row of migrated.rows) {
    if (row.workloadIdentity === null) { assert.ok(!declarations.has(row.name), "declaration has no recorded identity"); continue; }
    assert.ok(declarations.has(row.name), "missing migration workload: " + row.name);
    const workload = declarations.get(row.name), conditions = row.conditions as Record<string, Json>;
    assert.ok(conditions?.sourceCapture, "missing source capture: " + row.name);
    assert.equal(serializedIdentity(conditions.sourceCapture, workload), row.workloadIdentity, "original identity disagrees with declaration/capture: " + row.name);
    row.workloadIdentity = workloadIdentity(conditions.sourceCapture, workload);
    declarations.delete(row.name);
  }
  assert.equal(declarations.size, 0, "orphan migration declarations");
  return parseRun(migrated);
}

runAsCommand(import.meta.url, () => {
  const [command, first, second] = process.argv.slice(2);
  assert.ok(first && second, "usage: migrate-workload-identities.ts extract <journal> <declarations.json> | apply <root> <declarations.json>");
  if (command === "extract") {
    const input = migrationInput(first);
    // Authenticate the capture as well as the existing identity before retaining declarations.
    writeFileSync(second, encodeMigration(input));
  } else {
    assert.equal(command, "apply");
    const input = decodeMigration(readFileSync(second, "utf8"));
    const record = join(first, "results/benchmarks/runs", input.run + ".json");
    const original = parseRun(JSON.parse(readFileSync(record, "utf8")));
    const { raw } = readJournal(input.journal);
    assert.equal(createHash("sha256").update(readFileSync(input.journal)).digest("hex"), input.journalSha256, "journal bytes changed");
    const measurements = new Map(raw.measured.map(value => {
      const m = value as { shown: string; source_capture: unknown; workload: unknown }; return [m.shown, m] as const;
    }));
    for (const d of input.declarations) {
      const m = measurements.get(d.name), row = original.rows.find(row => row.name === d.name);
      assert.ok(m && row, "missing migration evidence: " + d.name);
      assert.deepEqual(m.workload, d.workload, "workload differs from journal: " + d.name);
      assert.deepEqual(m.source_capture, (row.conditions as Record<string, Json>).sourceCapture, "sourceCapture differs from journal: " + d.name);
    }
    const migrated = migrateIdentities(original, input);
    writeFileSync(record, JSON.stringify(migrated, null, 2) + "\n");
    renderRuns(first);
    console.log(`${migrated.rows.filter((row, i) => row.workloadIdentity !== original.rows[i]!.workloadIdentity).length} identities recomputed; measurements unchanged`);
  }
});
