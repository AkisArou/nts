/*---
description: A species constructor returning an existing array exposes concat destination and length behavior.
features: [ts-species-routes, ts-species-route-overrides, ts-class, ts-inheritance, ts-builtin-subclass, ts-arrays, ts-functions, ts-symbols, ts-objects, ts-unknown, ts-numbers, ts-typeof-operator, ts-new-target, ts-instanceof, ts-narrowing, ts-errors, ts-interfaces, ts-iteration]
---*/
// concat crosses an interface number[] field; node writes into the returned array, retaining old holes but truncating its final length.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = []; let destination: number[] = [];
class Source extends Array<number> { constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); } }
class Child extends Source {}
class Returner { constructor(length: number) { log.push("construct", new.target, arguments.length, length); return destination; } }
Object.defineProperty(Source, Symbol.species, { get() { log.push("species", this); return Returner; } });
interface Holder { values: number[]; }
function run(holder: Holder): unknown { return holder.values.concat([7]); }
for (const Ctor of [Source, Child]) {
  log.length = 0; destination = [90, 91, 92, 93, 94]; const source = new Ctor(3); source[0] = -0; source[2] = NaN;
  assert.compareArray(log, ["source", Ctor, 1, 3]); log.length = 0;
  const holder: Holder = { values: source }, result: unknown = run(holder);
  if (!Array.isArray(result)) throw new TypeError();
  same(result, destination); same(Object.getPrototypeOf(result), Array.prototype); same(Array.isArray(result), true); same(result === source, false);
  same(result instanceof Source, false); same(result instanceof Child, false); same(result instanceof Returner, false); same(result instanceof Array, true);
  same(result.length, 4); same(result[0], -0); same(result[1], 91); same(result[2], NaN); same(result[3], 7); same(Object.hasOwn(result, 4), false);
  assert.compareArray(Reflect.ownKeys(result), ["0", "1", "2", "3", "length"]);
  for (const index of [0, 2]) { const descriptor = Object.getOwnPropertyDescriptor(result, index); if (descriptor === undefined) throw new TypeError(); same(descriptor.writable, true); same(descriptor.enumerable, true); same(descriptor.configurable, true); }
  assert.compareArray(log, ["species", Ctor, "construct", Returner, 1, 0]);
  same(source.length, 3); same(source[0], -0); same(source[2], NaN); same(Object.hasOwn(source, 1), false);
  assert.compareArray(Reflect.ownKeys(source), ["0", "2", "length"]);
}
