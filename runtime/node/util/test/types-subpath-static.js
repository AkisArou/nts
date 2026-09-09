// `require('util/types')` is `util.types`, with both sides required to carry
// something first.
//
// `test-util-types-exists.js` is three lines:
//
//     assert.strictEqual(require('util/types'), require('util').types);
//
// Under `--empty-exports` both sides are absent and the identity holds. It is
// the same shape as `test-path-posix-exists.js`, which got the same treatment.
//
// # It was hollow before and the control could not see it
//
// This file passed `--empty-exports` only after the harness stopped handing the
// real exports to `subpaths()`. Before that the subpath was built from a
// working module while the public surface was blank, so the two sides genuinely
// differed and the file failed the control -- and was classified `shape-only`,
// which is a real pass on a narrower claim. It is not one. Making the control
// stricter is what turned an apparently-fine row into a finding.
//
// # What is asserted in front of the identity
//
// The namespace has to exist and one of its predicates has to answer. `isDate`
// on a string is the call chosen because it is one the compiled runtime can
// carry today: `util.types` publishes 31 predicates and **none of them can be
// asked about a reference** -- `isDate(new Date())` raises `an argument of this
// type has no representation in the compiled runtime` where node answers
// `true`. So the scalar arm is asserted here, and the reference arm is a
// documented gap rather than a hidden one.
//
// When inbound references cross, this file should grow `isDate(new Date())`.
"use strict";

require("../common");

const assert = require("assert");
const util = require("util");
const types = require("util/types");

// An absent module fails here.
assert.strictEqual(typeof types, "object", "require('util/types') is not an object");
assert.notStrictEqual(types, null, "require('util/types') is null");
assert.strictEqual(typeof util.types, "object", "util.types is not an object");

// And an empty object fails here.
assert.strictEqual(typeof types.isDate, "function", "util/types.isDate is not a function");
assert.strictEqual(typeof types.isMap, "function", "util/types.isMap is not a function");

// A predicate that answers. The scalar arm, which is the arm that works.
assert.strictEqual(types.isDate(""), false, "isDate('') is not false");
assert.strictEqual(types.isDate(0), false, "isDate(0) is not false");
assert.strictEqual(types.isMap(null), false, "isMap(null) is not false");

// The upstream assertion.
assert.strictEqual(types, util.types, "require('util/types') is not util.types");
