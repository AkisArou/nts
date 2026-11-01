/*---
description: A base-class parameter retains subclass own fields while dropping both class prototypes.
features: [ts-structuredclone-route-classes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unknown, ts-class, ts-class-fields, ts-inheritance, ts-interfaces, ts-numbers, ts-optional-properties, ts-instanceof]
---*/
// A Base parameter carries base and subclass instances; node copies all own data including a nested subclass field into plain objects.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function fresh(actual: object, original: object, proto: object, keys: string[]): void {
  same(Object.is(actual, original), false); same(Object.getPrototypeOf(actual), proto); assert.compareArray(Object.keys(actual), keys);
}
class Base { value: number; constructor(n: number) { this.value = n; } method(): number { return this.value; } }
class Derived extends Base { extra: { n: number }; constructor(n: number) { super(n); this.extra = { n }; } other(): number { return 1; } }
interface BaseData { value: number; extra?: { n: number }; }
function copyBase(source: Base): BaseData { return structuredClone(source); }
for (const n of [-0, NaN, 7]) for (const derived of [false, true]) {
  const source: Base = derived ? new Derived(n) : new Base(n), result = copyBase(source);
  fresh(result, source, Object.prototype, derived ? ["value", "extra"] : ["value"]); same(result.value, n);
  same(result instanceof Base, false); same(result instanceof Derived, false); same("method" in result, false); same("other" in result, false);
  if (source instanceof Derived) {
    const child = result.extra; if (child === undefined) throw new Error("extra");
    fresh(child, source.extra, Object.prototype, ["n"]); same(child.n, n);
    child.n = 21; same(source.extra.n, n); source.extra.n = 32; same(child.n, 21);
  } else same(result.extra, undefined);
  result.value = 9; same(source.value, n); source.value = 11; same(result.value, 9);
}
