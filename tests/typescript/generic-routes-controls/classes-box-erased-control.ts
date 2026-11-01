/*---
description: Control for classes-box-erased; write out each class specialization.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-unions, ts-unknown, ts-null-undefined, ts-objects, ts-arrays, ts-tuples, ts-destructuring, ts-type-aliases]
---*/
// Write out one non-generic class per type argument; preserve every input, operation and assertion.
type RouteMixed = number | string;
type RouteMaybe = number | undefined;
class MixedBox {
  private current: RouteMixed; constructor(value: RouteMixed) { this.current = value; }
  read(): RouteMixed { return this.current; }
  replace(next: RouteMixed): RouteMixed { const old = this.current; this.current = next; return old; }
}
class MaybeBox {
  private current: RouteMaybe; constructor(value: RouteMaybe) { this.current = value; }
  read(): RouteMaybe { return this.current; }
  replace(next: RouteMaybe): RouteMaybe { const old = this.current; this.current = next; return old; }
}
class UnknownBox {
  private current: unknown; constructor(value: unknown) { this.current = value; }
  read(): unknown { return this.current; }
  replace(next: unknown): unknown { const old = this.current; this.current = next; return old; }
}
class UndefinedBox {
  private current: undefined; constructor(value: undefined) { this.current = value; }
  read(): undefined { return this.current; }
  replace(next: undefined): undefined { const old = this.current; this.current = next; return old; }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const rows: [RouteMixed, RouteMaybe, unknown][] = [[-0, undefined, null], [NaN, -0, { id: 7 }], ["text", NaN, [8, 9]]];
for (const [mixed, maybe, erased] of rows) {
  const nextMixed: RouteMixed = typeof mixed === "string" ? -0 : "next", nextMaybe: RouteMaybe = maybe === undefined ? NaN : undefined;
  const nextErased: unknown = { saved: erased };
  const v0 = new MixedBox(mixed), v1 = new MaybeBox(maybe);
  const v2 = new UnknownBox(erased), v3 = new UndefinedBox(undefined);
  same(v0.read(), mixed); same(v0.replace(nextMixed), mixed); same(v0.read(), nextMixed);
  same(v1.read(), maybe); same(v1.replace(nextMaybe), maybe); same(v1.read(), nextMaybe);
  same(v2.read(), erased); same(v2.replace(nextErased), erased); same(v2.read(), nextErased);
  same(v3.read(), undefined); same(v3.replace(undefined), undefined); same(v3.read(), undefined);
}
