// The object node's tests see as `require('assert')`.
//
// `assert` is *callable* — `assert(value)` is `assert.ok(value)` — with the
// rest of the family hung off it, and `assert.strict` is the same object with
// the loose comparisons replaced by their strict counterparts. Both are shape
// rather than behaviour, and both are what the tests reach for.
export function shape(exports) {
  const assert = function assert(value, message) {
    return exports.ok(value, message);
  };
  Object.assign(assert, exports);
  delete assert.default;

  const strict = function strict(value, message) {
    return exports.ok(value, message);
  };
  Object.assign(strict, exports, {
    equal: exports.strictEqual,
    notEqual: exports.notStrictEqual,
    deepEqual: exports.deepStrictEqual,
    notDeepEqual: exports.notDeepStrictEqual,
  });
  delete strict.default;
  strict.strict = strict;
  assert.strict = strict;
  return assert;
}
