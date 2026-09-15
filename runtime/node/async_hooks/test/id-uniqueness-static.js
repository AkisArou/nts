// An async id is never the root's, and `unhandledRejection` runs in the rejected promise's scope.
//
// These are one finding in two halves, and the second was hidden by the first.
//
// `currentExecutionAsyncId` starts at 1 — the bootstrap context node also numbers 1 — and the
// allocator's counter started at 0, so the **first** `AsyncResource` a program created was also 1.
// Two different contexts with one id. Measured against node:
//
//     node   before=1 inside=2 own=2      this profile, before   before=1 inside=1 own=1
//
// And `async-hooks/test-unhandled-rejection-context` asserts that `executionAsyncId()` inside the
// handler equals the rejected promise's id — nothing about the id's value. It passed **because of
// the collision**: this profile emitted the event in the root context, and the promise's id was 1,
// which is the root's. Reserving 1 turned that coincidence into `actual: 1, expected: 2`.
//
// Fixing either alone leaves the other wrong: the collision is a uniqueness violation, and the
// scope is what the upstream test is actually about. Found by a differential spec that compared
// whether entering a scope *changes* the current id rather than what the id is — the values differ
// between processes by design and are not comparable, the relationship is.
"use strict";

const common = require("../common");

const assert = require("assert");
const async_hooks = require("async_hooks");

const root = async_hooks.executionAsyncId();
assert.strictEqual(root, 1, "the bootstrap context is 1, as node numbers it");

// The first resource must not be the root, which is the whole of the first half.
const first = new async_hooks.AsyncResource("Uniqueness");
assert.notStrictEqual(first.asyncId(), root,
  "the first allocated async id collided with the root's");
assert.ok(first.asyncId() > root, `expected an id above ${root}, got ${first.asyncId()}`);

// Entering a resource's scope changes the current id and leaving restores it. The control is the
// restore: an implementation that never entered would satisfy neither, and one that entered and
// never left would satisfy the first only.
const inside = first.runInAsyncScope(() => async_hooks.executionAsyncId());
assert.strictEqual(inside, first.asyncId(), "inside the scope, the current id is the resource's");
assert.strictEqual(async_hooks.executionAsyncId(), root, "the scope was not left");

// Ids stay distinct as they are handed out.
const seen = new Set([root, first.asyncId()]);
for (let i = 0; i < 4; i++) {
  const id = new async_hooks.AsyncResource("Uniqueness").asyncId();
  assert.ok(!seen.has(id), `async id ${id} was handed out twice`);
  seen.add(id);
}

// The second half: the handler runs in the rejected promise's scope.
const promiseIds = [];
const hook = async_hooks.createHook({
  init(id, type) { if (type === "PROMISE") promiseIds.push(id); },
});
hook.enable();
Promise.reject(new Error("pinned"));

process.on("unhandledRejection", common.mustCall(() => {
  hook.disable();
  assert.ok(promiseIds.length > 0, "no PROMISE init was observed");
  assert.strictEqual(
    async_hooks.executionAsyncId(),
    promiseIds[promiseIds.length - 1],
    "unhandledRejection must run inside the rejected promise's async scope",
  );
  assert.notStrictEqual(async_hooks.executionAsyncId(), root,
    "running in the root context is what the id collision used to hide");
}));
