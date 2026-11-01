/*---
description: Control for classes-cell-erased; write out each class specialization.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-unions, ts-unknown, ts-null-undefined, ts-objects, ts-arrays, ts-tuples, ts-destructuring, ts-type-aliases, ts-accessors]
---*/
// Write out one non-generic class per type argument; preserve every input, operation and assertion.
type RouteMixed = number | string;
type RouteMaybe = number | undefined;
class MixedCell {
  private current: RouteMixed; constructor(value: RouteMixed) { this.current = value; }
  get value(): RouteMixed { return this.current; }
  set value(next: RouteMixed) { this.current = next; }
  replace(next: RouteMixed): RouteMixed { const old = this.value; this.value = next; return old; }
}
class MaybeCell {
  private current: RouteMaybe; constructor(value: RouteMaybe) { this.current = value; }
  get value(): RouteMaybe { return this.current; }
  set value(next: RouteMaybe) { this.current = next; }
  replace(next: RouteMaybe): RouteMaybe { const old = this.value; this.value = next; return old; }
}
class UnknownCell {
  private current: unknown; constructor(value: unknown) { this.current = value; }
  get value(): unknown { return this.current; }
  set value(next: unknown) { this.current = next; }
  replace(next: unknown): unknown { const old = this.value; this.value = next; return old; }
}
class UndefinedCell {
  private current: undefined; constructor(value: undefined) { this.current = value; }
  get value(): undefined { return this.current; }
  set value(next: undefined) { this.current = next; }
  replace(next: undefined): undefined { const old = this.value; this.value = next; return old; }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const rows: [RouteMixed, RouteMaybe, unknown][] = [[-0, undefined, null], [NaN, -0, { id: 7 }], ["text", NaN, [8, 9]]];
for (const [mixed, maybe, erased] of rows) {
  const nextMixed: RouteMixed = typeof mixed === "string" ? -0 : "next", nextMaybe: RouteMaybe = maybe === undefined ? NaN : undefined;
  const nextErased: unknown = { saved: erased };
  const v0 = new MixedCell(mixed), v1 = new MaybeCell(maybe);
  const v2 = new UnknownCell(erased), v3 = new UndefinedCell(undefined);
  same(v0.value, mixed); same(v0.replace(nextMixed), mixed); same(v0.value, nextMixed);
  same(v1.value, maybe); same(v1.replace(nextMaybe), maybe); same(v1.value, nextMaybe);
  same(v2.value, erased); same(v2.replace(nextErased), erased); same(v2.value, nextErased);
  same(v3.value, undefined); same(v3.replace(undefined), undefined); same(v3.value, undefined);
}
