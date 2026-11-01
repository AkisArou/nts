/*---
description: A derived generic field initializes from its T-valued base field before later writes.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-inheritance, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-unions, ts-type-aliases]
---*/
// Snapshot<T>.copy initializes from Seed<T>.seed for number, string, point and optional inputs; node preserves the initial copy after seed changes.
type RoutePoint = { id: number };
class Seed<T> {
  seed: T; constructor(value: T) { this.seed = value; }
}
class Snapshot<T> extends Seed<T> { copy: T = this.seed; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const text = String(n), point = { id: n }, nextPoint = { id: n + 1 }, maybe: number | undefined = Object.is(n, -0) ? undefined : n;
  const v0 = new Snapshot<number>(n); same(v0.seed, n); same(v0.copy, n);
  v0.seed = -0; same(v0.seed, -0); same(v0.copy, n);
  const v1 = new Snapshot<string>(text); same(v1.seed, text); same(v1.copy, text);
  v1.seed = text + "!"; same(v1.seed, text + "!"); same(v1.copy, text);
  const v2 = new Snapshot<RoutePoint>(point); same(v2.seed, point); same(v2.copy, point);
  v2.seed = nextPoint; same(v2.seed, nextPoint); same(v2.copy, point);
  const v3 = new Snapshot<number | undefined>(maybe); same(v3.seed, maybe); same(v3.copy, maybe);
  v3.seed = undefined; same(v3.seed, undefined); same(v3.copy, maybe);
}
