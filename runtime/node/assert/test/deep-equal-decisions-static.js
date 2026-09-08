"use strict";

// `deepStrictEqual` on the values where "equal" is a decision.
//
// Node decides all of these in one comparator, so upstream `NaN` equalling
// itself and `0` differing from `-0` are two lines of the same function. Here it
// is a reimplementation, and each row is a separate opportunity.
//
// Twenty-four rows match node, including the ones that surprise people: `NaN`
// **equals** `NaN`; `0` and `-0` **differ**, nested as well as top level; an
// array hole differs from an explicit `undefined`; `Map` and `Set` ignore
// insertion order; a `Map` key of `NaN` matches; two `Uint8Array`s of the same
// bytes are equal but a `Uint8Array` and an `Int8Array` are not; a boxed
// `new Number(1)` differs from `1` but matches another boxed one; two mutually
// circular objects are equal; two `Error`s with the same message are equal and
// with different messages are not; and a non-enumerable own property is ignored.
//
// **Three rows are §13, and they are the most consequential §13 rows in this
// profile.** Node's comparator checks the prototype:
//
//     Buffer.from([1])   vs  new Uint8Array([1])        node: differ
//     Object.create(null) vs {}                          node: differ
//     new (class { x = 1 })() vs { x: 1 }                node: differ
//
// All three are `equal` here, and they cannot be anything else:
// `docs/conformance/typescript.md` §13 lists `getPrototypeOf`, `setPrototypeOf`
// and `__proto__` together — *"there is no chain to read or rewrite"*. A
// comparator with no access to a prototype cannot distinguish two objects that
// differ only by one.
//
// **This weakens every test in the profile that uses `deepStrictEqual`**, which
// is a great many of them: a class instance and a plain object with the same
// fields compare equal, so an assertion that a function returns a `Stats` rather
// than an object literal does not actually check that. Recorded here and in
// `docs/conformance/nodejs.md` because it is the kind of limit that should be
// known before it is relied on, not discovered afterwards.
//
// Asserted rather than omitted, on the §13 rule: if the chain ever becomes
// readable, these three fail and say so.

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
  ["buffer-vs-uint8", "equal"],  // §13: no prototype chain — node says "differ"
  ["arraybuffer", "equal"],
  ["boxed-vs-primitive", "differ"],
  ["boxed-same", "equal"],
  ["symbol-key", "equal"],
  ["proto-differs", "equal"],  // §13: no prototype chain — node says "differ"
  ["class-instance", "equal"],  // §13: no prototype chain — node says "differ"
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
