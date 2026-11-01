/*---
description: "Private brand predicates distinguish related and unrelated layouts carried in an object array."
features: [ts-layout-routes, ts-layout-route-state, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-typeof-operator, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-class, ts-class-fields, ts-inheritance, ts-override, ts-private-fields, ts-static, ts-instanceof, ts-narrowing, ts-type-guards, ts-object-type]
---*/
// BrandBase, BrandChild and BrandOther each declare #x; object-typed array entries retain base, child and unrelated brands and their exact private payloads.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const values: unknown[] = [-0, NaN, 0n, "", undefined, null, { id: 7 }];
class BrandBase {
  kind: string = "base"; label: string = ""; #x: unknown;
  constructor(value: unknown) { this.#x = value; }
  static owns(value: object): value is BrandBase { return #x in value; }
  read(): unknown { return this.#x; } write(value: unknown): void { this.#x = value; }
}
class BrandChild extends BrandBase {
  override kind: string = "child"; count: number = -0; #x: unknown;
  constructor(value: unknown) { super(value); this.#x = value; }
  static ownsChild(value: object): value is BrandChild { return #x in value; } readChild(): unknown { return this.#x; }
}
class BrandOther {
  kind: string = "other"; token: bigint = 0n; #x: unknown;
  constructor(value: unknown) { this.#x = value; }
  static owns(value: object): value is BrandOther { return #x in value; }
  read(): unknown { return this.#x; } write(value: unknown): void { this.#x = value; }
}
for (let index = 0; index < values.length; index++) {
  const value = values[index], next = values[(index + 1) % values.length];
  const sources: object[] = [new BrandBase(value), new BrandChild(value), new BrandOther(value)];
  for (let slot = 0; slot < sources.length; slot++) {
    const view: object = sources[slot]; same(view, sources[slot]);
    same(BrandBase.owns(view), slot !== 2); same(BrandChild.ownsChild(view), slot === 1); same(BrandOther.owns(view), slot === 2);
    same(view instanceof BrandBase, slot !== 2); same(view instanceof BrandChild, slot === 1); same(view instanceof BrandOther, slot === 2);
    if (BrandBase.owns(view)) { same(view.kind, slot === 0 ? "base" : "child"); same(view.label, ""); same(view.read(), value); view.write(next); same(view.read(), next); }
    if (BrandChild.ownsChild(view)) { same(view.count, -0); same(view.readChild(), value); }
    if (BrandOther.owns(view)) { same(view.kind, "other"); same(view.token, 0n); same(view.read(), value); view.write(next); same(view.read(), next); }
  }
}
