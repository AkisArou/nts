/*---
description: A writer stored in an interface field sends super assignment to the base setter with the derived receiver. The control resolves the home prototype explicitly.
features: [ts-super-routes, ts-super-route-properties, ts-class, ts-inheritance, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-this, ts-unknown, ts-typeof-operator, ts-accessors, ts-class-fields, ts-interfaces, ts-override, ts-numbers, ts-symbols, ts-optional-chaining, ts-errors]
---*/
// super.slot = value crosses Holder.receiver; node returns the RHS, calls only the base setter and changes only receiver storage. The control uses explicit reflection with the same receiver.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
function checkLog(expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
class Base {
  raw: unknown = undefined;
  set slot(value: unknown) { log.push("Base.set", this, value); this.raw = value; }
}
class Child extends Base {
  override set slot(value: unknown) { log.push("Child.set", this, value); }
  write(value: unknown): unknown { log.push("write", this, value); if (!Reflect.set(Base.prototype, "slot", value, this)) throw new TypeError("set"); return value; }
}
class Further extends Child {}
class Sibling extends Child { override set slot(value: unknown) { log.push("Sibling.set", this, value); } }
interface Writer { raw: unknown; write(value: unknown): unknown; }
interface Holder { receiver: Writer; }
const setter: unknown = Object.getOwnPropertyDescriptor(Base.prototype, "slot")?.set;
const inputs: unknown[] = [-0, NaN, 31, false, "", { id: 7 }, Symbol("write")];
for (const input of inputs) for (const instance of [new Child(), new Further(), new Sibling()]) {
  const holder: Holder = { receiver: instance }, receiver = holder.receiver; log.length = 0;
  same(receiver.write(input), input); same(receiver.raw, input);
  same(Object.hasOwn(receiver, "raw"), true); same(Object.hasOwn(receiver, "slot"), false);
  same(Object.hasOwn(Base.prototype, "raw"), false); same(Object.getOwnPropertyDescriptor(Base.prototype, "slot")?.set, setter);
  same(Object.getOwnPropertyDescriptor(Base.prototype, "slot")?.get, undefined);
  checkLog(["write", receiver, input, "Base.set", receiver, input]);
}
