// `stream.Readable === require('_stream_readable')`, with both sides required
// to exist first.
//
// `test-stream-aliases-legacy.js` asserts that identity for five classes and
// nothing else. Under `--empty-exports` `shape.mjs`'s `internals()` hands back
// `callableConstructor(undefined, …)` on both sides, the two absences are equal,
// and the file passes with no module. It was one of five hollow passes on the
// compiled axis.
//
// The upstream assertions are kept. What is added in front of them is what an
// absent module cannot satisfy: each alias has to be a constructor, and it has
// to build something that is an instance of the class it is aliasing.
//
// `notStrictEqual` between two different aliases is there for the other
// direction. Five names all resolving to one object would satisfy every
// identity assertion above and be wrong in a way no upstream file would report.
//
// # This file fails today, and that is the point
//
// `require('_stream_readable')` is `undefined` in the ordinary run, not only
// under a control: the addon publishes one name and `Readable` is not it, so
// `internals()` maps the alias onto nothing. The upstream file passes anyway,
// because its two absent sides are equal.
//
// So there is no passing replacement to write. This one fails with
// `require('_stream_readable') is not a function` until the aliases exist, and
// passes the moment they do. A failing guard is a truer axis entry than a
// passing assertion between two absences.
"use strict";

require("../common");

const assert = require("assert");
const stream = require("stream");

const ALIASES = [
  ["Readable", "_stream_readable"],
  ["Writable", "_stream_writable"],
  ["Duplex", "_stream_duplex"],
  ["Transform", "_stream_transform"],
  ["PassThrough", "_stream_passthrough"],
];

const seen = new Map();
for (const [name, legacy] of ALIASES) {
  const alias = require(legacy);

  // An absent module fails here.
  assert.strictEqual(typeof alias, "function", `require('${legacy}') is not a function`);
  assert.strictEqual(typeof stream[name], "function", `stream.${name} is not a function`);

  // And an empty stand-in fails here: the alias has to construct its own class.
  const built = new alias();
  assert.ok(built instanceof stream[name], `new require('${legacy}')() is not a stream.${name}`);

  // The upstream assertion.
  assert.strictEqual(alias, stream[name], `require('${legacy}') is not stream.${name}`);

  // And the five are five, not one object under five names.
  const before = seen.get(alias);
  assert.strictEqual(before, undefined, `${legacy} is the same object as ${before}`);
  seen.set(alias, legacy);
}
