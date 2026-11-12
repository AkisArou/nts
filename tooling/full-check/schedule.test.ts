// node --test tooling/full-check/schedule.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { dueNightly, lastNightly, nextNightly, parseTimes, wideDecision, wideMemoryWaiter, WIDE_MIN_GAP_MS, type Schedule } from "./schedule.ts";

const schedule: Schedule = { nightly: "03:00" };
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);
const decision = (last: { commit: string; at: string } | undefined, now: Date, verified = "new", busy: string | null = null) =>
  wideDecision({ schedule, last, now, verified, busy });

test("changed verified starts at the four-hour boundary without a clock slot", () => {
  assert.equal(WIDE_MIN_GAP_MS, 4 * 3_600_000);
  const last = { commit: "old", at: at(6, 9, 17).toISOString() };
  assert.match(decision(last, at(6, 13, 16)).waiting!, /minimum wide gap/);
  assert.deepEqual(decision(last, at(6, 13, 17)), { due: "advanced", waiting: null });
  assert.deepEqual(decision(last, at(6, 14), "old"), { due: null, waiting: null });
  assert.deepEqual(wideDecision({ schedule, now: at(6, 14), verified: null, busy: null }), { due: null, waiting: "nothing is verified yet" });
});

test("landings and higher-priority waiters defer a start without consuming it", () => {
  const last = { commit: "old", at: at(6, 8).toISOString() }, now = at(6, 12, 7);
  for (const busy of ["landing queued", "landing running", "agent memory request waits"]) {
    assert.deepEqual(decision(last, now, "newest", busy), { due: "advanced", waiting: busy });
  }
  assert.deepEqual(decision(last, now, "newest"), { due: "advanced", waiting: null });
  assert.equal(wideMemoryWaiter([{ priority: "agent", live: false, what: "gone" }, { priority: "full-check", live: true, what: "peer" }]), null);
  for (const priority of ["landing", "agent"] as const) {
    assert.equal(wideMemoryWaiter([{ priority, live: true, what: "proof" }]), `${priority} memory request waits: proof`);
  }
});

test("nightly crosses the gap and repeats an unchanged commit, still waiting for idleness", () => {
  const last = { commit: "same", at: at(6, 2, 59).toISOString() };
  assert.deepEqual(decision(last, at(6, 3), "same"), { due: "nightly", waiting: null });
  assert.deepEqual(decision(last, at(6, 3), "same", "landing queued"), { due: "nightly", waiting: "landing queued" });
  const restarted = { commit: "same", at: at(6, 3).toISOString() };
  assert.deepEqual(decision(restarted, at(6, 4), "same"), { due: null, waiting: null });
  assert.deepEqual(decision(restarted, at(7, 3), "same"), { due: "nightly", waiting: null });
  assert.deepEqual(decision(undefined, at(6, 12)), { due: "nightly", waiting: null });
});

test("missed nights coalesce into one attempt and an actual start answers it on restart", () => {
  const last = { commit: "same", at: at(3, 3).toISOString() }, now = at(6, 12);
  assert.deepEqual(decision(last, now, "same"), { due: "nightly", waiting: null });
  assert.deepEqual(decision({ commit: "same", at: now.toISOString() }, now, "same"), { due: null, waiting: null });
});

test("the benchmarks answer the nightly slot once, independently of daytime wide runs", () => {
  assert.deepEqual(lastNightly(schedule, at(6, 2, 59)), at(5, 3));
  assert.deepEqual(lastNightly(schedule, at(6, 3)), at(6, 3));
  assert.deepEqual(nextNightly(schedule, at(30, 3)), new Date(2026, 11, 1, 3), "into the next month");
  assert.deepEqual(dueNightly(schedule, at(6, 2), at(6, 10, 30)), at(6, 3));
  assert.equal(dueNightly(schedule, at(6, 3, 5), at(6, 23)), null, "answered tonight");
  assert.deepEqual(dueNightly(schedule, at(4, 3, 5), at(6, 12)), at(6, 3), "away two nights: one night, the latest");
});

test("times of day are checked, sorted and deduplicated", () => {
  assert.deepEqual(parseTimes("22:00, 10:00,10:00"), ["10:00", "22:00"]);
  assert.throws(() => parseTimes("9:00"), /not a time of day/);
  assert.throws(() => parseTimes("24:00"), /not a time of day/);
});
