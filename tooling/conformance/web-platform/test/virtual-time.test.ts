// The integration contract requires deterministic oracle tests to use virtual time and
// requires that network activity never silently advances it. Both follow from one
// property: this clock moves only when told to.
import assert from "node:assert/strict";
import test from "node:test";

import { VirtualScheduler } from "../../../../runtime/web-platform/src/provider.ts";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);

suite("nothing runs until the clock is told to move", () => {
  const clock = new VirtualScheduler();
  const ran = [];
  clock.delay(10, () => ran.push("timer"));
  assert.equal(clock.now, 0);
  assert.deepEqual(ran, [], "a timer must not fire because time passed elsewhere");
  assert.equal(clock.hasPending, true);
  assert.equal(clock.nextDeadline, 10);

  clock.advance(9);
  assert.deepEqual(ran, [], "the clock stops short of the deadline");
  assert.equal(clock.now, 9);
  clock.advance(1);
  assert.deepEqual(ran, ["timer"]);
  assert.equal(clock.now, 10);
  assert.equal(clock.hasPending, false);
  assert.equal(clock.nextDeadline, null);
});

suite("queued tasks run before timers and without moving the clock", () => {
  const clock = new VirtualScheduler({ startMilliseconds: 100 });
  const ran = [];
  clock.delay(0, () => ran.push("due-timer"));
  clock.enqueue(() => ran.push("queued"));
  assert.deepEqual(ran, []);

  clock.runPending();
  assert.deepEqual(ran, ["queued", "due-timer"]);
  assert.equal(clock.now, 100, "running what is due does not advance time");
});

suite("equal deadlines run in the order they were scheduled", () => {
  const clock = new VirtualScheduler();
  const ran = [];
  for (const label of ["a", "b", "c"]) clock.delay(5, () => ran.push(label));
  clock.delay(1, () => ran.push("early"));
  clock.advance(5);
  assert.deepEqual(ran, ["early", "a", "b", "c"]);
});

suite("the clock stops at each deadline rather than jumping to the end", () => {
  const clock = new VirtualScheduler();
  const seen = [];
  clock.delay(10, () => {
    seen.push(clock.now);
    // Scheduled from inside a timer, still inside the window being advanced.
    clock.delay(5, () => seen.push(clock.now));
  });
  clock.delay(40, () => seen.push(clock.now));
  clock.advance(100);
  // Each task sees the time its own deadline implies, not the end of the interval.
  assert.deepEqual(seen, [10, 15, 40]);
  assert.equal(clock.now, 100);
});

suite("a timer scheduled beyond the window waits for the next advance", () => {
  const clock = new VirtualScheduler();
  const ran = [];
  clock.delay(10, () => {
    clock.delay(100, () => ran.push("later"));
  });
  clock.advance(20);
  assert.deepEqual(ran, []);
  assert.equal(clock.nextDeadline, 110);
  clock.advance(90);
  assert.deepEqual(ran, ["later"]);
});

suite("cancelling takes effect even from inside a running task", () => {
  const clock = new VirtualScheduler();
  const ran = [];
  clock.delay(1, () => {
    ran.push("first");
    later.cancel();
  });
  const later = clock.delay(2, () => ran.push("cancelled"));
  clock.advance(10);
  assert.deepEqual(ran, ["first"], "a task may cancel a timer this advance has not reached");

  // Cancelling twice, and after firing, are both inert.
  const once = clock.delay(1, () => ran.push("once"));
  clock.advance(1);
  once.cancel();
  once.cancel();
  clock.advance(10);
  assert.deepEqual(ran, ["first", "once"]);
  assert.equal(clock.hasPending, false);
});

suite("a failing task is reported and does not abandon the run", () => {
  const clock = new VirtualScheduler();
  const ran = [];
  clock.delay(1, () => {
    throw new Error("task failed");
  });
  clock.delay(2, () => ran.push("after"));
  clock.advance(10);
  assert.deepEqual(ran, ["after"], "one failing task must not hide every later one");
  assert.equal(clock.errors.length, 1);
  assert.match(String(clock.errors[0]), /task failed/);

  // A supplied reporter takes over entirely.
  const reported = [];
  const routed = new VirtualScheduler({ reportError: (error) => reported.push(error) });
  routed.enqueue(() => {
    throw new Error("routed");
  });
  routed.runPending();
  assert.equal(routed.errors.length, 0);
  assert.equal(reported.length, 1);
});

suite("advancing to the next deadline drives a scheduler to quiescence", () => {
  const clock = new VirtualScheduler();
  const ran = [];
  clock.delay(3, () => {
    ran.push("a");
    clock.delay(7, () => ran.push("b"));
  });
  let steps = 0;
  while (clock.advanceToNextDeadline()) steps += 1;
  assert.deepEqual(ran, ["a", "b"]);
  assert.equal(steps, 2, "one step per deadline, including one discovered on the way");
  assert.equal(clock.now, 10);
  assert.equal(clock.advanceToNextDeadline(), false, "nothing pending is not a step");
});

suite("invalid times are refused rather than silently normalized", () => {
  const clock = new VirtualScheduler();
  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => clock.delay(bad, () => {}), RangeError);
    assert.throws(() => clock.advance(bad), RangeError);
  }
  assert.throws(() => new VirtualScheduler({ startMilliseconds: -1 }), RangeError);
  assert.throws(() => new VirtualScheduler({ startMilliseconds: Number.NaN }), RangeError);
  // Zero is valid in every position.
  const zero = new VirtualScheduler({ startMilliseconds: 0 });
  const ran = [];
  zero.delay(0, () => ran.push("now"));
  zero.advance(0);
  assert.deepEqual(ran, ["now"]);
});
