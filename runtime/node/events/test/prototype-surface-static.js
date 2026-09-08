// Every name node has on `EventEmitter.prototype` is still on ours.
//
// The direction an export diff does not check. `sweep.mjs` audits names absent
// from the *shape* — what a module fails to export — and has never asked whether
// a name that should be on a **prototype** still is. A class can be exported,
// constructed, `instanceof`-correct and answer every value correctly while a
// method has quietly moved off its prototype, and nothing upstream would notice:
// node's tests call `emitter.on(...)`, which works identically whether `on` is
// on the prototype or an own property of every instance.
//
// It matters more for `EventEmitter` than for anything else in the profile.
// `stream`, `net`, `http`, `readline`, `process` and `zlib` all subclass it, so
// every one of them inherits this prototype — a member missing here is missing
// in six other modules, and the failure surfaces as "a listener was called 0
// times" somewhere far away. That exact message cost an hour tonight when an
// environment intrinsic was missing.
//
// **One direction only, deliberately.** This asserts node's names are all
// present, not that ours are exactly node's. `_events`, `_eventsCount` and
// `_maxListeners` are in node's list and are implementation state rather than
// API, so an equality assertion would be pinning node's internals; a missing-only
// assertion pins the contract. If this profile ever *adds* a public name node
// does not have, that is a different test and belongs with the export diff.
"use strict";

require("../common");

const assert = require("assert");
const events = require("events");

// Node's own class, read at run time rather than listed, so this tracks the
// running node rather than the one it was written against.
const nodeProto = require("node:events").prototype;
const ourProto = events.prototype;

const expected = Object.getOwnPropertyNames(nodeProto).sort();
const actual = new Set(Object.getOwnPropertyNames(ourProto));
const missing = expected.filter((member) => !actual.has(member));

assert.ok(expected.length > 10, "node's EventEmitter.prototype looks empty, so this checked nothing");
assert.deepStrictEqual(
  missing,
  [],
  `EventEmitter.prototype is missing member(s) node has: ${missing.join(", ")}`,
);

// And they work through an instance, so a prototype carrying dead names cannot
// pass this.
{
  const emitter = new events();
  let seen = 0;
  const listener = () => { seen++; };

  emitter.on("a", listener);
  assert.strictEqual(emitter.listenerCount("a"), 1, "listenerCount does not count");
  assert.deepStrictEqual(emitter.eventNames(), ["a"], "eventNames does not list");
  emitter.emit("a");
  assert.strictEqual(seen, 1, "emit did not run the listener");

  emitter.off("a", listener);
  assert.strictEqual(emitter.listenerCount("a"), 0, "off did not remove the listener");

  emitter.once("b", listener);
  emitter.emit("b");
  emitter.emit("b");
  assert.strictEqual(seen, 2, "once ran other than exactly once");
}
