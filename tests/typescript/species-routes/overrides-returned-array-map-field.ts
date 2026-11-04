/*---
description: A species constructor returning an existing array exposes map destination and length behavior.
features: [ts-species-routes, ts-species-route-overrides, ts-class, ts-inheritance, ts-builtin-subclass, ts-arrays, ts-functions, ts-symbols, ts-objects, ts-unknown, ts-numbers, ts-typeof-operator, ts-new-target, ts-instanceof, ts-narrowing, ts-errors, ts-interfaces, ts-iteration]
---*/
// map crosses an interface number[] field; node writes into the returned array, retaining old holes and tail length.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = []; let destination: number[] = [];
class Source extends Array<number> { constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); } }
class Child extends Source {}
class Returner { constructor(length: number) { log.push("construct", new.target, arguments.length, length); return destination; } }
Object.defineProperty(Source, Symbol.species, { get() { log.push("species", this); return Returner; } });
interface Holder { values: number[]; }
function visit(value: number, index: number, view: number[]): number { log.push("map", value, index, view); return value; }
function run(holder: Holder): unknown { return holder.values.map(visit); }
for (const Ctor of [Source, Child]) {
  log.length = 0; destination = [90, 91, 92, 93, 94]; const source = new Ctor(3); source[0] = -0; source[2] = NaN;
  assert.compareArray(log, ["source", Ctor, 1, 3]); log.length = 0;
  const holder: Holder = { values: source }, result: unknown = run(holder);
  if (!Array.isArray(result)) throw new TypeError();
  same(result, destination); same(Object.getPrototypeOf(result), Array.prototype); same(Array.isArray(result), true); same(result === source, false);
  same(result instanceof Source, false); same(result instanceof Child, false); same(result instanceof Returner, false); same(result instanceof Array, true);
  same(result.length, 5); same(result[0], -0); same(result[1], 91); same(result[2], NaN); same(result[3], 93); same(result[4], 94);
  assert.compareArray(Reflect.ownKeys(result), ["0", "1", "2", "3", "4", "length"]);
  for (const index of [0, 2]) { const descriptor = Object.getOwnPropertyDescriptor(result, index); if (descriptor === undefined) throw new TypeError(); same(descriptor.writable, true); same(descriptor.enumerable, true); same(descriptor.configurable, true); }
  assert.compareArray(log, ["species", Ctor, "construct", Returner, 1, 3, "map", -0, 0, source, "map", NaN, 2, source]);
  same(source.length, 3); same(source[0], -0); same(source[2], NaN); same(Object.hasOwn(source, 1), false);
  assert.compareArray(Reflect.ownKeys(source), ["0", "2", "length"]);
}
