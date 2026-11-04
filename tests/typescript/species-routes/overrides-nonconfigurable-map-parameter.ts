/*---
description: A nonconfigurable destination index stops map after its preceding definition.
features: [ts-species-routes, ts-species-route-overrides, ts-class, ts-inheritance, ts-builtin-subclass, ts-arrays, ts-functions, ts-symbols, ts-objects, ts-unknown, ts-numbers, ts-typeof-operator, ts-new-target, ts-instanceof, ts-narrowing, ts-errors, ts-iteration, ts-arrow-functions]
---*/
// map crosses a number[] parameter; node defines index zero, then throws TypeError on a writable but nonconfigurable index one.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [], destination: object = {};
Object.defineProperty(destination, 1, { value: 41, writable: true, enumerable: true, configurable: false });
class Source extends Array<number> { constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); } }
class Child extends Source {}
class Returner { constructor(length: number) { log.push("construct", new.target, arguments.length, length); return destination; } }
Object.defineProperty(Source, Symbol.species, { get() { log.push("species", this); return Returner; } });
function visit(value: number, index: number, view: number[]): number { log.push("map", value, index, view, Object.keys(destination).join(",")); return value; }
function run(view: number[]): unknown { return view.map(visit); }
const source = new Child(3); source[0] = -0; source[1] = NaN; source[2] = 7;
assert.compareArray(log, ["source", Child, 1, 3]); log.length = 0;
assert.throws(TypeError, () => run(source));
assert.compareArray(log, ["species", Child, "construct", Returner, 1, 3, "map", -0, 0, source, "1", "map", NaN, 1, source, "0,1"]);
same(Object.getPrototypeOf(destination), Object.prototype); same(Array.isArray(destination), false);
same(destination instanceof Source, false); same(destination instanceof Child, false); same(destination instanceof Returner, false); same(destination instanceof Array, false);
same(Reflect.get(destination, 0), -0); same(Reflect.get(destination, 1), 41); same(Object.hasOwn(destination, 2), false); same(Object.hasOwn(destination, "length"), false);
assert.compareArray(Reflect.ownKeys(destination), ["0", "1"]);
for (const index of [0, 1]) { const descriptor = Object.getOwnPropertyDescriptor(destination, index); if (descriptor === undefined) throw new TypeError(); same(descriptor.writable, true); same(descriptor.enumerable, true); same(descriptor.configurable, index === 0); }
same(source.length, 3); same(source[0], -0); same(source[1], NaN); same(source[2], 7);
assert.compareArray(Reflect.ownKeys(source), ["0", "1", "2", "length"]);
