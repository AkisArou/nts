/*---
description: A private compound assignment gets once, sets once and returns the assigned value before setter transformation.
features: [ts-private-member-routes, ts-private-member-route-methods, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-numbers, ts-accessors, ts-interfaces, ts-inheritance, ts-this, ts-private-fields]
---*/
// AccessOwner instances cross a Holder.port interface field; node logs getter then setter and retains the transformed private value.
const log: string[] = [];
class AccessOwner {
  #value: number;
  constructor(value: number) { this.#value = value; }
  get #current(): number { log.push("get:" + this.#value); return this.#value; }
  set #current(value: number) { log.push("set:" + value); this.#value = value * 2; }
  bump(step: number): number { return this.#current += step; }
  read(): number { return this.#current; }
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
