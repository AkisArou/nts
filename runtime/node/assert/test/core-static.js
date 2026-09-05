"use strict";

// Supported behavior retained from the broad test-assert.js. That upstream
// file also mixes realms, arbitrary property bags, source-text recovery,
// prototype constructors, custom inspection symbols, and function metadata.
const assert = require("assert");

assert(true);
assert.ok(1);
assert.equal(2, "2");
assert.notEqual(2, 3);
assert.strictEqual(NaN, NaN);
assert.notStrictEqual(0, -0);
assert.deepEqual({ value: 2 }, { value: 2 });
assert.deepStrictEqual([1, { value: 2 }], [1, { value: 2 }]);
assert.notDeepStrictEqual({ value: 2 }, { value: 3 });
assert.partialDeepStrictEqual(
  { user: { name: "Ada", active: true }, extra: 1 },
  { user: { name: "Ada" } },
);
assert.match("native typescript", /type/);
assert.doesNotMatch("native typescript", /java/);

assert.throws(() => assert.strictEqual(1, 2), {
  name: "AssertionError",
  code: "ERR_ASSERTION",
  operator: "strictEqual",
  actual: 1,
  expected: 2,
  generatedMessage: true,
});
assert.throws(() => {
  throw new TypeError("bad input");
}, TypeError);
assert.throws(
  () => {
    throw { code: "E_STATIC", message: "bad input", cause: { id: 7 } };
  },
  { code: "E_STATIC", message: /bad input/, cause: { id: 7 } },
);
assert.throws(
  () =>
    assert.throws(
      () => {
        throw { code: "E_STATIC" };
      },
      { arbitrary: 1 },
    ),
  { code: "ERR_INVALID_ARG_VALUE" },
);
assert.throws(
  () => {
    throw 7;
  },
  (value) => value === 7,
);

assert.doesNotThrow(() => 1 + 1);
assert.throws(
  () =>
    assert.doesNotThrow(() => {
      throw new TypeError("bad input");
    }, TypeError),
  { code: "ERR_ASSERTION", operator: "doesNotThrow" },
);
const range = new RangeError("range");
assert.throws(
  () =>
    assert.doesNotThrow(() => {
      throw range;
    }, TypeError),
  (error) => error === range,
);

assert.throws(() => assert.deepStrictEqual(undefined), {
  code: "ERR_MISSING_ARGS",
});
assert.throws(() => assert.fail("explicit failure"), {
  code: "ERR_ASSERTION",
  message: "explicit failure",
  operator: "fail",
});

assert.strict.equal(1, 1);
assert.throws(() => assert.strict.equal(1, "1"), {
  code: "ERR_ASSERTION",
  operator: "strictEqual",
});

// Supported Assert-class behavior retained from test-assert-class.js. That
// upstream file also requires exact V8 stack-frame elision and observable
// prototype identity; neither belongs to the static NTS object model.
const { Assert } = assert;
assert.throws(() => Assert(), {
  code: "ERR_CONSTRUCT_CALL_REQUIRED",
  name: "TypeError",
});
assert.throws(() => new Assert({ diff: "invalid" }), {
  code: "ERR_INVALID_ARG_VALUE",
  name: "TypeError",
  message: "The property 'options.diff' must be one of: 'simple', 'full'. Received 'invalid'",
});

const looseAssert = new Assert({ strict: false });
looseAssert.equal(null, undefined);
looseAssert.equal(2, "2");
looseAssert.deepEqual({ value: 2 }, { value: "2" });
looseAssert.notStrictEqual(2, "2");
assert.throws(() => looseAssert.strictEqual(2, "2"), {
  code: "ERR_ASSERTION",
  operator: "strictEqual",
});

const strictAssert = new Assert();
assert.strictEqual(strictAssert.equal, strictAssert.strictEqual);
assert.strictEqual(strictAssert.deepEqual, strictAssert.deepStrictEqual);
assert.strictEqual(strictAssert.notEqual, strictAssert.notStrictEqual);
assert.strictEqual(strictAssert.notDeepEqual, strictAssert.notDeepStrictEqual);

class CoolValue {
  constructor(value) {
    this.value = value;
  }
}
class AwesomeValue {
  constructor(value) {
    this.value = value;
  }
}
const structuralAssert = new Assert({ skipPrototype: true });
structuralAssert.deepStrictEqual(new CoolValue(42), new AwesomeValue(42));
assert.throws(() => structuralAssert.deepStrictEqual(new CoolValue(42), new AwesomeValue(7)), {
  code: "ERR_ASSERTION",
});

const longLines = "A\n".repeat(100);
for (const [diff, lineCount] of [
  ["full", 103],
  ["simple", 50],
]) {
  const diffAssert = new Assert({ diff, strict: false });
  assert.throws(
    () => diffAssert.notStrictEqual(longLines, longLines),
    (error) => {
      assert.strictEqual(error.code, "ERR_ASSERTION");
      assert.strictEqual(error.operator, "notStrictEqual");
      assert.strictEqual(error.diff, diff);
      assert.strictEqual(error.actual, longLines);
      assert.strictEqual(error.expected, longLines);
      assert.strictEqual(error.message.split("\n").length, lineCount);
      return true;
    },
  );
}

// Supported relations retained from test-assert-partial-deep-equal.js. Its
// eight failing cases require Symbol-key discovery/property descriptors,
// cross-realm objects, or node:crypto's opaque KeyObject state.
assert.partialDeepStrictEqual(
  { id: 1, profile: { name: "Ada", active: true }, extra: "ignored" },
  { profile: { name: "Ada" } },
);
assert.partialDeepStrictEqual([1, 2, 3, 4], [1, 3]);
assert.throws(() => assert.partialDeepStrictEqual([1, 2, 3], [3, 1]), {
  code: "ERR_ASSERTION",
  operator: "partialDeepStrictEqual",
});

assert.partialDeepStrictEqual(new Set([{ id: 1 }, { id: 2 }, { id: 3 }]), new Set([{ id: 2 }]));
assert.throws(() => assert.partialDeepStrictEqual(new Set([{ id: 1 }]), new Set([{ id: 2 }])), {
  code: "ERR_ASSERTION",
});
assert.partialDeepStrictEqual(
  new Map([
    [{ id: 1 }, { name: "Ada", active: true }],
    [{ id: 2 }, "extra"],
  ]),
  new Map([[{ id: 1 }, { name: "Ada" }]]),
);
assert.throws(
  () =>
    assert.partialDeepStrictEqual(
      new Map([[{ id: 1 }, "actual"]]),
      new Map([[{ id: 1 }, "expected"]]),
    ),
  { code: "ERR_ASSERTION" },
);

assert.partialDeepStrictEqual(new Uint8Array([1, 2, 3, 4]), new Uint8Array([1, 3]));
const actualBuffer = new Uint8Array([1, 2, 3, 4]).buffer;
const expectedBuffer = new Uint8Array([2, 4]).buffer;
assert.partialDeepStrictEqual(actualBuffer, expectedBuffer);
assert.partialDeepStrictEqual(new Date(42), new Date(42));
assert.partialDeepStrictEqual(/native/gi, /native/gi);
assert.throws(() => assert.partialDeepStrictEqual(/native/g, /native/i), { code: "ERR_ASSERTION" });

const actualCycle = { id: 1, extra: true };
actualCycle.self = actualCycle;
const expectedCycle = { id: 1 };
expectedCycle.self = expectedCycle;
assert.partialDeepStrictEqual(actualCycle, expectedCycle);
assert.throws(() => assert.partialDeepStrictEqual(new WeakMap(), new WeakMap()), {
  code: "ERR_ASSERTION",
});
const weakMap = new WeakMap();
assert.deepStrictEqual(weakMap, weakMap);
assert.throws(() => assert.deepStrictEqual(new WeakMap(), new WeakMap()), {
  code: "ERR_ASSERTION",
  operator: "deepStrictEqual",
});
const weakSet = new WeakSet();
assert.deepStrictEqual(weakSet, weakSet);
assert.throws(() => assert.deepStrictEqual(new WeakSet(), new WeakSet()), {
  code: "ERR_ASSERTION",
  operator: "deepStrictEqual",
});
assert.deepStrictEqual(new URL("https://example.com/a"), new URL("https://example.com/a"));
assert.throws(
  () => assert.deepStrictEqual(new URL("https://example.com/a"), new URL("https://example.com/b")),
  { code: "ERR_ASSERTION", operator: "deepStrictEqual" },
);
assert.throws(() => assert.partialDeepStrictEqual(0, -0), { code: "ERR_ASSERTION" });

// Graph aliases must correspond one-to-one. Merely seeing both objects before
// is not enough: a self-cycle cannot match a newly allocated intermediate.
const selfCycle = {};
selfCycle.self = selfCycle;
const indirectCycle = {};
indirectCycle.self = {};
indirectCycle.self.self = selfCycle;
assert.throws(() => assert.deepStrictEqual(selfCycle, indirectCycle), { code: "ERR_ASSERTION" });
assert.throws(() => assert.deepEqual(selfCycle, indirectCycle), { code: "ERR_ASSERTION" });

// Loose Map/Set comparison applies coercive leaf equality while still finding
// a one-to-one unordered matching.
assert.deepEqual(new Set(["1", "2"]), new Set([2, 1]));
// Node's legacy loose Set relation is intentionally order-sensitive for a
// two-member ambiguity. Preserve that contract without falling back to `==`
// over whole container objects.
assert.deepEqual(new Set([0, null]), new Set([0, ""]));
assert.throws(() => assert.deepEqual(new Set([0, ""]), new Set([0, false])), {
  code: "ERR_ASSERTION",
  operator: "deepEqual",
});
assert.partialDeepStrictEqual(new Set([undefined, null, false, 0]), new Set([0, undefined]));
assert.deepEqual(
  new Map([
    ["1", { value: "2" }],
    [false, "zero"],
  ]),
  new Map([
    [1, { value: 2 }],
    [0, "zero"],
  ]),
);
assert.throws(() => assert.deepEqual(new Map([["1", "left"]]), new Map([[1, "right"]])), {
  code: "ERR_ASSERTION",
});

assert.deepStrictEqual(new Date("invalid"), new Date("also invalid"));
const advancedRegExp = /native/g;
advancedRegExp.lastIndex = 2;
assert.throws(() => assert.deepStrictEqual(advancedRegExp, /native/g), { code: "ERR_ASSERTION" });
const arrayWithNamedNumericKey = [1, 2, 3];
arrayWithNamedNumericKey[2 ** 32] = true;
assert.throws(() => assert.deepStrictEqual(arrayWithNamedNumericKey, [1, 2, 3]), {
  code: "ERR_ASSERTION",
});
