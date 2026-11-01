/*---
description: Cell retains erased across coexisting class instantiations and replacement.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-numbers, ts-strings, ts-unions, ts-unknown, ts-null-undefined, ts-objects, ts-arrays, ts-tuples, ts-destructuring, ts-type-aliases, ts-accessors]
---*/
// Cell<T> uses RouteMixed, RouteMaybe, unknown, undefined together; node preserves each initial value, replacement and returned old value. The exchange goes through its getter and setter.
type RouteMixed = number | string;
type RouteMaybe = number | undefined;
class Cell<T> {
  private current: T; constructor(value: T) { this.current = value; }
  get value(): T { return this.current; }
  set value(next: T) { this.current = next; }
  replace(next: T): T { const old = this.value; this.value = next; return old; }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const rows: [RouteMixed, RouteMaybe, unknown][] = [[-0, undefined, null], [NaN, -0, { id: 7 }], ["text", NaN, [8, 9]]];
for (const [mixed, maybe, erased] of rows) {
  const nextMixed: RouteMixed = typeof mixed === "string" ? -0 : "next", nextMaybe: RouteMaybe = maybe === undefined ? NaN : undefined;
  const nextErased: unknown = { saved: erased };
  const v0 = new Cell<RouteMixed>(mixed), v1 = new Cell<RouteMaybe>(maybe);
  const v2 = new Cell<unknown>(erased), v3 = new Cell<undefined>(undefined);
  same(v0.value, mixed); same(v0.replace(nextMixed), mixed); same(v0.value, nextMixed);
  same(v1.value, maybe); same(v1.replace(nextMaybe), maybe); same(v1.value, nextMaybe);
  same(v2.value, erased); same(v2.replace(nextErased), erased); same(v2.value, nextErased);
  same(v3.value, undefined); same(v3.replace(undefined), undefined); same(v3.value, undefined);
}
