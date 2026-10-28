/*---
description: base-to-sub-map-callback finding; the pair changes only the Claimed type alias.
features: [ts-type-aliases, ts-assertion-functions, ts-unknown]
---*/
type Claimed = Sub;
class Base { kind(): string { return "base"; } }
class Sub extends Base { marker: number = 1; override kind(): string { return "sub"; } }
const values = new Map<string, Claimed>([["key", new Sub()]]);
const wide: Map<string, unknown> = values;
wide.set("key", new Base());
let visits = 0;
values.forEach((value: Claimed) => {
  visits++;
  assert.sameValue(value.kind(), "base");
});
assert.sameValue(visits, 1);
