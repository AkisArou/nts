/*---
description: Under define semantics a field initialiser runs before a parameter property is assigned.
features: [ts-parameter-properties, ts-class-fields, ts-class]
---*/
class Probe {
  seen = (this as { base?: number }).base;
  constructor(public base: number) {}
}
const probe = new Probe(4);
assert.sameValue(probe.seen, undefined);
assert.sameValue(probe.base, 4);
