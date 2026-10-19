/*---
description: Methods and fields may be named by computed constant keys.
features: [ts-class, ts-computed-keys, ts-class-fields]
---*/
const prefix = "get";
const METHOD = `${prefix}Twice` as const;
const FIELD = "count";
class Computed {
  [FIELD] = 2;
  [METHOD](): number {
    return this[FIELD] * 2;
  }
}
const computed = new Computed();
assert.sameValue(computed.count, 2);
assert.sameValue(computed.getTwice(), 4);
assert.sameValue(typeof Computed.prototype.getTwice, "function");
