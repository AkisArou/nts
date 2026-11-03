/*---
description: A typed super postfix increment returns the old numeric value and sends its increment to the base setter once. The control resolves the home prototype explicitly.
features: [ts-super-routes, ts-super-route-properties, ts-class, ts-inheritance, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-this, ts-unknown, ts-typeof-operator, ts-accessors, ts-class-fields, ts-override, ts-tuples, ts-numbers, ts-expressions, ts-optional-chaining, ts-errors, ts-narrowing]
---*/
// super[key]++ crosses a Child-array element; node returns the old -0 or NaN and logs one key, getter and setter in that order. The control uses explicit reflection with the same receiver.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
function checkLog(expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
function keyOf(receiver: object, key: "slot"): "slot" { log.push("key", receiver, key); return key; }
class Base {
  raw: number = 0;
  get slot(): number { log.push("Base.get", this, this.raw); return this.raw; }
  set slot(value: number) { log.push("Base.set", this, value); this.raw = value; }
}
class Child extends Base {
  override get slot(): number { log.push("Child.get", this); return 100; }
  override set slot(value: number) { log.push("Child.set", this, value); }
  increment(key: "slot"): number { log.push("increment", this, key); const name = keyOf(this, key), old: unknown = Reflect.get(Base.prototype, name, this);
    if (typeof old !== "number") throw new TypeError("number");
    if (!Reflect.set(Base.prototype, name, old + 1, this)) throw new TypeError("set"); return old; }
}
class Further extends Child {}
class Sibling extends Child { override get slot(): number { log.push("Sibling.get", this); return 200; } }
const original: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(Base.prototype, "slot");
const inputs: [number, number][] = [[-0, 1], [0, 1], [-2, -1], [1.5, 2.5], [NaN, NaN], [Infinity, Infinity]];
for (const [initial, expected] of inputs) {
  const receivers: Child[] = [new Child(), new Further(), new Sibling()];
  for (const receiver of receivers) {
    receiver.raw = initial; log.length = 0; same(receiver.increment("slot"), initial); same(receiver.raw, expected);
    same(Object.hasOwn(receiver, "slot"), false); same(Object.hasOwn(receiver, "raw"), true); same(Object.hasOwn(Base.prototype, "raw"), false);
    same(Object.getOwnPropertyDescriptor(Base.prototype, "slot")?.get, original?.get); same(Object.getOwnPropertyDescriptor(Base.prototype, "slot")?.set, original?.set);
    checkLog(["increment", receiver, "slot", "key", receiver, "slot", "Base.get", receiver, initial, "Base.set", receiver, expected]);
  }
}
