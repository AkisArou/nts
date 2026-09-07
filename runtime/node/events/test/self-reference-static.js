// `require('events')` is the `EventEmitter` constructor, and it points at
// itself.
//
// Node's `lib/events.js` ends `module.exports = EventEmitter` and then
// `EventEmitter.EventEmitter = EventEmitter`, so the module object *is* the
// class and `events.EventEmitter` is the same function. Both spellings are in
// wide use — `require('events')` and `require('events').EventEmitter` — and
// they have to be one object or the two styles disagree about `instanceof`.
//
// **No upstream test asserts it.** Searched `parallel/` for a comparison of the
// two: there is none. On node it cannot be otherwise, because the tail of
// `lib/events.js` is a self-assignment, so there was never an invariant there to
// test. This is the same shape as `path.posix.posix` and `querystring.decode`,
// and it is the third one found by asking what a module's own source guarantees
// that its tests never check.
//
// It matters here because a module whose export *is* a class is exactly what
// this backend reports it cannot name, and the natural repair publishes a
// namespace object with `EventEmitter` on it. That satisfies
// `require('events').EventEmitter` and quietly breaks `require('events')`,
// which is the more common of the two spellings and the one every subclass in
// `stream`, `net` and `http` is written against.
"use strict";

require("../common");

const assert = require("assert");
const events = require("events");

// The module is the constructor.
assert.strictEqual(typeof events, "function", "require('events') is not a function");
assert.strictEqual(
  events.EventEmitter,
  events,
  "events.EventEmitter is not the module object itself",
);
// Two hops, which a namespace object carrying a separate class would fail.
assert.strictEqual(
  events.EventEmitter.EventEmitter,
  events,
  "events.EventEmitter.EventEmitter does not come back to the module",
);

// And it is a working constructor under both spellings, so this cannot pass by
// both names being equally broken.
for (const [spelling, Ctor] of [["events", events], ["events.EventEmitter", events.EventEmitter]]) {
  const emitter = new Ctor();
  assert.ok(emitter instanceof events, `${spelling}: instance is not an EventEmitter`);

  let seen = 0;
  let payload;
  emitter.on("ping", (value) => {
    seen++;
    payload = value;
  });
  emitter.emit("ping", 7);
  assert.strictEqual(seen, 1, `${spelling}: listener did not run exactly once`);
  assert.strictEqual(payload, 7, `${spelling}: listener did not receive its argument`);
}

// An instance made through one spelling is recognised by the other, which is
// the property the two-object version actually breaks.
assert.ok(
  new events.EventEmitter() instanceof events,
  "an EventEmitter built through the named export is not an instance of the module",
);
