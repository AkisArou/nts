/*---
description: A declared but never provided global is a ReferenceError when read, because `declare` emits nothing.
features: [ts-ambient, ts-errors]
---*/
declare const neverProvided: number;
assert.throws(ReferenceError, () => {
  const value = neverProvided + 1;
  assert.sameValue(value, 0);
});
assert.sameValue(typeof neverProvided, "undefined");
