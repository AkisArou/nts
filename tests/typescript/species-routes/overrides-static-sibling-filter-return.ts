/*---
description: A species getter selecting another subclass survives a generic base-array return for filter.
features: [ts-species-routes, ts-species-route-overrides, ts-class, ts-inheritance, ts-builtin-subclass, ts-arrays, ts-functions, ts-symbols, ts-objects, ts-unknown, ts-numbers, ts-typeof-operator, ts-new-target, ts-instanceof, ts-narrowing, ts-errors, ts-class-fields, ts-generics, ts-generic-constraints, ts-iteration]
---*/
// filter receives a generic helper return typed number[]; node constructs the selected sibling once with 0 and compacts selected values.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
class Source extends Array<number> { constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); } }
class SourceChild extends Source {}
class Other extends Array<number> {
  marker: number = 17;
  constructor(length: number) { super(length); log.push("other", new.target, arguments.length, length); }
}
class OtherChild extends Other {}
Object.defineProperty(Source, Symbol.species, { get() { log.push("species", this); return Other; } });
function carry<T extends number[]>(view: T): number[] { return view; }
function visit(value: number, index: number, view: number[]): boolean { log.push("filter", value, index, view); return index !== 3; }
for (const Ctor of [Source, SourceChild]) {
  log.length = 0; const source = new Ctor(4); source[0] = -0; source[2] = NaN; source[3] = 7;
  assert.compareArray(log, ["source", Ctor, 1, 4]); log.length = 0;
  const result: unknown = carry(source).filter(visit);
  if (!(result instanceof Other)) throw new TypeError();
  same(Object.getPrototypeOf(result), Other.prototype); same(Array.isArray(result), true); same(result === source, false);
  same(result instanceof Source, false); same(result instanceof SourceChild, false); same(result instanceof Other, true); same(result instanceof OtherChild, false); same(result instanceof Array, true);
  same(result.length, 2); same(result[0], -0); same(result[1], NaN); same(result.marker, 17);
  assert.compareArray(Reflect.ownKeys(result), ["0", "1", "length", "marker"]);
  assert.compareArray(log, ["species", Ctor, "other", Other, 1, 0, "filter", -0, 0, source, "filter", NaN, 2, source, "filter", 7, 3, source]);
  same(source.length, 4); same(source[0], -0); same(source[2], NaN); same(source[3], 7); same(Object.hasOwn(source, 1), false);
  assert.compareArray(Reflect.ownKeys(source), ["0", "2", "3", "length"]);
}
