// node --test tooling/full-check/schedule.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { dueNightly, dueSlot, lastNightly, lastSlot, nextNightly, parseTimes, type Schedule } from "./schedule.ts";

const schedule: Schedule = { wide: ["10:00", "16:00", "22:00"], nightly: "03:00" };
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);

test("the latest slot is today's or yesterday's, and the nightly one is marked", () => {
  assert.deepEqual(lastSlot(schedule, at(6, 2, 59)), { at: at(5, 22), nightly: false });
  assert.deepEqual(lastSlot(schedule, at(6, 3)), { at: at(6, 3), nightly: true });
  assert.deepEqual(lastSlot(schedule, at(6, 15, 59)), { at: at(6, 10), nightly: false });
});

test("the wide steps are due once per slot, however long the service was away", () => {
  assert.ok(dueSlot(schedule, undefined, at(6, 12)), "never run: due");
  assert.equal(dueSlot(schedule, at(6, 10, 5), at(6, 12)), null, "answered the 10:00 slot");
  assert.deepEqual(dueSlot(schedule, at(6, 10, 5), at(6, 16, 1)), { at: at(6, 16), nightly: false });
  // Stopped from Thursday morning to Friday noon: one run, for the latest slot.
  assert.deepEqual(dueSlot(schedule, at(5, 10, 5), at(6, 12)), { at: at(6, 10), nightly: false });
});

test("the benchmarks answer the nightly slot whatever wide slot came after it, once per night", () => {
  assert.deepEqual(lastNightly(schedule, at(6, 2, 59)), at(5, 3));
  assert.deepEqual(lastNightly(schedule, at(6, 3)), at(6, 3));
  assert.deepEqual(nextNightly(schedule, at(30, 3)), new Date(2026, 11, 1, 3), "into the next month");
  // Last answered before 03:00, next asked at 10:30: the 10:00 wide slot is the latest slot, and the night is still due.
  assert.equal(lastSlot(schedule, at(6, 10, 30)).nightly, false);
  assert.deepEqual(dueNightly(schedule, at(6, 2), at(6, 10, 30)), at(6, 3));
  assert.equal(dueNightly(schedule, at(6, 3, 5), at(6, 23)), null, "answered tonight");
  assert.deepEqual(dueNightly(schedule, at(4, 3, 5), at(6, 12)), at(6, 3), "away two nights: one night, the latest");
});

test("times of day are checked, sorted and deduplicated", () => {
  assert.deepEqual(parseTimes("22:00, 10:00,10:00"), ["10:00", "22:00"]);
  assert.throws(() => parseTimes("9:00"), /not a time of day/);
  assert.throws(() => parseTimes("24:00"), /not a time of day/);
});
