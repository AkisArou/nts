/*---
description: Control for classes-shared-static-state; write out each class specialization.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-static, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-unions, ts-arrays, ts-type-aliases]
---*/
// Write four non-generic instance classes and retain one non-generic Tracked owner for the shared static counter.
type RoutePoint = { id: number };
class Tracked { static count: number = 0; }
class NumberTracked {
  value: number; ordinal: number;
  constructor(value: number) { this.value = value; this.ordinal = ++Tracked.count; }
}
class StringTracked {
  value: string; ordinal: number;
  constructor(value: string) { this.value = value; this.ordinal = ++Tracked.count; }
}
class PointTracked {
  value: RoutePoint; ordinal: number;
  constructor(value: RoutePoint) { this.value = value; this.ordinal = ++Tracked.count; }
}
class MaybeTracked {
  value: number | undefined; ordinal: number;
  constructor(value: number | undefined) { this.value = value; this.ordinal = ++Tracked.count; }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const numbers = [-0, NaN, 1.25];
for (let i = 0; i < numbers.length; i++) {
  const n = numbers[i], text = String(n), point = { id: n }, maybe: number | undefined = i % 2 ? undefined : n;
  const v0 = new NumberTracked(n); same(v0.value, n); same(v0.ordinal, i * 4 + 1);
  const v1 = new StringTracked(text); same(v1.value, text); same(v1.ordinal, i * 4 + 2);
  const v2 = new PointTracked(point); same(v2.value, point); same(v2.ordinal, i * 4 + 3);
  const v3 = new MaybeTracked(maybe); same(v3.value, maybe); same(v3.ordinal, i * 4 + 4);
  same(Tracked.count, (i + 1) * 4);
}
