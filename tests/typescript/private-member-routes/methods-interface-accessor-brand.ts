/*---
description: A private accessor has its own brand and rejects lookalikes before either getter or setter side effect runs.
features: [ts-private-member-routes, ts-private-member-route-methods, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-numbers, ts-accessors, ts-interfaces, ts-unsound-bivariance, ts-inheritance, ts-tuples, ts-this, ts-private-fields]
---*/
// AccessBrand instances cross a widened interface parameter; node preserves accessor results and throws before logging on an unbranded receiver.
const log: string[] = [];
class AccessBrand {
  amount: number = 3;
  get #current(): number { log.push("get"); return this.amount; }
  set #current(value: number) { log.push("set"); this.amount = value; }
  static owns(value: object): boolean { return #current in value; }
  static read(target: AccessBrand): number { return target.#current; }
  static write(target: AccessBrand, value: number): number { return target.#current = value; }
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
