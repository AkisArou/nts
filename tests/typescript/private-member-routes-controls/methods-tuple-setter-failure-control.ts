/*---
description: A private setter reached through tuple receivers preserves ordered logs and leaves its field unchanged when it throws. The control uses checked per-name Maps.
features: [ts-private-member-routes, ts-private-member-route-methods, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-numbers, ts-accessors, ts-inheritance, ts-tuples, ts-this, ts-map-set]
---*/
// CheckedOwner instances cross typed tuple slots; node calls the setter without a getter and preserves the old value on TypeError. The control stores each private name in its own checked Map.
const log: string[] = [], valuesByOwner = new Map<object, number>();
interface Access { get(this: object): number; set(this: object, value: number): void; }
const accessByOwner = new Map<object, Access>();
const access: Access = {
  get(this: object): number { log.push("get"); if (!valuesByOwner.has(this)) throw new TypeError(); const value = valuesByOwner.get(this); if (value === undefined) throw new Error("missing value"); return value; },
  set(this: object, value: number): void { log.push("set:" + value); if (value < 0) throw new TypeError(); if (!valuesByOwner.has(this)) throw new TypeError(); valuesByOwner.set(this, value); }
};
class CheckedOwner {
  constructor(value: number) { valuesByOwner.set(this, value); accessByOwner.set(this, access); }
  current(): Access { if (!accessByOwner.has(this)) throw new TypeError(); const result = accessByOwner.get(this); if (result === undefined) throw new Error("missing accessor"); return result; }
  write(value: number): number { this.current().set.call(this, value); return value; }
  read(): number { return this.current().get.call(this); }
}
class Child extends CheckedOwner {}
for (const initial of [0, 2, 7]) {
  const entries: [CheckedOwner, number, boolean][] = [[new CheckedOwner(initial), 4, false], [new Child(initial), -1, true], [new Child(initial), -0, false]];
  for (const [owner, next, fails] of entries) {
    log.length = 0;
    if (fails) assert.throws(TypeError, () => owner.write(next)); else assert.sameValue(owner.write(next), next);
    assert.compareArray(log, ["set:" + next]);
    assert.sameValue(owner.read(), fails ? initial : next); assert.compareArray(log, ["set:" + next, "get"]);
  }
}
