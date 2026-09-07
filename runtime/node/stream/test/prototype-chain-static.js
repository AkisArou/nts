// The chain `Transform -> Duplex -> Readable -> Stream`, which nothing asserts.
//
// Node builds it with plain `ObjectSetPrototypeOf` calls in `lib/internal/
// streams/*.js`, and `lib/stream.js` ends `Stream.Stream = Stream`. Searched
// `parallel/` for a `getPrototypeOf` against any stream class: there is none.
// On node these are assignments that cannot produce a different object, so there
// was no invariant there to test — the same argument as `path.posix.posix` and
// `querystring.decode`, and the fourth surface found by asking what a module's
// own source guarantees that its tests never check.
//
// It is the most load-bearing of the four. Every `pipe`, every `instanceof
// Readable` in userland, and every duck-typed check in `http`, `net`, `fs` and
// `zlib` rests on these links. A compiled profile decides `instanceof` by the
// class an object is laid out as, so a backend that gives each class its own
// flat prototype would pass an enormous number of upstream tests before anything
// noticed — a `Duplex` that is not a `Readable` still reads.
//
// **Deliberately not compared against `require("events")`.** In this lane a test
// for `stream` gets the *host's* `node:events`, not this profile's, so asserting
// `Readable.prototype`'s chain ends at that object compares two unrelated
// classes and fails for a reason that has nothing to do with the chain. An
// earlier probe made exactly that mistake and reported that `Readable` is not an
// `EventEmitter`. What is checked instead is that the top of the chain *behaves*
// as an emitter, which is the property the link exists to provide.
"use strict";

require("../common");

const assert = require("assert");
const stream = require("stream");

// The module is the base class.
assert.strictEqual(typeof stream.Stream, "function", "stream.Stream is missing");
assert.strictEqual(stream.Stream, stream, "stream.Stream is not the module object itself");

// Each link, separately, so a break is reported one link from where it is
// rather than as a pile of failed instanceof checks.
for (const [child, parent] of [
  ["Readable", "Stream"],
  ["Writable", "Stream"],
  ["Duplex", "Readable"],
  ["Transform", "Duplex"],
  ["PassThrough", "Transform"],
]) {
  assert.strictEqual(typeof stream[child], "function", `${child} is missing`);
  assert.strictEqual(
    Object.getPrototypeOf(stream[child].prototype),
    stream[parent].prototype,
    `${child}.prototype no longer sits directly on ${parent}.prototype`,
  );
}

// What the chain is for: the derived classes satisfy the base ones.
const readable = new stream.Readable({ read() {} });
assert.ok(readable instanceof stream.Readable, "a Readable is not a Readable");
assert.ok(readable instanceof stream.Stream, "a Readable is not a Stream");

const duplex = new stream.Duplex({ read() {}, write(_c, _e, cb) { cb(); } });
assert.ok(duplex instanceof stream.Duplex, "a Duplex is not a Duplex");
assert.ok(duplex instanceof stream.Readable, "a Duplex is not a Readable");
assert.ok(duplex instanceof stream.Stream, "a Duplex is not a Stream");

const transform = new stream.Transform({ transform(_c, _e, cb) { cb(); } });
assert.ok(transform instanceof stream.Duplex, "a Transform is not a Duplex");
assert.ok(transform instanceof stream.Readable, "a Transform is not a Readable");

// And that the base of the chain carries emitter behaviour, which is the reason
// the link to it exists. Asserted by use rather than by identity, for the reason
// in the header.
let seen = 0;
readable.on("custom", () => {
  seen++;
});
readable.emit("custom");
assert.strictEqual(seen, 1, "a Readable does not behave as an event emitter");
assert.strictEqual(
  typeof readable.once,
  "function",
  "a Readable has no `once`, so the emitter link is not there",
);
