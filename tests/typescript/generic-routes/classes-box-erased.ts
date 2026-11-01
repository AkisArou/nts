/*---
description: Box retains erased across coexisting class instantiations and replacement.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-numbers, ts-strings, ts-unions, ts-unknown, ts-null-undefined, ts-objects, ts-arrays, ts-tuples, ts-destructuring, ts-type-aliases]
---*/
// Box<T> uses RouteMixed, RouteMaybe, unknown, undefined together; node preserves each initial value, replacement and returned old value.
type RouteMixed = number | string;
type RouteMaybe = number | undefined;
class Box<T> {
  private current: T; constructor(value: T) { this.current = value; }
  read(): T { return this.current; }
  replace(next: T): T { const old = this.current; this.current = next; return old; }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const rows: [RouteMixed, RouteMaybe, unknown][] = [[-0, undefined, null], [NaN, -0, { id: 7 }], ["text", NaN, [8, 9]]];
for (const [mixed, maybe, erased] of rows) {
  const nextMixed: RouteMixed = typeof mixed === "string" ? -0 : "next", nextMaybe: RouteMaybe = maybe === undefined ? NaN : undefined;
  const nextErased: unknown = { saved: erased };
  const v0 = new Box<RouteMixed>(mixed), v1 = new Box<RouteMaybe>(maybe);
  const v2 = new Box<unknown>(erased), v3 = new Box<undefined>(undefined);
  same(v0.read(), mixed); same(v0.replace(nextMixed), mixed); same(v0.read(), nextMixed);
  same(v1.read(), maybe); same(v1.replace(nextMaybe), maybe); same(v1.read(), nextMaybe);
  same(v2.read(), erased); same(v2.replace(nextErased), erased); same(v2.read(), nextErased);
  same(v3.read(), undefined); same(v3.replace(undefined), undefined); same(v3.read(), undefined);
}
