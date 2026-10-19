/*---
description: A value of type unknown is narrowed by typeof, instanceof and Array.isArray before use.
features: [ts-unions, ts-narrowing, ts-unknown]
---*/
function size(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.length;
  if (value instanceof Map) return value.size;
  return -1;
}
assert.sameValue(size("abc"), 3);
assert.sameValue(size(8), 8);
assert.sameValue(size([1, 2]), 2);
assert.sameValue(size(new Map([[1, 2]])), 1);
assert.sameValue(size(null), -1);
