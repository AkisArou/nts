// node --test tooling/full-check/measure.test.ts
//
// How a run's summary.json is read: a skip the policy accepts passes, a step
// that did not complete is held, and a summary of another commit or from a
// non-canonical environment vouches for nothing.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readSummary, verdictOf } from "./measure.ts";

const COMMIT = "1234567890ab".padEnd(40, "c");

function summary(t: { after(fn: () => void): void }, value: unknown): string {
  const run = mkdtempSync(join(tmpdir(), "full-check-summary-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  writeFileSync(join(run, "summary.json"), typeof value === "string" ? value : JSON.stringify(value));
  return run;
}

const steps = [
  { name: "build", verdict: "PASS" },
  { name: "tests", verdict: "FAIL", reason: "exit 1" },
  { name: "on-device", verdict: "SKIPPED", reason: "SKIP: no device", accepted: true },
  { name: "dex", verdict: "SKIPPED", reason: "SKIP: no d8" },
  { name: "rc", verdict: "INSTRUMENT", reason: "memory pre-check" },
  { name: "llvm", verdict: "NOT RUN", reason: "build failed" },
];

test("each step's verdict, as the full check reads it", t => {
  const run = summary(t, { verdict: "red", identities: { commit: COMMIT.slice(0, 12) }, environment: { canonical: true }, steps });
  const read = readSummary(run, COMMIT, [...steps.map(s => s.name), "missing"]);
  assert.deepEqual(read.steps, { build: "PASS", tests: "FAIL", "on-device": "PASS", dex: "HELD", rc: "HELD", llvm: "HELD", missing: "HELD" });
  assert.equal(read.reasons.tests, "FAIL: exit 1");
  assert.equal(read.reasons.missing, "not in the summary");
  assert.equal(verdictOf(read.steps), "red");
  assert.equal(verdictOf({ build: "PASS", rc: "HELD" }), "held");
  assert.equal(verdictOf({ build: "PASS", "on-device": "PASS" }), "green");
});

test("a summary that cannot vouch for the commit holds every step", t => {
  const other = summary(t, { identities: { commit: "ffffffffffff" }, environment: { canonical: true }, steps });
  assert.deepEqual(new Set(Object.values(readSummary(other, COMMIT, ["build"]).steps)), new Set(["HELD"]));
  const experiment = summary(t, { identities: { commit: COMMIT }, environment: { canonical: false }, steps });
  assert.equal(readSummary(experiment, COMMIT, ["build"]).reasons.build, "the run was not in the canonical environment");
  const broken = summary(t, "{ not json");
  assert.match(readSummary(broken, COMMIT, ["build"]).reasons.build!, /^unreadable summary/);
  assert.equal(readSummary(join(broken, "absent"), COMMIT, ["build"]).reasons.build, "the run wrote no summary");
});
