/*---
description: Cell retains primitives across coexisting class instantiations and replacement.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-numbers, ts-strings, ts-bigint, ts-accessors]
---*/
// Cell<T> uses number, string, boolean, bigint together; node preserves each initial value, replacement and returned old value. The exchange goes through its getter and setter.
class Cell<T> {
  private current: T; constructor(value: T) { this.current = value; }
  get value(): T { return this.current; }
  set value(next: T) { this.current = next; }
  replace(next: T): T { const old = this.value; this.value = next; return old; }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const m = Object.is(n, -0) ? NaN : -0, text = "value:" + String(n), flag = Object.is(n, -0);
  const wide = flag ? -9007199254740993n : 9007199254740993n;
  const v0 = new Cell<number>(n), v1 = new Cell<string>(text);
  const v2 = new Cell<boolean>(flag), v3 = new Cell<bigint>(wide);
  same(v0.value, n); same(v0.replace(m), n); same(v0.value, m);
  same(v1.value, text); same(v1.replace(text + "!"), text); same(v1.value, text + "!");
  same(v2.value, flag); same(v2.replace(!flag), flag); same(v2.value, !flag);
  same(v3.value, wide); same(v3.replace(wide + 1n), wide); same(v3.value, wide + 1n);
}
