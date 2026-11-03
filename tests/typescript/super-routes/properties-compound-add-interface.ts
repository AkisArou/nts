/*---
description: A typed super compound assignment evaluates its key once, gets before the RHS and returns the value sent to the base setter.
features: [ts-super-routes, ts-super-route-properties, ts-class, ts-inheritance, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-this, ts-unknown, ts-typeof-operator, ts-accessors, ts-class-fields, ts-interfaces, ts-override, ts-tuples, ts-numbers, ts-expressions, ts-optional-chaining]
---*/
// super[key] += value crosses an Adder variable; node logs key, get, RHS and set in order and retains exact signed-zero and NaN results.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
function checkLog(expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
function keyOf(receiver: object, key: "slot"): "slot" { log.push("key", receiver, key); return key; }
function valueOf(receiver: object, value: number): number { log.push("value", receiver, value); return value; }
class Base {
  raw: number = 0;
  get slot(): number { log.push("Base.get", this, this.raw); return this.raw; }
  set slot(value: number) { log.push("Base.set", this, value); this.raw = value; }
}
class Child extends Base {
  override get slot(): number { log.push("Child.get", this); return 100; }
  override set slot(value: number) { log.push("Child.set", this, value); }
  add(key: "slot", value: number): number { log.push("add", this, key, value); return super[keyOf(this, key)] += valueOf(this, value); }
}
class Further extends Child {}
class Sibling extends Child { override get slot(): number { log.push("Sibling.get", this); return 200; } }
interface Adder { raw: number; add(key: "slot", value: number): number; }
const original: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(Base.prototype, "slot");
const inputs: [number, number, number][] = [[-0, -0, -0], [0, -0, 0], [-2, 5, 3], [NaN, 2, NaN], [-3.5, 1.25, -2.25]];
for (const [initial, value, expected] of inputs) for (const instance of [new Child(), new Further(), new Sibling()]) {
  const receiver: Adder = instance; receiver.raw = initial; log.length = 0;
  same(receiver.add("slot", value), expected); same(receiver.raw, expected); same(Object.hasOwn(receiver, "slot"), false);
  same(Object.hasOwn(receiver, "raw"), true); same(Object.hasOwn(Base.prototype, "raw"), false);
  same(Object.getOwnPropertyDescriptor(Base.prototype, "slot")?.get, original?.get); same(Object.getOwnPropertyDescriptor(Base.prototype, "slot")?.set, original?.set);
  checkLog(["add", receiver, "slot", value, "key", receiver, "slot", "Base.get", receiver, initial, "value", receiver, value, "Base.set", receiver, expected]);
}
