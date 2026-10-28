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
import type { TestContext } from "node:test";

import { createHostNodePrimitives, createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { WebPlatformRuntime, installWebPlatformRuntime } from "../src/provider.ts";
import { Event } from "../src/index.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, fn);
};

function runtime(t: TestContext, now?: () => number): WebPlatformRuntime {
  const api = now === undefined ? createHostNodeWebPlatform() : new WebPlatformRuntime({
    ...createHostNodePrimitives(), monotonicMilliseconds: now,
  });
  if (now !== undefined) installWebPlatformRuntime(api);
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
  let now = 1;
  runtime(t, () => now);
  const event = new Event("x");
  const first = event.timeStamp;
  assert.equal(first, 1);
  now = 9;
  assert.equal(event.timeStamp, first, "reading it twice must give the same value");
});

suite("a later event is not stamped earlier than an earlier one", (t) => {
  let now = 1;
  runtime(t, () => now);
  const first = new Event("a");
  now = 9;
  const second = new Event("b");
  assert.deepEqual([first.timeStamp, second.timeStamp], [1, 9]);
  // Non-decreasing is the whole contract: the clock may stall, and must not reverse.
  assert.ok(
    second.timeStamp >= first.timeStamp,
    `${second.timeStamp} < ${first.timeStamp}`,
  );
});
