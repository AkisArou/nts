// `isDeepStrictEqual` compares own **enumerable symbol** keys, which `Object.keys` omits.
//
// Found by `tooling/conformance/fuzz-deep-equal.mjs`, which nothing gates: 10 divergences in
// 21,382 comparisons, every one of them a value under a symbol key. Before the fix
// `{ [s]: 1 }` and `{ [s]: 2 }` were deep-strict-equal, and so were `{ [s]: 1 }` and `{}`.
//
// It also hid a rule this profile already implemented. `compareByKind` returns false for a
// `WeakMap`, `WeakSet` or `Promise` -- two distinct ones can never be shown equal, which is
// node's own rule at `internal/util/comparisons.js:446`. That branch is reached only for a
// value the key walk descends into, so a `WeakMap` behind a symbol never got there. A correct
// rule guarded by a walk that cannot reach it reads exactly like a correct implementation,
// and the fuzzer reported it as a `WeakMap` bug rather than a symbol one.
//
// node's rule, from `keyCheck`: string keys and their counts first, then own *enumerable*
// symbols pushed onto both sides and the totals compared. Strict only -- `deepEqual` ignores
// symbols, and the last case pins that.
//
// Every expectation below was read off node before it was written here.
"use strict";

require("../common");

const assert = require("assert");
const util = require("util");

const s = Symbol("k");

// The three the fuzzer found, reduced.
assert.strictEqual(util.isDeepStrictEqual({ [s]: 1 }, { [s]: 2 }), false,
  "differing values under one symbol compared equal");
assert.strictEqual(util.isDeepStrictEqual({ [s]: 1 }, {}), false,
  "a symbol key present on one side only compared equal");
assert.strictEqual(util.isDeepStrictEqual({ [s]: 1 }, { [s]: 1 }), true,
  "the same value under one symbol compared unequal");

// The rule the walk was hiding: two distinct uninspectable objects are never equal.
assert.strictEqual(util.isDeepStrictEqual({ [s]: new WeakMap() }, { [s]: new WeakMap() }), false,
  "two distinct WeakMaps behind a symbol compared equal");
assert.strictEqual(util.isDeepStrictEqual({ [s]: new WeakSet() }, { [s]: new WeakSet() }), false,
  "two distinct WeakSets behind a symbol compared equal");
assert.strictEqual(util.isDeepStrictEqual({ [s]: Promise.resolve(1) }, { [s]: Promise.resolve(1) }), false,
  "two distinct Promises behind a symbol compared equal");

// Enumerability is the test, not presence.
const hiddenOne = {};
const hiddenTwo = {};
Object.defineProperty(hiddenOne, s, { value: 1, enumerable: false });
Object.defineProperty(hiddenTwo, s, { value: 2, enumerable: false });
assert.strictEqual(util.isDeepStrictEqual(hiddenOne, hiddenTwo), true,
  "non-enumerable symbols must not be compared");

const shown = {};
Object.defineProperty(shown, s, { value: 1, enumerable: true });
assert.strictEqual(util.isDeepStrictEqual(shown, hiddenOne), false,
  "the same symbol enumerable on one side only compared equal");

// Arrays and the keyed collections carry them too.
const arrayOne = [1, 2];
const arrayTwo = [1, 2];
arrayOne[s] = 1;
arrayTwo[s] = 2;
assert.strictEqual(util.isDeepStrictEqual(arrayOne, arrayTwo), false,
  "an array's symbol property was not compared");

const mapOne = new Map([["a", 1]]);
const mapTwo = new Map([["a", 1]]);
mapOne[s] = 1;
mapTwo[s] = 2;
assert.strictEqual(util.isDeepStrictEqual(mapOne, mapTwo), false,
  "a Map's symbol property was not compared");

// `deepEqual` is loose and node does not add symbols there. This must stay passing.
assert.doesNotThrow(() => assert.deepEqual({ [s]: 1 }, { [s]: 2 }),
  "loose deepEqual must ignore symbol keys");
