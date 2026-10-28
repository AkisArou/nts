/*---
description: A Map forEach parameter retains null after a bivariant write.
features: [ts-unsound-bivariance, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions, ts-null-undefined]
---*/

// TypeScript widens Map method parameters, allowing a different value into this entry.
// forEach still types its value narrowly; node preserves the actual value and its conversions.
const values = new Map<string, number>([["key", 1]]);
const wide: Map<string, unknown> = values;
wide.set("key", null);
let visits = 0;
values.forEach((value: number) => {
  visits++;
  assert.sameValue<unknown>(value, null);
  assert.sameValue(typeof value, "object");
  assert.sameValue(String(value), "null");
});
assert.sameValue(visits, 1);
