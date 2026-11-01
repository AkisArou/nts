/*---
description: Box retains primitives across coexisting class instantiations and replacement.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-numbers, ts-strings, ts-bigint]
---*/
// Box<T> uses number, string, boolean, bigint together; node preserves each initial value, replacement and returned old value.
class Box<T> {
  private current: T; constructor(value: T) { this.current = value; }
  read(): T { return this.current; }
  replace(next: T): T { const old = this.current; this.current = next; return old; }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const m = Object.is(n, -0) ? NaN : -0, text = "value:" + String(n), flag = Object.is(n, -0);
  const wide = flag ? -9007199254740993n : 9007199254740993n;
  const v0 = new Box<number>(n), v1 = new Box<string>(text);
  const v2 = new Box<boolean>(flag), v3 = new Box<bigint>(wide);
  same(v0.read(), n); same(v0.replace(m), n); same(v0.read(), m);
  same(v1.read(), text); same(v1.replace(text + "!"), text); same(v1.read(), text + "!");
  same(v2.read(), flag); same(v2.replace(!flag), flag); same(v2.read(), !flag);
  same(v3.read(), wide); same(v3.replace(wide + 1n), wide); same(v3.read(), wide + 1n);
}
