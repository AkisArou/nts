/*---
description: Control for classes-fixed-number-subclass; write out each class specialization.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-inheritance, ts-instanceof, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-unions, ts-type-aliases]
---*/
// Write out one non-generic class per type argument; preserve every input, operation and assertion.
type RoutePoint = { id: number };
class NumberValueBox {
  private current: number; constructor(value: number) { this.current = value; }
  read(): number { return this.current; }
  replace(next: number): number { const old = this.current; this.current = next; return old; }
}
class StringValueBox {
  private current: string; constructor(value: string) { this.current = value; }
  read(): string { return this.current; }
  replace(next: string): string { const old = this.current; this.current = next; return old; }
}
class PointValueBox {
  private current: RoutePoint; constructor(value: RoutePoint) { this.current = value; }
  read(): RoutePoint { return this.current; }
  replace(next: RoutePoint): RoutePoint { const old = this.current; this.current = next; return old; }
}
class MaybeValueBox {
  private current: number | undefined; constructor(value: number | undefined) { this.current = value; }
  read(): number | undefined { return this.current; }
  replace(next: number | undefined): number | undefined { const old = this.current; this.current = next; return old; }
}
class NumberBox extends NumberValueBox { tag: string = "number"; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const point = { id: n }, nextPoint = { id: n + 1 }, text = String(n), maybe: number | undefined = Object.is(n, -0) ? undefined : n;
  const fixed = new NumberBox(n);
  const number = new NumberValueBox(n), string = new StringValueBox(text);
  const object = new PointValueBox(point), optional = new MaybeValueBox(maybe);
  same(fixed.read(), n); same(fixed.replace(n + 1), n); same(fixed.read(), n + 1); same(fixed.tag, "number");
  same(number.read(), n); same(number.replace(-0), n); same(number.read(), -0);
  same(string.read(), text); same(string.replace(text + "!"), text); same(string.read(), text + "!");
  same(object.read(), point); same(object.replace(nextPoint), point); same(object.read(), nextPoint);
  same(optional.read(), maybe); same(optional.replace(undefined), maybe); same(optional.read(), undefined);
  same(fixed instanceof NumberBox, true); same(number instanceof NumberBox, false);
  same(fixed instanceof NumberValueBox, true);
}
