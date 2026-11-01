/*---
description: A static method independently instantiates the generic class at four representations.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-static, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-unions, ts-type-aliases]
---*/
// FactoryBox.of<U> constructs FactoryBox<U> for number, string, point and optional values; node keeps the exact stored inputs.
type RoutePoint = { id: number };
class FactoryBox<T> {
  value: T; constructor(value: T) { this.value = value; }
  static of<U>(value: U): FactoryBox<U> { return new FactoryBox<U>(value); }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const text = String(n), point = { id: n }, maybe: number | undefined = Object.is(n, -0) ? undefined : n;
  const v0 = FactoryBox.of<number>(n); same(v0.value, n);
  const v1 = FactoryBox.of<string>(text); same(v1.value, text);
  const v2 = FactoryBox.of<RoutePoint>(point); same(v2.value, point);
  const v3 = FactoryBox.of<number | undefined>(maybe); same(v3.value, maybe);
}
