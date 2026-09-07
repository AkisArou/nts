// `Event.timeStamp`, and the parts of it WPT does not pin.
//
// The upstream fixture asserts `ev.timeStamp > 0`, which a wall clock satisfies just as
// well as a monotonic one — an epoch millisecond count is emphatically greater than zero.
// The contract this lane wrote says something narrower: milliseconds since an origin
// fixed for the lifetime of the provider, monotonically non-decreasing, and deliberately
// *not* the same clock the cache compares `Date` headers against.
//
// Two clocks, and the mistake available is letting the monotonic one satisfy an interface
// that wanted the other, or the reverse. Nothing upstream would notice either.
import assert from "node:assert/strict";
import test from "node:test";

import { createHostNodeWebPlatform } from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-runtime.js";
import { Event } from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);

function runtime(t) {
  const api = createHostNodeWebPlatform();
  t.after(() => api.close());
  return api;
}

suite("timeStamp is time since an origin, not a wall clock", (t) => {
  runtime(t);
  const event = new Event("x");
  // An epoch millisecond count is around 1.7e12. A time-since-origin is the age of this
  // process, which is a handful of seconds at most in a test run. This is the assertion
  // that fails if somebody wires the wall clock in, and the one WPT cannot make.
  // Strictly positive, not merely non-negative. `timeStamp` returning a constant zero
  // satisfies every other assertion in this file -- captured-once, non-decreasing, and
  // not-an-epoch are all true of zero -- and only the upstream fixture caught it. A file
  // claiming to cover the semantics should not need the fixture to notice that.
  assert.ok(event.timeStamp > 0, `expected a real timestamp, got ${event.timeStamp}`);
  assert.ok(
    event.timeStamp < 1_000_000_000,
    `timeStamp looks like an epoch value rather than time since an origin: ${event.timeStamp}`,
  );
});

suite("timeStamp is captured once, at construction", (t) => {
  runtime(t);
  const event = new Event("x");
  const first = event.timeStamp;
  // Burn a little time so a lazily-captured value would differ.
  const until = Date.now() + 3;
  while (Date.now() < until) {
    /* spin */
  }
  assert.equal(event.timeStamp, first, "reading it twice must give the same value");
});

suite("a later event is not stamped earlier than an earlier one", (t) => {
  runtime(t);
  const first = new Event("a");
  const until = Date.now() + 2;
  while (Date.now() < until) {
    /* spin */
  }
  const second = new Event("b");
  // Non-decreasing is the whole contract: the clock may stall, and must not reverse.
  assert.ok(
    second.timeStamp >= first.timeStamp,
    `${second.timeStamp} < ${first.timeStamp}`,
  );
});
