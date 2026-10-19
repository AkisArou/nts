/*---
description: A function returning never throws, and code that calls it in a branch narrows the rest.
features: [ts-functions, ts-never, ts-narrowing]
---*/
function fail(message: string): never {
  throw new TypeError(message);
}
function checked(value: number | undefined): number {
  if (value === undefined) fail("missing");
  return value * 2;
}
assert.sameValue(checked(4), 8);
assert.throws(TypeError, () => {
  checked(undefined);
});
