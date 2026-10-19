/*---
description: BigInt() converts integers and integer strings, and refuses fractions; Number() rounds a bigint to the nearest double.
features: [ts-bigint, ts-conversions]
---*/
assert.sameValue(BigInt("123"), 123n);
assert.sameValue(BigInt(42), 42n);
assert.sameValue(BigInt(true), 1n);
assert.throws(RangeError, () => {
  BigInt(1.5);
});
assert.throws(SyntaxError, () => {
  BigInt("1.5");
});
assert.sameValue(Number(2n ** 53n + 1n), 2 ** 53);
assert.sameValue(String(-7n), "-7");
assert.sameValue(`${12n}`, "12");
assert.sameValue((255n).toString(16), "ff");
