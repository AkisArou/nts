/*---
description: A generic super write to a missing prototype property uses receiver extensibility and existing own data.
features: [ts-super-routes, ts-super-route-properties, ts-class, ts-inheritance, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-this, ts-unknown, ts-typeof-operator, ts-interfaces, ts-declaration-merging, ts-optional-properties, ts-class-fields, ts-tuples, ts-unions, ts-generics, ts-generic-constraints, ts-numbers, ts-errors, ts-arrow-functions, ts-optional-chaining]
---*/
// super.slot = value crosses a constrained generic parameter; node creates or updates own data and refuses a new property on a non-extensible receiver.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
function checkLog(expected: unknown[]): void { assert.compareArray(log, expected); for (let i = 0; i < log.length; i++) same(log[i], expected[i]); }
interface Base { slot?: number; }
class Base {}
class Child extends Base { write(value: number): number { log.push("write", this, value); return super.slot = value; } }
class Further extends Child { slot: number = 41; }
class Sibling extends Child { label: string = "sibling"; }
function write<T extends Child>(receiver: T, value: number): number { log.push("route", receiver, value); return receiver.write(value); }
for (const extensible of [true, false]) for (const input of [-0, NaN, 43]) {
  const routes: [Child, number | undefined][] = [[new Child(), undefined], [new Further(), 41], [new Sibling(), undefined]];
  for (const [receiver, initial] of routes) {
    if (!extensible) Object.preventExtensions(receiver);
    const allowed = extensible || initial !== undefined; log.length = 0;
    if (allowed) same(write(receiver, input), input); else assert.throws(TypeError, () => write(receiver, input));
    same(receiver.slot, allowed ? input : undefined); same(Object.hasOwn(receiver, "slot"), allowed);
    const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(receiver, "slot");
    same(descriptor?.value, allowed ? input : undefined); same(descriptor?.writable, allowed ? true : undefined);
    same(descriptor?.enumerable, allowed ? true : undefined); same(descriptor?.configurable, allowed ? true : undefined);
    same(Object.hasOwn(Base.prototype, "slot"), false); same(Object.hasOwn(Child.prototype, "slot"), false);
    same(Base.prototype.slot, undefined); same(Object.isExtensible(receiver), extensible);
    checkLog(["route", receiver, input, "write", receiver, input]);
  }
}
