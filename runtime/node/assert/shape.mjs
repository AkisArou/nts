// The object node's tests see as `require('assert')`.
//
// `assert` is *callable* -- `assert(value)` is `assert.ok(value)` -- with the
// rest of the family hung off it, and `assert.strict` is the same set with the
// loose comparisons replaced by their strict counterparts. Node assembles it
// the same way, in `lib/assert.js`; this is that assembly, kept out of the
// TypeScript because a module cannot export a callable object.
import { inspect } from "node:util";

const MAX_LONG_STRING_LENGTH = 512;

function addEllipsis(value) {
  const lines = value.split("\n", 11);
  if (lines.length > 10) {
    lines.length = 10;
    return `${lines.join("\n")}\n...`;
  }
  if (value.length > MAX_LONG_STRING_LENGTH) {
    return `${value.slice(MAX_LONG_STRING_LENGTH)}...`;
  }
  return value;
}

const METHODS = [
  "fail", "equal", "notEqual", "deepEqual", "notDeepEqual",
  "deepStrictEqual", "notDeepStrictEqual", "strictEqual",
  "notStrictEqual", "partialDeepStrictEqual", "match", "doesNotMatch",
  "throws", "rejects", "doesNotThrow", "doesNotReject", "ifError",
];

export function shape(exports) {
  // Custom inspection is a Symbol-dispatched Node object hook, deliberately a
  // section-13 non-goal for compiled TypeScript. Keep the whole hook at this
  // JavaScript boundary rather than leaving a symbol-shaped half in the class.
  exports.AssertionError.prototype[inspect.custom] = function(_depth, context) {
    const actual = this.actual;
    const expected = this.expected;
    if (typeof actual === "string") this.actual = addEllipsis(actual);
    if (typeof expected === "string") this.expected = addEllipsis(expected);
    try {
      return inspect(this, { ...context, customInspect: false, depth: 0 });
    } finally {
      this.actual = actual;
      this.expected = expected;
    }
  };
  const Assert = function Assert(options) {
    if (new.target === undefined) {
      const error = new TypeError("Class constructor Assert cannot be invoked without 'new'");
      error.code = "ERR_CONSTRUCT_CALL_REQUIRED";
      throw error;
    }
    return new exports.Assert(options);
  };
  const assert = function assert(...args) {
    return exports.ok.apply(undefined, args);
  };
  for (const name of METHODS) {
    assert[name] = exports[name];
  }
  assert.ok = assert;
  assert.AssertionError = exports.AssertionError;
  assert.CallTracker = exports.CallTracker;
  assert.Assert = Assert;

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
  strict.Assert = Assert;
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
