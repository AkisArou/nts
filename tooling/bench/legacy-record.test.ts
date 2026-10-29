import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPARATORS, COLUMNS, POLICY, type RunRecord } from "./run-record.ts";
import { importCells, importFull } from "./legacy-record.ts";
import type { Metadata } from "./run-producers.ts";
function meta(): Metadata {
  return {
    schemaVersion: 1,
    id: "2026-10-23-abcdef0123-legacy",
    startedAt: null,
    finishedAt: null,
    complete: true,
    inventory: ["a"],
    columns: [...COLUMNS],
    sourceCommit: "abcdef0123",
    compiler: { commit: "abcdef0123", sha256: null },
    harness: { identity: "unknown", contract: null, files: [] },
    machine: { identity: null, conditions: null },
    comparators: Object.fromEntries(COMPARATORS.map((c) => [c, null])) as RunRecord["comparators"],
    verdictPolicy: POLICY,
    provenance: null,
  };
}
test("legacy table retains numbers without inventing verification or executable identity", () => {
  const run = importFull(
    meta(),
    "| case | nts (C) | V8 | Bun |\n| --- | ---: | ---: | ---: |\n| a (rc) | **1.20 us** | 3.0 ms | -- |\n",
  );
  assert.equal(run.rows[0].cells["nts C"].nanoseconds, 1200);
  assert.equal(run.rows[0].cells["nts C"].checksum, null);
  assert.equal(run.rows[0].eligibleForBest, false);
  assert.equal(run.rows[0].workloadIdentity, null);
  assert.match(run.harness.identity, /^legacy-report-artifact/);
  assert.equal(run.harness.contract, null);
});
test("rolling cells import only the requested commit and retains rejected rows explicitly", () => {
  const source =
    "case\tcolumn\tns_per_call\tmeasured\tcommit\tnote\na\tnts_c\t120\tthen\tabcdef0123\t\na\tnode\t240\tthen\tabcdef0123\t\nb\tnts_c\t1\tbefore\t0000000\t\n";
  const run = importCells(meta(), source, "abcdef0123", ["a", "b"], "b failed: wrong answer");
  assert.equal(run.rows[0].cells["nts C"].nanoseconds, 120);
  assert.equal(run.rows[1].cells["nts C"].status, "INVALID");
  assert.throws(
    () =>
      importCells(
        meta(),
        source + "a\tnts_c\t121\tthen\tabcdef0123\t\n",
        "abcdef0123",
        ["a", "b"],
        "",
      ),
    /duplicate/,
  );
});
