/*---
description: A Map forEach parameter retains number-in-string after a bivariant write.
features: [ts-unsound-bivariance, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions]
---*/

// TypeScript widens Map method parameters, allowing a different value into this entry.
// forEach still types its value narrowly; node preserves the actual value and its conversions.
const values = new Map<string, string>([["key", "safe"]]);
const wide: Map<string, unknown> = values;
wide.set("key", 7);
let visits = 0;
values.forEach((value: string) => {
  visits++;
  assert.sameValue(typeof value, "number");
  assert.sameValue(String(value + 1), "8");
});
assert.sameValue(visits, 1);
