/*---
description: A tuple-carried super data write creates or updates the receiver property and rejects a non-writable base descriptor.
features: [ts-super-routes, ts-super-route-properties, ts-class, ts-inheritance, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-this, ts-unknown, ts-typeof-operator, ts-interfaces, ts-declaration-merging, ts-class-fields, ts-tuples, ts-unions, ts-numbers, ts-errors, ts-arrow-functions, ts-optional-chaining]
---*/
// super.slot = value crosses a typed tuple element; node changes only writable receiver data and throws TypeError for a non-writable base.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
function checkLog(expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
interface Base { slot: number; }
class Base {}
class Child extends Base { write(value: number): number { log.push("write", this, value); return super.slot = value; } }
class Further extends Child { slot: number = 31; }
class Sibling extends Child { slot: number = 47; }
for (const writable of [true, false]) for (const input of [-0, NaN, 37]) {
  Object.defineProperty(Base.prototype, "slot", { value: 13, writable, configurable: true });
  const routes: [Child, number | undefined][] = [[new Child(), undefined], [new Further(), 31], [new Sibling(), 47]];
  for (const [receiver, initial] of routes) {
    log.length = 0;
    if (writable) same(receiver.write(input), input); else assert.throws(TypeError, () => receiver.write(input));
    const own = writable || initial !== undefined, expected = writable ? input : initial === undefined ? 13 : initial;
    same(receiver.slot, expected); same(Object.hasOwn(receiver, "slot"), own);
    const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(receiver, "slot");
    same(descriptor?.value, own ? expected : undefined); same(descriptor?.writable, own ? true : undefined);
    same(descriptor?.enumerable, own ? true : undefined); same(descriptor?.configurable, own ? true : undefined);
    same(Base.prototype.slot, 13); same(Object.hasOwn(Base.prototype, "slot"), true);
    same(Object.getOwnPropertyDescriptor(Base.prototype, "slot")?.writable, writable);
    same(Object.getOwnPropertyDescriptor(Base.prototype, "slot")?.set, undefined);
    checkLog(["write", receiver, input]);
  }
}
