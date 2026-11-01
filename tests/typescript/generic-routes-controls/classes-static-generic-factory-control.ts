/*---
description: Control for classes-static-generic-factory; write out each class specialization.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-static, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-unions, ts-type-aliases]
---*/
// Write out one non-generic class per type argument; preserve every input, operation and assertion.
type RoutePoint = { id: number };
class NumberFactoryBox {
  value: number; constructor(value: number) { this.value = value; }
  static of(value: number): NumberFactoryBox { return new NumberFactoryBox(value); }
}
class StringFactoryBox {
  value: string; constructor(value: string) { this.value = value; }
  static of(value: string): StringFactoryBox { return new StringFactoryBox(value); }
}
class PointFactoryBox {
  value: RoutePoint; constructor(value: RoutePoint) { this.value = value; }
  static of(value: RoutePoint): PointFactoryBox { return new PointFactoryBox(value); }
}
class MaybeFactoryBox {
  value: number | undefined; constructor(value: number | undefined) { this.value = value; }
  static of(value: number | undefined): MaybeFactoryBox { return new MaybeFactoryBox(value); }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const text = String(n), point = { id: n }, maybe: number | undefined = Object.is(n, -0) ? undefined : n;
  const v0 = NumberFactoryBox.of(n); same(v0.value, n);
  const v1 = StringFactoryBox.of(text); same(v1.value, text);
  const v2 = PointFactoryBox.of(point); same(v2.value, point);
  const v3 = MaybeFactoryBox.of(maybe); same(v3.value, maybe);
}
