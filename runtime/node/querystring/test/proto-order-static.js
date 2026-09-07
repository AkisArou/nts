// `__proto__` is a key like any other, including in enumeration order.
//
// `parse` has to give `__proto__` special treatment, because assigning it on an
// ordinary object hits the legacy setter instead of creating an own property.
// The first version of that special case built a fresh object with `__proto__`
// first and copied everything already parsed in after it, which made the key
// order depend on whether `__proto__` appeared at all: `parse("a&__proto__")`
// enumerated as `__proto__, a`, and `stringify(parse(s))` came back with the
// pairs reordered.
//
// None of the four pinned `querystring` files covers key order, so nothing
// failed. It was found by a differential against node over 4,000 generated
// query strings -- 20 divergences, every one of them a `__proto__` in a
// position other than the one node puts it in.
"use strict";

require("../common");

const assert = require("assert");
const qs = require("querystring");

// Node appends it where it appears, so all three orders are distinguishable.
for (const [query, expected] of [
  ["a&__proto__", ["a", "__proto__"]],
  ["__proto__&a", ["__proto__", "a"]],
  ["a&__proto__&b", ["a", "__proto__", "b"]],
  ["a=1&__proto__=2&b=3", ["a", "__proto__", "b"]],
]) {
  const parsed = qs.parse(query);
  assert.deepStrictEqual(Object.keys(parsed), expected, `key order for ${query}`);

  // It has to be an own data property, not the inherited setter: an object that
  // merely *looks* right when enumerated would still have taken the prototype.
  assert.ok(Object.hasOwn(parsed, "__proto__"), `${query}: __proto__ is not an own property`);
  assert.strictEqual(
    Object.getPrototypeOf(parsed),
    null,
    `${query}: parse did not return a null-prototype object`,
  );
}

// The order is observable through `stringify`, which is how it was found.
assert.strictEqual(qs.stringify(qs.parse("a=1&__proto__=2")), "a=1&__proto__=2");
assert.strictEqual(qs.stringify(qs.parse("__proto__=2&a=1")), "__proto__=2&a=1");
