/*---
description: A typed super nullish assignment skips its RHS and setter for every non-nullish value and preserves abrupt RHS completion. The control resolves the home prototype explicitly.
features: [ts-super-routes, ts-super-route-properties, ts-class, ts-inheritance, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-this, ts-unknown, ts-typeof-operator, ts-accessors, ts-class-fields, ts-interfaces, ts-override, ts-numbers, ts-symbols, ts-null-undefined, ts-expressions, ts-errors, ts-arrow-functions, ts-optional-chaining, ts-narrowing]
---*/
// super[key] ??= value crosses Holder.receiver; node fills only null and undefined, keeps falsy values, and propagates RangeError before any setter. The control uses explicit reflection with the same receiver.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
function checkLog(expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
function keyOf(receiver: object, key: "slot"): "slot" { log.push("key", receiver, key); return key; }
function valueOf(receiver: object, value: unknown, fail: boolean): unknown { log.push("value", receiver, value, fail); if (fail) throw new RangeError("rhs"); return value; }
class Base {
  raw: unknown = undefined;
  get slot(): unknown { log.push("Base.get", this, this.raw); return this.raw; }
  set slot(value: unknown) { log.push("Base.set", this, value); this.raw = value; }
}
class Child extends Base {
  override get slot(): unknown { log.push("Child.get", this); return "wrong"; }
  override set slot(value: unknown) { log.push("Child.set", this, value); }
  fill(key: "slot", value: unknown, fail: boolean): unknown { log.push("fill", this, key, value, fail); const name = keyOf(this, key), old: unknown = Reflect.get(Base.prototype, name, this);
    if (old !== null && old !== undefined) return old;
    const next = valueOf(this, value, fail); if (!Reflect.set(Base.prototype, name, next, this)) throw new TypeError("set"); return next; }
}
class Further extends Child {}
class Sibling extends Child { override get slot(): unknown { log.push("Sibling.get", this); return "sibling"; } }
interface Holder { receiver: Child; }
const original: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(Base.prototype, "slot");
const inputs: unknown[] = [undefined, null, false, 0, -0, NaN, "", { id: 12 }, Symbol("kept")], fallback = { id: 13 };
for (const initial of inputs) for (const fail of [false, true]) for (const instance of [new Child(), new Further(), new Sibling()]) {
  const holder: Holder = { receiver: instance }, receiver = holder.receiver, empty = initial === null || initial === undefined;
  receiver.raw = initial; log.length = 0;
  if (empty && fail) assert.throws(RangeError, () => receiver.fill("slot", fallback, fail));
  else same(receiver.fill("slot", fallback, fail), empty ? fallback : initial);
  same(receiver.raw, empty && !fail ? fallback : initial); same(Object.hasOwn(receiver, "slot"), false);
  same(Object.hasOwn(receiver, "raw"), true); same(Object.hasOwn(Base.prototype, "raw"), false);
  same(Object.getOwnPropertyDescriptor(Base.prototype, "slot")?.get, original?.get); same(Object.getOwnPropertyDescriptor(Base.prototype, "slot")?.set, original?.set);
  const expected: unknown[] = ["fill", receiver, "slot", fallback, fail, "key", receiver, "slot", "Base.get", receiver, initial];
  if (empty) expected.push("value", receiver, fallback, fail);
  if (empty && !fail) expected.push("Base.set", receiver, fallback);
  checkLog(expected);
}
