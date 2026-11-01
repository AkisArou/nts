/*---
description: Control for classes-derived-field-initializer; write out each class specialization.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-inheritance, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-unions, ts-type-aliases]
---*/
// Write out one non-generic class per type argument; preserve every input, operation and assertion.
type RoutePoint = { id: number };
class NumberSeed {
  seed: number; constructor(value: number) { this.seed = value; }
}
class NumberSnapshot extends NumberSeed { copy: number = this.seed; }
class StringSeed {
  seed: string; constructor(value: string) { this.seed = value; }
}
class StringSnapshot extends StringSeed { copy: string = this.seed; }
class PointSeed {
  seed: RoutePoint; constructor(value: RoutePoint) { this.seed = value; }
}
class PointSnapshot extends PointSeed { copy: RoutePoint = this.seed; }
class MaybeSeed {
  seed: number | undefined; constructor(value: number | undefined) { this.seed = value; }
}
class MaybeSnapshot extends MaybeSeed { copy: number | undefined = this.seed; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const text = String(n), point = { id: n }, nextPoint = { id: n + 1 }, maybe: number | undefined = Object.is(n, -0) ? undefined : n;
  const v0 = new NumberSnapshot(n); same(v0.seed, n); same(v0.copy, n);
  v0.seed = -0; same(v0.seed, -0); same(v0.copy, n);
  const v1 = new StringSnapshot(text); same(v1.seed, text); same(v1.copy, text);
  v1.seed = text + "!"; same(v1.seed, text + "!"); same(v1.copy, text);
  const v2 = new PointSnapshot(point); same(v2.seed, point); same(v2.copy, point);
  v2.seed = nextPoint; same(v2.seed, nextPoint); same(v2.copy, point);
  const v3 = new MaybeSnapshot(maybe); same(v3.seed, maybe); same(v3.copy, maybe);
  v3.seed = undefined; same(v3.seed, undefined); same(v3.copy, maybe);
}
