/*---
description: Control for classes-stack-erased; write out each class specialization.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-unions, ts-unknown, ts-null-undefined, ts-objects, ts-arrays, ts-tuples, ts-destructuring, ts-type-aliases]
---*/
// Write out one non-generic class per type argument; preserve every input, operation and assertion.
type RouteMixed = number | string;
type RouteMaybe = number | undefined;
class MixedStack {
  private items: RouteMixed[] = []; constructor(value: RouteMixed) { this.items.push(value); }
  read(): RouteMixed | undefined { return this.items[this.items.length - 1]; }
  replace(next: RouteMixed): RouteMixed | undefined { const old = this.items.pop(); this.items.push(next); return old; }
  pop(): RouteMixed | undefined { return this.items.pop(); }
}
class MaybeStack {
  private items: RouteMaybe[] = []; constructor(value: RouteMaybe) { this.items.push(value); }
  read(): RouteMaybe | undefined { return this.items[this.items.length - 1]; }
  replace(next: RouteMaybe): RouteMaybe | undefined { const old = this.items.pop(); this.items.push(next); return old; }
  pop(): RouteMaybe | undefined { return this.items.pop(); }
}
class UnknownStack {
  private items: unknown[] = []; constructor(value: unknown) { this.items.push(value); }
  read(): unknown | undefined { return this.items[this.items.length - 1]; }
  replace(next: unknown): unknown | undefined { const old = this.items.pop(); this.items.push(next); return old; }
  pop(): unknown | undefined { return this.items.pop(); }
}
class UndefinedStack {
  private items: undefined[] = []; constructor(value: undefined) { this.items.push(value); }
  read(): undefined | undefined { return this.items[this.items.length - 1]; }
  replace(next: undefined): undefined | undefined { const old = this.items.pop(); this.items.push(next); return old; }
  pop(): undefined | undefined { return this.items.pop(); }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const rows: [RouteMixed, RouteMaybe, unknown][] = [[-0, undefined, null], [NaN, -0, { id: 7 }], ["text", NaN, [8, 9]]];
for (const [mixed, maybe, erased] of rows) {
  const nextMixed: RouteMixed = typeof mixed === "string" ? -0 : "next", nextMaybe: RouteMaybe = maybe === undefined ? NaN : undefined;
  const nextErased: unknown = { saved: erased };
  const v0 = new MixedStack(mixed), v1 = new MaybeStack(maybe);
  const v2 = new UnknownStack(erased), v3 = new UndefinedStack(undefined);
  same(v0.read(), mixed); same(v0.replace(nextMixed), mixed); same(v0.read(), nextMixed);
  same(v0.pop(), nextMixed); same(v0.pop(), undefined);
  same(v1.read(), maybe); same(v1.replace(nextMaybe), maybe); same(v1.read(), nextMaybe);
  same(v1.pop(), nextMaybe); same(v1.pop(), undefined);
  same(v2.read(), erased); same(v2.replace(nextErased), erased); same(v2.read(), nextErased);
  same(v2.pop(), nextErased); same(v2.pop(), undefined);
  same(v3.read(), undefined); same(v3.replace(undefined), undefined); same(v3.read(), undefined);
  same(v3.pop(), undefined); same(v3.pop(), undefined);
}
