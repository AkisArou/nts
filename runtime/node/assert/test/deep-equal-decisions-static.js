"use strict";

// `deepStrictEqual` on the values where "equal" is a decision.
//
// Node decides all of these in one comparator, so upstream `NaN` equalling
// itself and `0` differing from `-0` are two lines of the same function. Here it
// is a reimplementation, and each row is a separate opportunity.
//
// All twenty-eight rows match node, including the ones that surprise people: `NaN`
// **equals** `NaN`; `0` and `-0` **differ**, nested as well as top level; an
// array hole differs from an explicit `undefined`; `Map` and `Set` ignore
// insertion order; a `Map` key of `NaN` matches; two `Uint8Array`s of the same
// bytes are equal but a `Uint8Array` and an `Int8Array` are not; a boxed
// `new Number(1)` differs from `1` but matches another boxed one; two mutually
// circular objects are equal; two `Error`s with the same message are equal and
// with different messages are not; and a non-enumerable own property is ignored.
//
// **The three rows that used to be §13 now match node**, and the story is worth
// keeping because the refusal was recorded here, believed, and wrong.
//
//     Buffer.from([1])        vs  new Uint8Array([1])     node: differ
//     Object.create(null)     vs  {}                      node: differ
//     new (class { x = 1 })() vs  { x: 1 }                node: differ
//
// This file used to assert `equal` for all three and explain that they could not
// be anything else, citing `docs/conformance/typescript.md` §13: `getPrototypeOf`,
// `setPrototypeOf` and `__proto__` are listed together as *"there is no chain to
// read or rewrite"*, so a comparator with no prototype access cannot separate two
// objects that differ only by one.
//
// Every sentence of that was true and the conclusion did not follow. §13 is a
// statement about the **compiled** backend, and the compiled backend does not run
// this comparator at all: `isDeepStrictEqual` is already declined there -- "is
// exported and was not compiled: it calls `objectPairs`, which was refused above"
// -- along with `deepStrictEqual`, `notDeepStrictEqual` and
// `partialDeepStrictEqual`. The refusal that was said to force `equal` applies to
// a lane on which none of these functions exist. On the lane that does run them,
// objects are ordinary JavaScript objects with ordinary prototypes.
//
// So the cost was measured rather than argued: adding node's check moved `util`'s
// own refusals from 76 to 78 and `assert`'s cone from 965 to 967, and left the
// declined-export count unchanged at 36 and 24. Two more refusals inside a
// function that was already refused, and no published name lost.
//
// What node actually compares is the **constructor**, with a prototype fallback
// when the constructor is undefined and not an own property -- which is what
// `Object.create(null)` is. Comparing prototypes first would be a different
// relation: `{ constructor: Object }` is decided by its constructor upstream.
//
// The three rows mattered more than their number suggests, and the old header
// said so: while they read `equal`, **every** `deepStrictEqual` in the profile was
// weaker than it looked, because a class instance and a plain object with the
// same fields compared equal. An assertion that a function returns a `Stats`
// rather than an object literal was not checking that. That is now checked.
//
// Kept as a table rather than collapsed, on the §13 rule that made it useful: an
// asserted row that goes wrong says which decision changed. This file failing on
// `buffer-vs-uint8` is how the fix was confirmed to reach all three.

const assert = require("node:assert");

const EXPECTED = [
  ["nan", "equal"],
  ["zero-signs", "differ"],
  ["zero-signs-nested", "differ"],
  ["array-holes", "differ"],
  ["array-extra-prop", "differ"],
  ["date-same", "equal"],
  ["date-nan", "equal"],
  ["regexp-same", "equal"],
  ["regexp-flags", "differ"],
  ["regexp-lastIndex", "differ"],
  ["map-order", "equal"],
  ["set-order", "equal"],
  ["map-nan-key", "equal"],
  ["typed-array-kind", "differ"],
  ["typed-array-same", "equal"],
  ["buffer-vs-uint8", "differ"],
  ["arraybuffer", "equal"],
  ["boxed-vs-primitive", "differ"],
  ["boxed-same", "equal"],
  ["symbol-key", "equal"],
  ["proto-differs", "differ"],
  ["class-instance", "differ"],
  ["circular", "equal"],
  ["error-same", "equal"],
  ["error-message", "differ"],
  ["error-kind", "differ"],
  ["sparse-length", "differ"],
  ["nonenumerable", "equal"],
];

const rows = [];
const eq = (label, a, b) => {
  let out;
  try {
    assert.deepStrictEqual(a, b);
    out = "equal";
  } catch (e) {
    out = e.code === "ERR_ASSERTION" ? "differ" : "THROW:" + e.code;
  }
  rows.push([label, out]);
};

eq("nan", NaN, NaN);
eq("zero-signs", 0, -0);
eq("zero-signs-nested", { a: 0 }, { a: -0 });
eq("array-holes", [ , 1], [undefined, 1]);
eq("array-extra-prop", Object.assign([1], { x: 2 }), [1]);
eq("date-same", new Date(0), new Date(0));
eq("date-nan", new Date(NaN), new Date(NaN));
eq("regexp-same", /a/g, /a/g);
eq("regexp-flags", /a/g, /a/i);
eq("regexp-lastIndex", Object.assign(/a/g, { lastIndex: 3 }), /a/g);
eq("map-order", new Map([["a",1],["b",2]]), new Map([["b",2],["a",1]]));
eq("set-order", new Set([1,2]), new Set([2,1]));
eq("map-nan-key", new Map([[NaN,1]]), new Map([[NaN,1]]));
eq("typed-array-kind", new Uint8Array([1]), new Int8Array([1]));
eq("typed-array-same", new Uint8Array([1]), new Uint8Array([1]));
eq("buffer-vs-uint8", Buffer.from([1]), new Uint8Array([1]));
eq("arraybuffer", new Uint8Array([1]).buffer, new Uint8Array([1]).buffer);
eq("boxed-vs-primitive", new Number(1), 1);
eq("boxed-same", new Number(1), new Number(1));
eq("symbol-key", { [Symbol.for("k")]: 1 }, { [Symbol.for("k")]: 1 });
eq("proto-differs", Object.create(null), {});
eq("class-instance", new (class A { constructor(){ this.x = 1; } })(), { x: 1 });
eq("circular", (() => { const a = {}; a.self = a; return a; })(), (() => { const b = {}; b.self = b; return b; })());
eq("error-same", new Error("m"), new Error("m"));
eq("error-message", new Error("m"), new Error("n"));
eq("error-kind", new TypeError("m"), new Error("m"));
eq("sparse-length", new Array(3), [undefined, undefined, undefined]);
eq("nonenumerable", Object.defineProperty({}, "h", { value: 1 }), {});

assert.strictEqual(rows.length, EXPECTED.length, "every case was reached");
for (let i = 0; i < EXPECTED.length; i++) {
  assert.strictEqual(rows[i][0], EXPECTED[i][0], `case ${i} label`);
  assert.strictEqual(rows[i][1], EXPECTED[i][1], rows[i][0]);
}
