/*---
description: A private compound assignment gets once, sets once and returns the assigned value before setter transformation. The control uses checked per-name Maps.
features: [ts-private-member-routes, ts-private-member-route-methods, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-numbers, ts-accessors, ts-interfaces, ts-inheritance, ts-this, ts-map-set]
---*/
// AccessOwner instances cross a Holder.port interface field; node logs getter then setter and retains the transformed private value. The control stores each private name in its own checked Map.
const log: string[] = [], valuesByOwner = new Map<object, number>();
interface Access { get(this: object): number; set(this: object, value: number): void; }
const accessByOwner = new Map<object, Access>();
const access: Access = {
  get(this: object): number { if (!valuesByOwner.has(this)) throw new TypeError(); const value = valuesByOwner.get(this); if (value === undefined) throw new Error("missing value"); log.push("get:" + value); return value; },
  set(this: object, value: number): void { log.push("set:" + value); if (!valuesByOwner.has(this)) throw new TypeError(); valuesByOwner.set(this, value * 2); }
};
class AccessOwner {
  constructor(value: number) { valuesByOwner.set(this, value); accessByOwner.set(this, access); }
  current(): Access { if (!accessByOwner.has(this)) throw new TypeError(); const result = accessByOwner.get(this); if (result === undefined) throw new Error("missing accessor"); return result; }
  bump(step: number): number { const next = this.current().get.call(this) + step; this.current().set.call(this, next); return next; }
  read(): number { return this.current().get.call(this); }
}
interface Port { bump(step: number): number; read(): number; }
class Holder { port: Port; constructor(port: Port) { this.port = port; } }
class Child extends AccessOwner {}
for (const value of [-0, 0, 3]) {
  const entries: AccessOwner[] = [new Child(value), new AccessOwner(value)];
  for (const entry of entries) {
    const holder = new Holder(entry); log.length = 0;
    assert.sameValue(holder.port.read(), value); assert.compareArray(log, ["get:" + value]); log.length = 0;
    assert.sameValue(holder.port.bump(2), value + 2); assert.sameValue(entry.read(), (value + 2) * 2);
    assert.compareArray(log, ["get:" + value, "set:" + (value + 2), "get:" + ((value + 2) * 2)]);
  }
}
