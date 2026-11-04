/*---
description: Nonconstructor species values fail before map callbacks through a base-array parameter.
features: [ts-species-routes, ts-species-route-overrides, ts-class, ts-inheritance, ts-builtin-subclass, ts-arrays, ts-functions, ts-symbols, ts-objects, ts-unknown, ts-numbers, ts-typeof-operator, ts-new-target, ts-instanceof, ts-narrowing, ts-errors, ts-iteration, ts-arrow-functions, ts-bigint]
---*/
// map crosses a number[] parameter; node rejects arrow, object and primitive species without invoking them or touching the receiver.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = []; let selected: unknown;
class Source extends Array<number> { constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); } }
class Child extends Source {}
class Sibling extends Array<number> {}
Object.defineProperty(Source, Symbol.species, { get() { log.push("species", this); return selected; } });
const arrow = () => { log.push("arrow-called"); return []; };
function visit(value: number, index: number, view: number[]): number { log.push("map", value, index, view); return value; }
function run(view: number[]): unknown { return view.map(visit); }
for (const choice of [arrow, {}, 0, false, "x", 1n, Symbol("x"), Array]) {
  selected = choice; log.length = 0; const source = new Child(3); source[0] = -0; source[2] = NaN;
  assert.compareArray(log, ["source", Child, 1, 3]); log.length = 0;
  if (choice !== Array) assert.throws(TypeError, () => run(source));
  else {
    const result: unknown = run(source); if (!Array.isArray(result)) throw new TypeError();
    same(Object.getPrototypeOf(result), Array.prototype); same(Array.isArray(result), true); same(result === source, false);
    same(result instanceof Source, false); same(result instanceof Child, false); same(result instanceof Sibling, false); same(result instanceof Array, true);
    same(result.length, 3); same(result[0], -0); same(result[2], NaN); same(Object.hasOwn(result, 1), false);
    assert.compareArray(Reflect.ownKeys(result), ["0", "2", "length"]);
  }
  assert.compareArray(log, choice === Array ? ["species", Child, "map", -0, 0, source, "map", NaN, 2, source] : ["species", Child]);
  same(source.length, 3); same(source[0], -0); same(source[2], NaN); same(Object.hasOwn(source, 1), false);
  assert.compareArray(Reflect.ownKeys(source), ["0", "2", "length"]);
}
