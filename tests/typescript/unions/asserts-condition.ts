/*---
description: An `asserts condition` function throws when its condition is false and narrows by it when true.
features: [ts-unions, ts-narrowing, ts-assertion-functions]
---*/
function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new RangeError(message);
}
function half(value: number | undefined): number {
  check(value !== undefined, "missing");
  return value / 2;
}
assert.sameValue(half(9), 4.5);
assert.throws(RangeError, () => {
  half(undefined);
});
