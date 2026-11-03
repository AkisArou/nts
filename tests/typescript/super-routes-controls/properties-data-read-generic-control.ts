/*---
description: A generic receiver route reads base prototype data through super despite derived own fields. The control resolves the home prototype explicitly.
features: [ts-super-routes, ts-super-route-properties, ts-class, ts-inheritance, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-this, ts-unknown, ts-typeof-operator, ts-class-fields, ts-interfaces, ts-declaration-merging, ts-generics, ts-generic-constraints, ts-numbers, ts-symbols, ts-optional-chaining]
---*/
// super.slot crosses a constrained generic parameter; node returns prototype data and leaves the receiver own field at 91. The control uses explicit reflection with the same receiver.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
function checkLog(expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
interface Base { slot: unknown; }
class Base {}
class Child extends Base {
  slot: unknown = 91;
  read(): unknown { log.push("read", this); const value: unknown = Reflect.get(Base.prototype, "slot", this); return value; }
}
class Further extends Child {}
class Sibling extends Child {}
function read<T extends Child>(receiver: T): unknown { log.push("route", receiver); return receiver.read(); }
const inputs: unknown[] = [-0, NaN, 17, { id: 5 }, Symbol("prototype")];
for (const input of inputs) {
  Object.defineProperty(Base.prototype, "slot", { value: input, writable: true, configurable: true });
  for (const receiver of [new Child(), new Further(), new Sibling()]) {
    log.length = 0; same(read(receiver), input); same(receiver.slot, 91);
    same(Object.hasOwn(receiver, "slot"), true); same(Object.hasOwn(Base.prototype, "slot"), true);
    same(Base.prototype.slot, input); same(Object.getOwnPropertyDescriptor(Base.prototype, "slot")?.writable, true);
    same(Object.hasOwn(Child.prototype, "slot"), false); checkLog(["route", receiver, "read", receiver]);
  }
}
