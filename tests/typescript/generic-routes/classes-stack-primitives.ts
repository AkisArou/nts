/*---
description: Stack retains primitives across coexisting class instantiations and replacement.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-numbers, ts-strings, ts-bigint, ts-arrays, ts-null-undefined]
---*/
// Stack<T> uses number, string, boolean, bigint together; node preserves each initial value, replacement and returned old value. Draining returns the replacement, then undefined.
class Stack<T> {
  private items: T[] = []; constructor(value: T) { this.items.push(value); }
  read(): T | undefined { return this.items[this.items.length - 1]; }
  replace(next: T): T | undefined { const old = this.items.pop(); this.items.push(next); return old; }
  pop(): T | undefined { return this.items.pop(); }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const m = Object.is(n, -0) ? NaN : -0, text = "value:" + String(n), flag = Object.is(n, -0);
  const wide = flag ? -9007199254740993n : 9007199254740993n;
  const v0 = new Stack<number>(n), v1 = new Stack<string>(text);
  const v2 = new Stack<boolean>(flag), v3 = new Stack<bigint>(wide);
  same(v0.read(), n); same(v0.replace(m), n); same(v0.read(), m);
  same(v0.pop(), m); same(v0.pop(), undefined);
  same(v1.read(), text); same(v1.replace(text + "!"), text); same(v1.read(), text + "!");
  same(v1.pop(), text + "!"); same(v1.pop(), undefined);
  same(v2.read(), flag); same(v2.replace(!flag), flag); same(v2.read(), !flag);
  same(v2.pop(), !flag); same(v2.pop(), undefined);
  same(v3.read(), wide); same(v3.replace(wide + 1n), wide); same(v3.read(), wide + 1n);
  same(v3.pop(), wide + 1n); same(v3.pop(), undefined);
}
