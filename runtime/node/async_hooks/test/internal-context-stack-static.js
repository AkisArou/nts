// The async id stack, through the facade node's own `lib/` uses.
//
// The compiled `async_hooks` records zero passes. Its public surface is three
// of node's names -- `executionAsyncId`, `triggerAsyncId`,
// `executionAsyncResource` -- and `context-scope-static.js` next door needs
// `AsyncResource` and `AsyncLocalStorage`, which are not published, so it
// cannot run. Underneath that, the id stack works.
//
// `internal/async_hooks` is the facade `shape.mjs` builds for exactly this:
// node's `lib/` reaches these names, and so do node's own tests for the
// machinery rather than the classes.
//
// # What it demonstrates that a constant cannot
//
//     newAsyncId()                    1, 2, 3, 4 -- strictly increasing
//     executionAsyncId() at top level 1          -- node's value
//     triggerAsyncId() at top level   0          -- node's value
//     push(id, trigger)               exec becomes id, trigger becomes trigger
//     hasAsyncIdStack()               false -> true -> false
//     pop(id)                         both restored
//
// Every line after the first two needs the addon to be *holding* something: a
// counter that advances, and a stack that a write is visible through and a
// second write undoes. `--mutate-addon` keeps the names and destroys that, and
// a stub answering node's constants passes the first two rows and fails the
// rest.
//
// # The nested push is not decoration
//
// One push and one pop is satisfied by a single slot. Two pushes, an
// observation in between, and two pops in order is not -- it needs the stack to
// be a stack. That is the shape of the defect this would otherwise miss.
//
// This runs in the same process as the rest of the suite, so the file has to
// leave the stack exactly as it found it. The final assertions are that check
// rather than a formality.
"use strict";

require("../common");

const assert = require("assert");
const hooks = require("internal/async_hooks");

for (const name of [
  "newAsyncId", "executionAsyncId", "triggerAsyncId",
  "hasAsyncIdStack", "pushAsyncContext", "popAsyncContext",
]) {
  assert.strictEqual(
    typeof hooks[name],
    "function",
    `internal/async_hooks.${name} is not a function`,
  );
}

// The counter advances rather than answering a constant.
const first = hooks.newAsyncId();
const second = hooks.newAsyncId();
const third = hooks.newAsyncId();
assert.strictEqual(typeof first, "number", "newAsyncId did not return a number");
assert.ok(second > first, `newAsyncId did not advance: ${first} then ${second}`);
assert.ok(third > second, `newAsyncId did not advance: ${second} then ${third}`);

// Node's values at the top of the stack.
const baseExecution = hooks.executionAsyncId();
const baseTrigger = hooks.triggerAsyncId();
assert.strictEqual(baseExecution, 1, "the top-level executionAsyncId is not 1");
assert.strictEqual(baseTrigger, 0, "the top-level triggerAsyncId is not 0");
assert.strictEqual(hooks.hasAsyncIdStack(), false, "the stack is not empty at the top level");

const outer = hooks.newAsyncId();
const inner = hooks.newAsyncId();

try {
  hooks.pushAsyncContext(outer, 41, undefined);
  assert.strictEqual(hooks.executionAsyncId(), outer, "the pushed id is not current");
  assert.strictEqual(hooks.triggerAsyncId(), 41, "the pushed trigger is not current");
  assert.strictEqual(hooks.hasAsyncIdStack(), true, "the stack reads empty after a push");

  // A second frame, so one slot is not enough.
  hooks.pushAsyncContext(inner, 42, undefined);
  assert.strictEqual(hooks.executionAsyncId(), inner, "the nested id is not current");
  assert.strictEqual(hooks.triggerAsyncId(), 42, "the nested trigger is not current");

  hooks.popAsyncContext(inner);
  assert.strictEqual(
    hooks.executionAsyncId(),
    outer,
    "popping the nested frame did not restore the outer one",
  );
  assert.strictEqual(hooks.triggerAsyncId(), 41, "popping did not restore the outer trigger");

  hooks.popAsyncContext(outer);
} finally {
  // Whatever happened above, the suite continues in this process.
  while (hooks.hasAsyncIdStack()) hooks.popAsyncContext(hooks.executionAsyncId());
}

assert.strictEqual(hooks.executionAsyncId(), baseExecution, "the base id was not restored");
assert.strictEqual(hooks.triggerAsyncId(), baseTrigger, "the base trigger was not restored");
assert.strictEqual(hooks.hasAsyncIdStack(), false, "the stack was left non-empty");
