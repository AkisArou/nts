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
  "fail",
  "equal",
  "notEqual",
  "deepEqual",
  "notDeepEqual",
  "deepStrictEqual",
  "notDeepStrictEqual",
  "strictEqual",
  "notStrictEqual",
  "partialDeepStrictEqual",
  "match",
  "doesNotMatch",
  "throws",
  "rejects",
  "doesNotThrow",
  "doesNotReject",
  "ifError",
];

export function shape(exports) {
  // Custom inspection is a Symbol-dispatched Node object hook, deliberately a
  // section-13 non-goal for compiled TypeScript. Keep the whole hook at this
  // JavaScript boundary rather than leaving a symbol-shaped half in the class.
  // Guarded for the reason buffer's is: a compiled `assert` may not publish
  // `AssertionError`, and reaching through an absent export turns "one export
  // is missing" into "the module did not load".
  if (exports.AssertionError !== undefined)
  exports.AssertionError.prototype[inspect.custom] = function (_depth, context) {
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
  // **The callable below is `exports.ok`, and a compiled `assert` may publish no
  // `ok`.** Measured 2026-09-24: it publishes *nothing* -- 0 names -- so
  // `assert(...)` threw `exports.ok is not a function` on every call, and so did
  // `assert.strict(...)`. Every method hung off it was `undefined` besides.
  //
  // That is the **present-and-throwing** failure `querystring/shape.mjs` records
  // four occurrences of, and the guard eleven lines above this one already names
  // the rule for `AssertionError`: "reaching through an absent export turns 'one
  // export is missing' into 'the module did not load'". The rule was right and
  // its scope was the one export it was written for.
  //
  // A manufactured callable is worse than an absent one for the same reason a
  // name bound to `undefined` is: `typeof require("assert") === "function"` is
  // true either way, so a check asking whether the module loaded agrees, and the
  // first call is where it goes wrong -- with a message about this file rather
  // than about the refusal that took `ok`.
  //
  // So hand back the published names, as `process/shape.mjs` does for the same
  // reason and in the same shape. When `ok` publishes, everything below runs
  // unchanged.
  //
  // **What this does not do is make the failure clearer, and that is worth
  // stating.** `surface-identity-static.js` fails either way -- it did before
  // this and it does after -- and the message it fails with *changed*, from
  // `assert.strictEqual is not a function` to `Cannot read properties of
  // undefined (reading 'ok')`. Neither names the cause, which is that nothing
  // published. What the guard buys is narrower and is the part that matters:
  // `typeof require("assert") === "function"` no longer answers true for a
  // module that cannot do anything, so a check asking whether the surface exists
  // stops agreeing with a phantom. The messages get better when `assert`
  // publishes `ok`, not here.
  if (typeof exports.ok !== "function") {
    const partial = {};
    for (const [name, value] of Object.entries(exports)) {
      if (name === "default") continue;
      partial[name] = value;
    }
    return partial;
  }
  // Named `ok`, not `assert`: node's callable reports `name` `"ok"`, because on
  // node the callable *is* `ok`. `assert.name` is `"ok"` there and was `"assert"`
  // here. The binding stays `assert`; only the function's name changes.
  //
  // Spread rather than `.apply`, which is a form this profile does not use.
  const assert = function ok(...args) {
    return exports.ok(...args);
  };
  // `lib/assert.js` installs these three before the assertion family. Keep
  // that order: CommonJS namespace enumeration is observable at this host
  // boundary even though the compiled implementation has no property map.
  assert.AssertionError = exports.AssertionError;
  assert.CallTracker = exports.CallTracker;
  // `assert`, `assert.ok` and `assert.strict.ok` are all **one function**, and
  // it is the loose callable. Measured against node rather than reasoned:
  //
  //     assert.ok === assert                 true
  //     assert.strict.ok === assert          true
  //     assert.strict.ok === assert.strict    false
  //
  // This line was already right. The one below it was not: `strict.ok = strict`
  // gave the strict surface its own `ok`, so the two surfaces disagreed on `ok`
  // while agreeing on `fail` and `ifError`. No test anywhere caught it, because
  // node has no reason to assert the identity of its own two surfaces --
  // `local/surface-identity-static.js` does now.
  assert.ok = assert;
  for (const name of METHODS) {
    assert[name] = exports[name];
  }

  // `name` is already node's `"strict"` here. Spread rather than `.apply`, for
  // the same reason as the callable above.
  const strict = function strict(...args) {
    return exports.ok(...args);
  };
  strict.AssertionError = exports.AssertionError;
  strict.CallTracker = exports.CallTracker;
  strict.ok = assert;
  for (const name of METHODS) {
    strict[name] = exports[name];
  }
  strict.equal = exports.strictEqual;
  strict.deepEqual = exports.deepStrictEqual;
  strict.notEqual = exports.notStrictEqual;
  strict.notDeepEqual = exports.notDeepStrictEqual;
  strict.Assert = Assert;
  strict.strict = strict;

  assert.strict = strict;
  assert.Assert = Assert;
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
