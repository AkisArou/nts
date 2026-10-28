/*---
description: A Map forEach parameter retains undefined after a bivariant write.
features: [ts-unsound-bivariance, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions, ts-null-undefined]
---*/

// TypeScript widens Map method parameters, allowing a different value into this entry.
// forEach still types its value narrowly; node preserves the actual value and its conversions.
const values = new Map<string, number>([["key", 1]]);
const wide: Map<string, unknown> = values;
wide.set("key", undefined);
let visits = 0;
values.forEach((value: number) => {
  visits++;
  assert.sameValue<unknown>(value, undefined);
  assert.sameValue(typeof value, "undefined");
  assert.sameValue(String(value), "undefined");
});
assert.sameValue(visits, 1);
