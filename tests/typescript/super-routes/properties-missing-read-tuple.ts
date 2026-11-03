/*---
description: A tuple-carried receiver reads undefined from a missing super property despite an own numeric field.
features: [ts-super-routes, ts-super-route-properties, ts-class, ts-inheritance, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-this, ts-unknown, ts-typeof-operator, ts-interfaces, ts-declaration-merging, ts-optional-properties, ts-class-fields, ts-tuples, ts-numbers, ts-null-undefined]
---*/
// super.slot crosses a one-element typed tuple; node returns undefined while the receiver own slot retains every numeric payload.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
function checkLog(expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
interface Base { slot?: number; }
class Base {}
class Child extends Base {
  slot: number = 91;
  read(): unknown { log.push("read", this); return super.slot; }
}
class Further extends Child {}
class Sibling extends Child {}
for (const input of [-0, NaN, 29]) for (const instance of [new Child(), new Further(), new Sibling()]) {
  const route: [Child] = [instance], receiver = route[0]; receiver.slot = input; log.length = 0;
  same(receiver.read(), undefined); same(receiver.slot, input); same(Object.hasOwn(receiver, "slot"), true);
  same(Object.hasOwn(Base.prototype, "slot"), false); same(Object.hasOwn(Child.prototype, "slot"), false);
  same(Base.prototype.slot, undefined); checkLog(["read", receiver]);
}
