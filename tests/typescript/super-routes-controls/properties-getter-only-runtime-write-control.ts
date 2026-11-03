/*---
description: Removing a base setter makes a typed super assignment throw without calling the getter or creating receiver data. The control resolves the home prototype explicitly.
features: [ts-super-routes, ts-super-route-properties, ts-class, ts-inheritance, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-this, ts-unknown, ts-typeof-operator, ts-accessors, ts-class-fields, ts-interfaces, ts-numbers, ts-errors, ts-arrow-functions, ts-optional-chaining]
---*/
// super.slot = value crosses a Writer parameter; node calls the original setter while present, then throws TypeError when its descriptor has no setter. The control uses explicit reflection with the same receiver.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
function checkLog(expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
class Base {
  raw: unknown = "initial";
  get slot(): unknown { log.push("Base.get", this, this.raw); return this.raw; }
  set slot(value: unknown) { log.push("Base.set", this, value); this.raw = value; }
}
class Child extends Base { write(value: unknown): unknown { log.push("write", this, value); if (!Reflect.set(Base.prototype, "slot", value, this)) throw new TypeError("set"); return value; } }
class Further extends Child {}
class Sibling extends Child {}
interface Writer { raw: unknown; write(value: unknown): unknown; }
function write(receiver: Writer, value: unknown): unknown { log.push("route", receiver, value); return receiver.write(value); }
const original: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(Base.prototype, "slot");
if (original === undefined) throw new Error("descriptor");
const inputs: unknown[] = [-0, NaN, { id: 8 }];
for (const present of [true, false]) for (const input of inputs) {
  Object.defineProperty(Base.prototype, "slot", { set: present ? original.set : undefined });
  for (const receiver of [new Child(), new Further(), new Sibling()]) {
    log.length = 0;
    if (present) same(write(receiver, input), input); else assert.throws(TypeError, () => write(receiver, input));
    same(receiver.raw, present ? input : "initial"); same(Object.hasOwn(receiver, "raw"), true); same(Object.hasOwn(receiver, "slot"), false);
    const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(Base.prototype, "slot");
    same(descriptor?.get, original.get); same(descriptor?.set, present ? original.set : undefined);
    same(descriptor?.value, undefined); same(Object.hasOwn(Base.prototype, "raw"), false);
    const expected: unknown[] = ["route", receiver, input, "write", receiver, input];
    if (present) expected.push("Base.set", receiver, input);
    checkLog(expected);
  }
}
