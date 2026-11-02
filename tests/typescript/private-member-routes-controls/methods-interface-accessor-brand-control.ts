/*---
description: A private accessor has its own brand and rejects lookalikes before either getter or setter side effect runs. The control uses checked per-name Maps.
features: [ts-private-member-routes, ts-private-member-route-methods, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-numbers, ts-accessors, ts-interfaces, ts-unsound-bivariance, ts-inheritance, ts-tuples, ts-this, ts-map-set]
---*/
// AccessBrand instances cross a widened interface parameter; node preserves accessor results and throws before logging on an unbranded receiver. The control stores each private name in its own checked Map.
const log: string[] = [];
interface Access { get(this: { amount: number }): number; set(this: { amount: number }, value: number): void; }
const accessByOwner = new Map<object, Access>();
const access: Access = { get(): number { log.push("get"); return this.amount; }, set(value: number): void { log.push("set"); this.amount = value; } };
class AccessBrand {
  amount: number = 3;
  constructor() { accessByOwner.set(this, access); }
  static owns(value: object): boolean { return accessByOwner.has(value); }
  static read(target: AccessBrand): number { if (!accessByOwner.has(target)) throw new TypeError(); const item = accessByOwner.get(target); if (item === undefined) throw new Error("missing accessor"); return item.get.call(target); }
  static write(target: AccessBrand, value: number): number { if (!accessByOwner.has(target)) throw new TypeError(); const item = accessByOwner.get(target); if (item === undefined) throw new Error("missing accessor"); item.set.call(target, value); return value; }
}
class Child extends AccessBrand {}
interface AccessPort { read(target: object): number; write(target: object, value: number): number; }
const port: AccessPort = AccessBrand;
for (const next of [-0, 4, 9]) {
  const plain = { amount: 3 }, entries: [object, boolean][] = [[new AccessBrand(), true], [plain, false], [new Child(), true]];
  for (const [target, valid] of entries) {
    log.length = 0; assert.sameValue(AccessBrand.owns(target), valid);
    if (valid) {
      assert.sameValue(port.read(target), 3); assert.sameValue(port.write(target, next), next); assert.sameValue(port.read(target), next);
      assert.compareArray(log, ["get", "set", "get"]);
    } else {
      assert.throws(TypeError, () => port.read(target)); assert.throws(TypeError, () => port.write(target, next)); assert.compareArray(log, []);
    }
  }
  assert.sameValue(plain.amount, 3);
}
