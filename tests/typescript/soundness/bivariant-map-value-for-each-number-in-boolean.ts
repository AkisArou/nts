/*---
description: A Map forEach parameter retains number-in-boolean after a bivariant write.
features: [ts-unsound-bivariance, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions]
---*/

// TypeScript widens Map method parameters, allowing a different value into this entry.
// forEach still types its value narrowly; node preserves the actual value and its conversions.
const values = new Map<string, boolean>([["key", false]]);
const wide: Map<string, unknown> = values;
wide.set("key", 7);
let visits = 0;
values.forEach((value: boolean) => {
  visits++;
  assert.sameValue(typeof value, "number");
  assert.sameValue(String(value), "7");
  assert.sameValue(JSON.stringify(value), "7");
});
assert.sameValue(visits, 1);
