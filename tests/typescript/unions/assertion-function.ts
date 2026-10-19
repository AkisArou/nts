/*---
description: An assertion function throws for a bad value and narrows the value after it returns.
features: [ts-unions, ts-narrowing, ts-assertion-functions]
---*/
function assertIsString(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new TypeError("not a string");
}
function shout(value: unknown): string {
  assertIsString(value);
  return value.toUpperCase();
}
assert.sameValue(shout("hey"), "HEY");
assert.throws(TypeError, () => {
  shout(42);
});
