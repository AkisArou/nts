import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ownerEmissionCalls } from "./owner-emission-calls.ts";

test("gate and standalone captures report only their own owner emissions", t => {
  const root = mkdtempSync(join(tmpdir(), "nts-owner-counts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [kind, modes] of [["gate", ["emit", "hit"]], ["standalone", ["emit", "hit", "hit"]]] as const) {
    const directory = join(root, kind); mkdirSync(directory);
    const rows = modes.map(mode => ({ version: 1, step: "tooling", nodeVersion: "26.13.0", project: join(directory, "tsconfig.json"),
      directory: join(directory, "oracle-owners/programs/owned"), mode, inputsSha256: "a".repeat(64) }));
    writeFileSync(join(directory, "oracle-owner-calls.jsonl"), rows.map(row => JSON.stringify(row) + "\n").join(""));
    const result = ownerEmissionCalls({ directory, admission: { kind } }, { drained: true });
    assert.equal(result.status, "complete"); if(result.status!=="complete")assert.fail(JSON.stringify(result));
    assert.equal(result.emits, 1); assert.equal(result.hits, modes.length - 1); assert.equal(result.held, 0);
    assert.deepEqual(result.owners.map(row => row.project), [join(directory, "tsconfig.json")]);
    const other=ownerEmissionCalls({ directory, admission: { kind } }, { step: "other" });
    if(other.status!=="complete")assert.fail(JSON.stringify(other));assert.equal(other.emits, 0);
  }
});

test("missing and unreadable owner evidence never reports zero counts", t => {
  const directory = mkdtempSync(join(tmpdir(), "nts-owner-missing-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const capability = { directory, admission: { kind: "standalone" } };
  const missing = ownerEmissionCalls(capability); assert.equal(missing.status, "missing"); assert.equal(Object.hasOwn(missing, "emits"), false);
  writeFileSync(join(directory, "oracle-owner-calls.jsonl"), "invalid JSON\n");
  const unreadable = ownerEmissionCalls(capability); assert.equal(unreadable.status, "unreadable"); assert.equal(Object.hasOwn(unreadable, "hits"), false);
});
