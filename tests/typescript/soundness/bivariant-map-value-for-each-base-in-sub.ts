/*---
description: A Map forEach parameter retains base-in-sub after a bivariant write.
features: [ts-unsound-bivariance, ts-map-set, ts-functions, ts-class, ts-structural-typing, ts-inheritance, ts-class-fields, ts-override]
---*/

// TypeScript widens Map method parameters, allowing a different value into this entry.
// forEach still types its value narrowly; node dispatches using the actual class.
class Base { kind(): string { return "base"; } }
class Sub extends Base { marker: number = 1; override kind(): string { return "sub"; } }
const values = new Map<string, Sub>([["key", new Sub()]]);
const wide: Map<string, unknown> = values;
wide.set("key", new Base());
let visits = 0;
values.forEach((value: Sub) => {
  visits++;
  assert.sameValue(value.kind(), "base");
});
assert.sameValue(visits, 1);
