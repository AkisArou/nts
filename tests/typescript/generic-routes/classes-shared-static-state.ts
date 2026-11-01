/*---
description: All generic class instantiations share one static construction counter.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-static, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-unions, ts-arrays, ts-type-aliases]
---*/
// Tracked<number/string/point/optional> stores T and increments one static member; node assigns consecutive ordinals across all four copies.
type RoutePoint = { id: number };
class Tracked<T> {
  static count: number = 0;
  value: T; ordinal: number;
  constructor(value: T) { this.value = value; this.ordinal = ++Tracked.count; }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const numbers = [-0, NaN, 1.25];
for (let i = 0; i < numbers.length; i++) {
  const n = numbers[i], text = String(n), point = { id: n }, maybe: number | undefined = i % 2 ? undefined : n;
  const v0 = new Tracked<number>(n); same(v0.value, n); same(v0.ordinal, i * 4 + 1);
  const v1 = new Tracked<string>(text); same(v1.value, text); same(v1.ordinal, i * 4 + 2);
  const v2 = new Tracked<RoutePoint>(point); same(v2.value, point); same(v2.ordinal, i * 4 + 3);
  const v3 = new Tracked<number | undefined>(maybe); same(v3.value, maybe); same(v3.ordinal, i * 4 + 4);
  same(Tracked.count, (i + 1) * 4);
}
