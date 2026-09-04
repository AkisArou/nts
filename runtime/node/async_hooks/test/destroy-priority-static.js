"use strict";

// Derived from Node v24.20.0
// test/async-hooks/test-destroy-not-blocked.js. The upstream file reaches its
// threshold through V8's synchronous native weak callbacks, which a
// FinalizationRegistry stand-in cannot reproduce. Explicit destroy reports
// exercise the same queue without changing the algorithm under test.

const assert = require("assert");
const { AsyncResource, createHook } = require("async_hooks");

const trackedType = "NTS_DESTROY_PRIORITY";
let activeId = -1;
let tickSeen = false;
let microtaskSeen = false;
let immediateSeen = false;
let thresholdSeen = false;

createHook({
  init(id, type) {
    if (type === trackedType) activeId = id;
  },
  destroy(id) {
    if (id === activeId) activeId = -1;
  },
}).enable();

const beforeTick = new AsyncResource(trackedType, { requireManualDestroy: true });
beforeTick.emitDestroy();
process.nextTick(() => {
  tickSeen = true;
  assert.strictEqual(activeId, beforeTick.asyncId());

  queueMicrotask(() => {
    microtaskSeen = true;
    assert.strictEqual(activeId, beforeTick.asyncId());
  });

  setImmediate(() => {
    immediateSeen = true;
    assert.strictEqual(activeId, -1);
    testLargeQueue();
  });
});

function testLargeQueue() {
  const first = new AsyncResource(trackedType, { requireManualDestroy: true });
  first.emitDestroy();

  // `first` plus 16,384 ordinary resources makes the pre-append length reach
  // Node's interrupt threshold and schedules the destroy drain as a microtask.
  for (let i = 0; i < 16_384; i++) {
    new AsyncResource("NTS_DESTROY_BULK", { requireManualDestroy: true }).emitDestroy();
  }
  assert.strictEqual(activeId, first.asyncId());
  queueMicrotask(() => {
    thresholdSeen = true;
    assert.strictEqual(activeId, -1);
  });
}

process.on("exit", () => {
  assert.strictEqual(tickSeen, true);
  assert.strictEqual(microtaskSeen, true);
  assert.strictEqual(immediateSeen, true);
  assert.strictEqual(thresholdSeen, true);
});
