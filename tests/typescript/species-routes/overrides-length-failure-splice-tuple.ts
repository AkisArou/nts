/*---
description: A getter-only destination length makes splice fail after copying but before receiver mutation.
features: [ts-species-routes, ts-species-route-overrides, ts-class, ts-inheritance, ts-builtin-subclass, ts-arrays, ts-functions, ts-symbols, ts-objects, ts-unknown, ts-numbers, ts-typeof-operator, ts-new-target, ts-instanceof, ts-narrowing, ts-errors, ts-tuples, ts-this-parameter, ts-iteration, ts-arrow-functions, ts-optional-chaining]
---*/
// splice crosses a number[] tuple element; node defines both removed values, then throws TypeError on length before changing the input.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [], destination: object = {};
function readLength(this: object): number { log.push("length-get", this); return 77; }
Object.defineProperty(destination, "length", { get: readLength, configurable: true });
class Source extends Array<number> { constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); } }
class Child extends Source {}
class Returner { constructor(length: number) { log.push("construct", new.target, arguments.length, length); return destination; } }
Object.defineProperty(Source, Symbol.species, { get() { log.push("species", this); return Returner; } });
function run(route: [number[]]): unknown { return route[0].splice(1, 2); }
const source = new Child(3); source[0] = 9; source[1] = -0; source[2] = NaN;
assert.compareArray(log, ["source", Child, 1, 3]); log.length = 0;
const route: [number[]] = [source]; assert.throws(TypeError, () => run(route));
assert.compareArray(log, ["species", Child, "construct", Returner, 1, 2]);
same(Object.getPrototypeOf(destination), Object.prototype); same(Array.isArray(destination), false);
same(destination instanceof Source, false); same(destination instanceof Child, false); same(destination instanceof Returner, false); same(destination instanceof Array, false);
same(Reflect.get(destination, 0), -0); same(Reflect.get(destination, 1), NaN); same(Object.hasOwn(destination, 2), false);
assert.compareArray(Reflect.ownKeys(destination), ["0", "1", "length"]);
for (const index of [0, 1]) { const descriptor = Object.getOwnPropertyDescriptor(destination, index); if (descriptor === undefined) throw new TypeError(); same(descriptor.writable, true); same(descriptor.enumerable, true); same(descriptor.configurable, true); }
same(Reflect.get(destination, "length"), 77); same(Object.getOwnPropertyDescriptor(destination, "length")?.get, readLength);
assert.compareArray(log, ["species", Child, "construct", Returner, 1, 2, "length-get", destination]);
same(source.length, 3); same(source[0], 9); same(source[1], -0); same(source[2], NaN);
assert.compareArray(Reflect.ownKeys(source), ["0", "1", "2", "length"]);
