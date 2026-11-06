// node --test tooling/full-check/schedule.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { dueSlot, lastSlot, parseTimes, type Schedule } from "./schedule.ts";

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

test("times of day are checked, sorted and deduplicated", () => {
  assert.deepEqual(parseTimes("22:00, 10:00,10:00"), ["10:00", "22:00"]);
  assert.throws(() => parseTimes("9:00"), /not a time of day/);
  assert.throws(() => parseTimes("24:00"), /not a time of day/);
});
