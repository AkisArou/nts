import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fileInput } from "../gate/reader-inputs/main.ts";
import { testEnvironment } from "../gate/test-environment.ts";
import { decodeMigration, encodeMigration, migrateIdentities, serializedIdentity } from "./migrate-workload-identities.ts";
import { RECORD_MIGRATIONS, approvedRecordMigration } from "./record-migrations.ts";
import { parseRun } from "./run-record.ts";

const runs = fileURLToPath(new URL("../../results/benchmarks/runs/", import.meta.url));
const root = fileURLToPath(new URL("../../", import.meta.url));
const inputs = {
  "2026-11-24": fileInput(new URL("./migrations/2026-11-24.json", import.meta.url)),
  "2026-11-26": fileInput(new URL("./migrations/2026-11-26.json", import.meta.url)),
  "2026-11-27": fileInput(new URL("./migrations/2026-11-27.json", import.meta.url)),
};
const records = {
  "2026-11-19": fileInput(new URL("../../results/benchmarks/runs/2026-11-19-ae4898abff47-aeadc71fa85c4cbab1b1786d6f64a26c.json", import.meta.url)),
  "2026-11-24": fileInput(new URL("../../results/benchmarks/runs/2026-11-24-d9941ea0f4e8-c3770a55231b4a27ad84b26fa0e3fdac.json", import.meta.url)),
  "2026-11-26": fileInput(new URL("../../results/benchmarks/runs/2026-11-26-4de56c302544-22b9619f772845f382884116c177084d.json", import.meta.url)),
  "2026-11-27": fileInput(new URL("../../results/benchmarks/runs/2026-11-27-0cd07c4baf18-fd2c4e9c08e84cdb8985aee8fc3a0141.json", import.meta.url)),
};
/** Each migrated run's Returned rows must regain the identities of the last run measured before the defect. */
const expected = {
  "2026-11-24": { prior: "2026-11-19", changed: 161, matched: 158, newRows: ["sort-objects-runs", "sort-objects-shuffled", "string-sort-control"] },
  "2026-11-26": { prior: "2026-11-24", changed: 161, matched: 161, newRows: [] as string[] },
  "2026-11-27": { prior: "2026-11-26", changed: 161, matched: 161, newRows: [] as string[] },
} as const;

function originalBlob(sha: string): string {
  const git = spawnSync("git", ["--no-optional-locks", "cat-file", "blob", sha], { cwd: root, env: testEnvironment(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(git.status, 0, git.stderr);
  return git.stdout;
}

test("every ledger entry has its declarations, replacement and expectation", () => {
  assert.deepEqual(RECORD_MIGRATIONS.map(entry => entry.run.slice(0, 10)).sort(), Object.keys(expected).sort());
  for (const entry of RECORD_MIGRATIONS) assert.equal(fileURLToPath(records[entry.run.slice(0, 10) as keyof typeof records]), runs + entry.run + ".json");
});

for (const entry of RECORD_MIGRATIONS) {
  const day = entry.run.slice(0, 10) as keyof typeof expected;
  test(`approved ${day} migration reproduces exact replacement from original blob and workload declarations`, () => {
    const want = expected[day];
    const original = parseRun(JSON.parse(originalBlob(entry.original))), input = decodeMigration(readFileSync(inputs[day], "utf8"));
    const migrated = migrateIdentities(original, input), bytes = JSON.stringify(migrated, null, 2) + "\n";
    assert.equal(bytes, readFileSync(records[day], "utf8"));
    assert.equal(createHash("sha1").update("blob " + Buffer.byteLength(bytes) + "\0").update(bytes).digest("hex"), entry.replacement);
    const changed = migrated.rows.filter((row, index) => row.workloadIdentity !== original.rows[index]!.workloadIdentity);
    assert.equal(changed.length, want.changed);
    const restored = structuredClone(migrated);
    restored.rows.forEach((row, index) => { row.workloadIdentity = original.rows[index]!.workloadIdentity; });
    assert.deepEqual(restored, original, "only workloadIdentity may change");
    const previous = parseRun(JSON.parse(readFileSync(records[want.prior], "utf8")));
    let matched = 0;
    const newRows: string[] = [];
    for (const row of changed) {
      const old = previous.rows.find(candidate => candidate.name === row.name);
      if (!old) {
        assert.ok(!previous.rows.some(candidate => candidate.workloadIdentity === row.workloadIdentity), "new row collides with prior workload: " + row.name);
        newRows.push(row.name);
        continue;
      }
      assert.equal(row.workloadIdentity, old.workloadIdentity, row.name);
      matched++;
    }
    assert.equal(matched, want.matched, "all pre-existing Returned rows regain their identities");
    assert.deepEqual(newRows, want.newRows);
    assert.equal(approvedRecordMigration(entry.run, entry.original, entry.replacement), true);
    assert.equal(approvedRecordMigration("another-run", entry.original, entry.replacement), false);
    assert.equal(approvedRecordMigration(entry.run, entry.original, "a".repeat(40)), false);
    assert.equal(approvedRecordMigration(entry.run, "a".repeat(40), entry.replacement), false);
    const bad = structuredClone(input); bad.declarations[0]!.workload = { roots: ["other"], numeric: null };
    assert.throws(() => migrateIdentities(original, bad), /original identity disagrees/);
    assert.throws(() => migrateIdentities(original, { ...input, declarations: [] }), /missing migration workload/);
    assert.throws(() => migrateIdentities(original, { ...input, run: "another-run" }), /another run/);
  });
}

test("migration declaration writer preserves signed zero", () => {
  const input = { run: "test", journal: "test", journalSha256: "a".repeat(64),
    declarations: [{ name: "negative-zero", workload: { roots: ["work"], numeric: { callee: "work", seed: -0, answer: "Returned" } } }] };
  assert.deepEqual(decodeMigration(encodeMigration(input)), input);
  const capture = { algorithm: "xxh3-128-le-checked-utf8-v1", workload: [], drivers: [] };
  assert.notEqual(serializedIdentity(capture, input.declarations[0]!.workload), serializedIdentity(capture, { ...input.declarations[0]!.workload, numeric: { callee: "work", seed: 0, answer: "Returned" } }));
});
