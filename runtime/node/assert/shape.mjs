// The object node's tests see as `require('assert')`.
//
// `assert` is *callable* -- `assert(value)` is `assert.ok(value)` -- with the
// rest of the family hung off it, and `assert.strict` is the same set with the
// loose comparisons replaced by their strict counterparts. Node assembles it
// the same way, in `lib/assert.js`; this is that assembly, kept out of the
// TypeScript because a module cannot export a callable object.
const METHODS = [
  "fail", "equal", "notEqual", "deepEqual", "notDeepEqual",
  "deepStrictEqual", "notDeepStrictEqual", "strictEqual",
  "notStrictEqual", "partialDeepStrictEqual", "match", "doesNotMatch",
  "throws", "rejects", "doesNotThrow", "doesNotReject", "ifError",
];

export function shape(exports) {
  const assert = function assert(...args) {
    return exports.ok.apply(undefined, args);
  };
  for (const name of METHODS) {
    assert[name] = exports[name];
  }
  assert.ok = assert;
  assert.AssertionError = exports.AssertionError;
  assert.CallTracker = exports.CallTracker;
  assert.Assert = exports.Assert;

  const strict = function strict(...args) {
    return exports.ok.apply(undefined, args);
  };
  for (const name of METHODS) {
    strict[name] = exports[name];
  }
  strict.ok = strict;
  strict.AssertionError = exports.AssertionError;
  strict.CallTracker = exports.CallTracker;
  strict.equal = exports.strictEqual;
  strict.deepEqual = exports.deepStrictEqual;
  strict.notEqual = exports.notStrictEqual;
  strict.notDeepEqual = exports.notDeepStrictEqual;
  strict.Assert = exports.Assert;
  strict.strict = strict;

  assert.strict = strict;
  return assert;
}

/**
 * Node files the diff under `internal/assert/myers_diff`, and its test asks
 * for it by that path with `--expose-internals`. Ours is in
 * `runtime/node/internal/assert/myers-diff.ts`, re-exported from the module.
 */
export function internals(exports) {
  return {
    "internal/assert/myers_diff": {
      myersDiff: exports.myersDiff,
      printMyersDiff: exports.printMyersDiff,
      printSimpleMyersDiff: exports.printSimpleMyersDiff,
    },
  };
}
