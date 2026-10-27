import assert from "node:assert/strict";
import { test } from "node:test";
import { calibration, calibratedGiB, CENSUS_STEPS, memoryWarning, recommendation } from "./memory-calibration.ts";

const GIB = 2 ** 30;
const samples = (peak: number, elastic = false, workers = 8) => ["a", "b", "c"].map(train =>
  ({ train, verdict: "green", workers, elastic, peak_bytes: Math.floor(peak * GIB) }));

test("calibration uses both headroom rules and rounds up to whole GiB", () => {
  assert.equal(calibratedGiB(.25 * GIB), 2); // +1 GiB dominates below one GiB.
  assert.equal(calibratedGiB(Math.floor(1.6 * GIB)), 4); // Doubling dominates above one GiB.
  assert.equal(calibratedGiB(GIB), 2);
  assert.throws(() => calibratedGiB(0));
});

test("three distinct green trains are required; a red historical peak still sets the floor", () => {
  assert.throws(() => recommendation(samples(1).slice(0, 2), 8), /three distinct/);
  assert.throws(() => recommendation(samples(1).map(o => ({ ...o, train: "same" })), 8), /three distinct/);
  assert.equal(recommendation([...samples(1), { train: "red", verdict: "red", workers: 8, elastic: false, peak_bytes: 3 * GIB }], 8), 3);
});

test("elastic peaks scale by granted workers without losing the historical raw floor", () => {
  assert.equal(recommendation(samples(1, true, 2), 8), 8);
  assert.equal(recommendation(samples(3, true, 8), 2), 3);
  assert.equal(recommendation(samples(1, false, 2), 8), 2);
  assert.throws(() => recommendation(samples(1).map(o => ({ ...o, workers: 0 })), 8));
});

test("the observation tripwire warns above half the reservation and preserves unknowns", () => {
  assert.equal(memoryWarning(GIB, 2 * GIB), null);
  assert.match(memoryWarning(GIB + 1, 2 * GIB)!, /exceeds half/);
  assert.equal(memoryWarning(null, 2 * GIB), null);
  assert.equal(memoryWarning(GIB, null), null);
});

test("only whole census aggregates qualify, with three green observations for every step", () => {
  const inputs = ["a", "b", "c"].map(train => ({ train, sha256: train, summary: {
    verdict: "green", identities: { commit: train },
    steps: [...CENSUS_STEPS, "outcomes"].map(name => ({ name, slots: 8 })),
    case_costs: { steps: Object.fromEntries([...CENSUS_STEPS, "outcomes"].map(name => [name, {
      aggregate_memory: { max_scope_peak_bytes: name === "outcomes" ? 80 * GIB : GIB,
        scopes: [{ peak_bytes: GIB }], reserved_step_mem_bytes: 8 * GIB } }])) },
  } }));
  const report = calibration(inputs);
  assert.deepEqual(report.rows.map(r => r.step), [...CENSUS_STEPS]);
  assert.ok(report.rows.every(r => r.mem_gib === 2));
  delete (inputs[2].summary.case_costs.steps as Record<string, unknown>)["test262-jvm"];
  assert.throws(() => calibration(inputs), /three distinct/);
});

test("regeneration retains historical peaks and rejects a changed historical summary", () => {
  const inputs = (prefix: string, peak: number) => ["1", "2", "3"].map(id => ({ train: prefix + id, sha256: prefix + id,
    summary: { verdict: "green", identities: { commit: prefix + id }, steps: CENSUS_STEPS.map(name => ({ name, slots: 8 })),
      case_costs: { steps: Object.fromEntries(CENSUS_STEPS.map(name => [name, { aggregate_memory: {
        max_scope_peak_bytes: peak, scopes: [{ peak_bytes: peak }], reserved_step_mem_bytes: 8 * GIB } }])) } } }));
  const old = calibration(inputs("old", 3 * GIB));
  const next = calibration(inputs("new", GIB / 4), old);
  assert.ok(next.rows.every(row => row.mem_gib === 6 && row.observations.length === 6));
  assert.equal(next.trains.length, 6);
  assert.throws(() => calibration(inputs("old", 3 * GIB).map(i => ({ ...i, sha256: "changed" })), old), /historical train changed/);
});
