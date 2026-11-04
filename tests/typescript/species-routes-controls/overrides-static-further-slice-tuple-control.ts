/*---
description: A further-subclass species result survives a base-array tuple element for slice. The control explicitly constructs and defines the result.
features: [ts-species-routes, ts-species-route-overrides, ts-class, ts-inheritance, ts-builtin-subclass, ts-arrays, ts-functions, ts-symbols, ts-objects, ts-unknown, ts-numbers, ts-typeof-operator, ts-new-target, ts-instanceof, ts-narrowing, ts-errors, ts-class-fields, ts-tuples, ts-null-undefined]
---*/
// slice reads a number[] tuple element; node constructs the further output class with the slice length and retains a hole. The control follows constructor lookup and explicit writes.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function create(view: unknown[], length: number): object {
  let ctor: unknown = Reflect.get(view, "constructor");
  if ((typeof ctor === "object" && ctor !== null) || typeof ctor === "function") { ctor = Reflect.get(ctor, Symbol.species); if (ctor === null) ctor = undefined; }
  if (ctor === undefined) ctor = Array;
  if (typeof ctor !== "function") throw new TypeError();
  const result: unknown = Reflect.construct(ctor, [length]);
  if ((typeof result !== "object" || result === null) && typeof result !== "function") throw new TypeError();
  return result;
}
function put(target: object, index: number, value: unknown): void { Object.defineProperty(target, index, { value, writable: true, enumerable: true, configurable: true }); }
const log: unknown[] = [];
class Source extends Array<number> { constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); } }
class Other extends Array<number> {
  marker: number = 17;
  constructor(length: number) { super(length); log.push("other", new.target, arguments.length, length); }
}
class Further extends Other { extra: number = 23; }
class Sibling extends Other {}
Object.defineProperty(Source, Symbol.species, { get() { log.push("species", this); return Further; } });
function run(route: [number[]]): unknown {
  const view = route[0], output = create(view, 3);
  for (let i = 1; i < 4; i++) if (i in view) put(output, i - 1, view[i]);
  if (!Reflect.set(output, "length", 3)) throw new TypeError();
  return output;
}
const source = new Source(5); source[1] = -0; source[3] = NaN; source[4] = 9;
assert.compareArray(log, ["source", Source, 1, 5]); log.length = 0;
const route: [number[]] = [source], result: unknown = run(route);
if (!(result instanceof Further)) throw new TypeError();
same(Object.getPrototypeOf(result), Further.prototype); same(Array.isArray(result), true); same(result === source, false);
same(result instanceof Source, false); same(result instanceof Other, true); same(result instanceof Further, true); same(result instanceof Sibling, false); same(result instanceof Array, true);
same(result.length, 3); same(result[0], -0); same(result[2], NaN); same(Object.hasOwn(result, 1), false); same(result.marker, 17); same(result.extra, 23);
assert.compareArray(Reflect.ownKeys(result), ["0", "2", "length", "marker", "extra"]);
assert.compareArray(log, ["species", Source, "other", Further, 1, 3]);
same(source.length, 5); same(source[1], -0); same(source[3], NaN); same(source[4], 9); same(Object.hasOwn(source, 0), false); same(Object.hasOwn(source, 2), false);
assert.compareArray(Reflect.ownKeys(source), ["1", "3", "4", "length"]);
