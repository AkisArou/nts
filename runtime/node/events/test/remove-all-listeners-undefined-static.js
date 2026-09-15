// `removeAllListeners()` and `removeAllListeners(undefined)` are different calls.
//
// Node reaches its wholesale branch through `if (arguments.length === 0)`. An
// explicit `undefined` falls past it to the per-type branch, looks up
// `events[undefined]`, finds nothing, and removes **nothing**. This profile tested
// `type === undefined` instead, so the two spellings were the same call and an
// explicit `undefined` cleared every listener on the emitter.
//
// That is not a pedantic difference, because `undefined` is what a forwarded
// optional argument looks like. `Readable.prototype.removeAllListeners` passes
// `arguments` straight through to this method, so `stream.removeAllListeners(name)`
// with nothing in `name` removed every listener here and none on node -- silently,
// since removing listeners produces no error and the next event simply has nobody
// to go to.
//
// Found through `stream`: a differential spec called `removeAllListeners` with the
// name chosen by its input, which meant `undefined` on two inputs in three. Nothing
// in `events`' own corpus had ever passed an explicit `undefined`, because writing
// the call that way is unnatural by hand and normal when forwarding.
//
// The second pair matters as much as the first. With a `removeListener` listener
// attached, node takes an entirely different branch -- one that re-enters this
// method per type so the removals are observable -- and that branch had the same
// `type === undefined` test, so both had to change together.
"use strict";

const assert = require("assert");
const { EventEmitter } = require("events");

const withTwo = () => {
  const emitter = new EventEmitter();
  emitter.on("a", () => {});
  emitter.on("b", () => {});
  return emitter;
};
const names = (emitter) => emitter.eventNames().map(String).sort().join(",");

// No arguments: everything goes.
const all = withTwo();
assert.strictEqual(all.removeAllListeners(), all, "it answers the emitter");
assert.strictEqual(names(all), "", "no arguments removes every listener");

// An explicit `undefined`: nothing goes.
const explicit = withTwo();
explicit.removeAllListeners(undefined);
assert.strictEqual(
  names(explicit), "a,b",
  "an explicit undefined must remove nothing, as `events[undefined]` matches nothing",
);

// And the spread form, which is how a forwarder actually reaches this.
const forwarded = withTwo();
const forward = (...args) => forwarded.removeAllListeners(...args);
forward(undefined);
assert.strictEqual(names(forwarded), "a,b", "forwarding one undefined argument removes nothing");
forward();
assert.strictEqual(names(forwarded), "", "forwarding no argument removes everything");

// A name that exists, and one that does not.
const named = withTwo();
named.removeAllListeners("a");
assert.strictEqual(names(named), "b");
named.removeAllListeners("nope");
assert.strictEqual(names(named), "b", "an unknown name removes nothing");

// `null` is a value like any other and matches no key, which this already did --
// the control that says the fix is about `arguments.length` and not about
// nullishness.
const nulled = withTwo();
nulled.removeAllListeners(null);
assert.strictEqual(names(nulled), "a,b", "null is a key that matches nothing");

// The `removeListener`-watching branch, which is separate code with the same test.
const watched = withTwo();
const removed = [];
watched.on("removeListener", (name) => removed.push(name));
watched.removeAllListeners(undefined);
assert.strictEqual(
  names(watched), "a,b,removeListener",
  "the watching branch must also leave an explicit undefined alone",
);
assert.deepStrictEqual(removed, [], "and must announce no removals");

watched.removeAllListeners();
assert.strictEqual(names(watched), "", "while no arguments still clears it");
assert.deepStrictEqual(
  removed, ["a", "b"],
  "announcing each named removal, but not its own listener",
);
// Measured rather than assumed: this first asserted that `removeListener` appeared
// in its own list, which is what the code reads like -- node removes it last,
// through the same per-type path that emits for `a` and `b`. Node reports `["a",
// "b"]`, and this profile already agreed. Writing down the answer the oracle gives
// is the point of the file; writing down the one the code suggests would have
// pinned a behaviour neither side has.

// Arity is part of the shape: node's is 1, and a rest parameter would make it 0.
assert.strictEqual(
  EventEmitter.prototype.removeAllListeners.length, 1,
  "`removeAllListeners.length` must stay 1, which rules out a rest parameter",
);
