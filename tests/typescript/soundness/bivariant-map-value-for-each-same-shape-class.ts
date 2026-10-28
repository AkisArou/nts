/*---
description: A Map forEach parameter retains same-shape-class after a bivariant write.
features: [ts-unsound-bivariance, ts-map-set, ts-functions, ts-class, ts-structural-typing]
---*/

// TypeScript widens Map method parameters, allowing a different value into this entry.
// forEach still types its value narrowly; node dispatches using the actual class.
class First { kind(): string { return "first"; } }
class Second { kind(): string { return "second"; } }
const values = new Map<string, First>([["key", new First()]]);
const wide: Map<string, unknown> = values;
wide.set("key", new Second());
let visits = 0;
values.forEach((value: First) => {
  visits++;
  assert.sameValue(value.kind(), "second");
});
assert.sameValue(visits, 1);
