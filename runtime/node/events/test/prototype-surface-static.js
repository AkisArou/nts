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

// Node's own names, read at run time from a **subprocess**.
//
// This said `require("node:events").prototype` and called it "node's own class,
// read at run time rather than listed". It is not: the harness substitutes the
// module under test for the `node:` specifier too, so `require("node:events")`
// and `require("events")` are **the same object** --
//
//     same=true  sameProto=true
//
// -- and `expected` was being compared against itself. The file passed for as
// long as it existed and could not have failed for the reason it was written.
// It was found by probing the two specifiers while writing the same shape for
// `zlib`, not by anything going wrong.
//
// A child `node -p` has no harness hooks, so what it prints is node's.
const { execFileSync } = require("child_process");
const expected = JSON.parse(
  execFileSync(
    process.execPath,
    ["-p", 'JSON.stringify(Object.getOwnPropertyNames(require("node:events").prototype).sort())'],
    { encoding: "utf8" },
  ),
);
const ourProto = events.prototype;

// The three the comment above already called implementation state, now that the
// comparison is real enough to surface them. `_events`, `_eventsCount` and
// `_maxListeners` are node's own bookkeeping, live on its prototype, and are not
// part of the contract this file pins -- which is why it was written
// missing-only rather than as an equality. They were named in that reasoning
// before anything could observe them; comparing an object with itself, nothing
// ever did.
//
// By name rather than by an `_` prefix rule: `_` is not a reliable marker of
// private here -- `path._makeLong` is public API in this same profile -- and a
// prefix rule would silently stop checking any future one.
const internals = new Set(["_events", "_eventsCount", "_maxListeners"]);

// Both sides have to be objects before any comparison means anything. Without
// this the sabotage lane failed with `Cannot convert undefined or null to
// object` from inside `getOwnPropertyNames` -- a true failure that names
// neither the module nor the reason, and is indistinguishable from the harness
// itself being broken.
assert.strictEqual(
  typeof ourProto,
  "object",
  `EventEmitter.prototype is ${typeof ourProto}, so there is no surface to check`,
);
assert.ok(
  expected.length > 10,
  `node's EventEmitter.prototype has ${expected.length} names, too few to be real`,
);

const actual = new Set(Object.getOwnPropertyNames(ourProto));
const missing = expected.filter((member) => !actual.has(member) && !internals.has(member));

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
