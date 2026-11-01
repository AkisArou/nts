/*---
description: A NumberBox fixes the generic base argument beside four ordinary Box instantiations.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-inheritance, ts-instanceof, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-unions, ts-type-aliases]
---*/
// NumberBox extends Box<number>; number, string, point and optional Box instances keep independent fields and methods in node.
type RoutePoint = { id: number };
class Box<T> {
  private current: T; constructor(value: T) { this.current = value; }
  read(): T { return this.current; }
  replace(next: T): T { const old = this.current; this.current = next; return old; }
}
class NumberBox extends Box<number> { tag: string = "number"; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const point = { id: n }, nextPoint = { id: n + 1 }, text = String(n), maybe: number | undefined = Object.is(n, -0) ? undefined : n;
  const fixed = new NumberBox(n);
  const number = new Box<number>(n), string = new Box<string>(text);
  const object = new Box<RoutePoint>(point), optional = new Box<number | undefined>(maybe);
  same(fixed.read(), n); same(fixed.replace(n + 1), n); same(fixed.read(), n + 1); same(fixed.tag, "number");
  same(number.read(), n); same(number.replace(-0), n); same(number.read(), -0);
  same(string.read(), text); same(string.replace(text + "!"), text); same(string.read(), text + "!");
  same(object.read(), point); same(object.replace(nextPoint), point); same(object.read(), nextPoint);
  same(optional.read(), maybe); same(optional.replace(undefined), maybe); same(optional.read(), undefined);
  same(fixed instanceof NumberBox, true); same(number instanceof NumberBox, false);
  same(fixed instanceof Box, true);
}
