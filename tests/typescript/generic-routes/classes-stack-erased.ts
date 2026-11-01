/*---
description: Stack retains erased across coexisting class instantiations and replacement.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-numbers, ts-strings, ts-unions, ts-unknown, ts-null-undefined, ts-objects, ts-arrays, ts-tuples, ts-destructuring, ts-type-aliases]
---*/
// Stack<T> uses RouteMixed, RouteMaybe, unknown, undefined together; node preserves each initial value, replacement and returned old value. Draining returns the replacement, then undefined.
type RouteMixed = number | string;
type RouteMaybe = number | undefined;
class Stack<T> {
  private items: T[] = []; constructor(value: T) { this.items.push(value); }
  read(): T | undefined { return this.items[this.items.length - 1]; }
  replace(next: T): T | undefined { const old = this.items.pop(); this.items.push(next); return old; }
  pop(): T | undefined { return this.items.pop(); }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const rows: [RouteMixed, RouteMaybe, unknown][] = [[-0, undefined, null], [NaN, -0, { id: 7 }], ["text", NaN, [8, 9]]];
for (const [mixed, maybe, erased] of rows) {
  const nextMixed: RouteMixed = typeof mixed === "string" ? -0 : "next", nextMaybe: RouteMaybe = maybe === undefined ? NaN : undefined;
  const nextErased: unknown = { saved: erased };
  const v0 = new Stack<RouteMixed>(mixed), v1 = new Stack<RouteMaybe>(maybe);
  const v2 = new Stack<unknown>(erased), v3 = new Stack<undefined>(undefined);
  same(v0.read(), mixed); same(v0.replace(nextMixed), mixed); same(v0.read(), nextMixed);
  same(v0.pop(), nextMixed); same(v0.pop(), undefined);
  same(v1.read(), maybe); same(v1.replace(nextMaybe), maybe); same(v1.read(), nextMaybe);
  same(v1.pop(), nextMaybe); same(v1.pop(), undefined);
  same(v2.read(), erased); same(v2.replace(nextErased), erased); same(v2.read(), nextErased);
  same(v2.pop(), nextErased); same(v2.pop(), undefined);
  same(v3.read(), undefined); same(v3.replace(undefined), undefined); same(v3.read(), undefined);
  same(v3.pop(), undefined); same(v3.pop(), undefined);
}
