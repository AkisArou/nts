/*---
description: An exception from a getter propagates to the reader; one from a constructor leaves no object behind.
features: [ts-errors, ts-class, ts-accessors]
---*/
class Guarded {
  static made = 0;
  constructor(ok: boolean) {
    if (!ok) throw new TypeError("refused");
    Guarded.made++;
  }
  get broken(): number {
    throw new RangeError("no value");
  }
}
let instance: Guarded | undefined;
assert.throws(TypeError, () => {
  instance = new Guarded(false);
});
assert.sameValue(instance, undefined);
assert.sameValue(Guarded.made, 0);
assert.throws(RangeError, () => new Guarded(true).broken);
assert.sameValue(Guarded.made, 1);
