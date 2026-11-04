/*---
description: A frozen species destination permits an all-hole map but rejects its first element definition.
features: [ts-species-routes, ts-species-route-overrides, ts-class, ts-inheritance, ts-builtin-subclass, ts-arrays, ts-functions, ts-symbols, ts-objects, ts-unknown, ts-numbers, ts-typeof-operator, ts-new-target, ts-instanceof, ts-narrowing, ts-errors, ts-interfaces, ts-iteration, ts-readonly, ts-arrow-functions]
---*/
// map crosses an interface number[] field; node returns the frozen array for holes and throws TypeError at the first present element.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = []; let destination: readonly number[] = [];
class Source extends Array<number> { constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); } }
class Child extends Source {}
class Returner { constructor(length: number) { log.push("construct", new.target, arguments.length, length); return destination; } }
Object.defineProperty(Source, Symbol.species, { get() { log.push("species", this); return Returner; } });
interface Holder { values: number[]; }
function visit(value: number, index: number, view: number[]): number { log.push("map", value, index, view); return value; }
function run(holder: Holder): unknown { return holder.values.map(visit); }
for (const present of [false, true]) {
  log.length = 0; destination = Object.freeze([]); const source = new Child(3); if (present) source[1] = -0;
  assert.compareArray(log, ["source", Child, 1, 3]); log.length = 0;
  const holder: Holder = { values: source };
  if (present) assert.throws(TypeError, () => run(holder));
  else same(run(holder), destination);
  same(Object.getPrototypeOf(destination), Array.prototype); same(Array.isArray(destination), true); same(Object.isFrozen(destination), true);
  same(destination instanceof Source, false); same(destination instanceof Child, false); same(destination instanceof Returner, false); same(destination instanceof Array, true);
  same(destination.length, 0); assert.compareArray(Reflect.ownKeys(destination), ["length"]);
  assert.compareArray(log, present ? ["species", Child, "construct", Returner, 1, 3, "map", -0, 1, source] : ["species", Child, "construct", Returner, 1, 3]);
  same(source.length, 3); same(source[1], present ? -0 : undefined); same(Object.hasOwn(source, 0), false); same(Object.hasOwn(source, 2), false);
  assert.compareArray(Reflect.ownKeys(source), present ? ["1", "length"] : ["length"]);
}
