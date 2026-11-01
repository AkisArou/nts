/*---
description: Control for classes-stack-primitives; write out each class specialization.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-arrays, ts-null-undefined]
---*/
// Write out one non-generic class per type argument; preserve every input, operation and assertion.
class NumberStack {
  private items: number[] = []; constructor(value: number) { this.items.push(value); }
  read(): number | undefined { return this.items[this.items.length - 1]; }
  replace(next: number): number | undefined { const old = this.items.pop(); this.items.push(next); return old; }
  pop(): number | undefined { return this.items.pop(); }
}
class StringStack {
  private items: string[] = []; constructor(value: string) { this.items.push(value); }
  read(): string | undefined { return this.items[this.items.length - 1]; }
  replace(next: string): string | undefined { const old = this.items.pop(); this.items.push(next); return old; }
  pop(): string | undefined { return this.items.pop(); }
}
class BooleanStack {
  private items: boolean[] = []; constructor(value: boolean) { this.items.push(value); }
  read(): boolean | undefined { return this.items[this.items.length - 1]; }
  replace(next: boolean): boolean | undefined { const old = this.items.pop(); this.items.push(next); return old; }
  pop(): boolean | undefined { return this.items.pop(); }
}
class BigIntStack {
  private items: bigint[] = []; constructor(value: bigint) { this.items.push(value); }
  read(): bigint | undefined { return this.items[this.items.length - 1]; }
  replace(next: bigint): bigint | undefined { const old = this.items.pop(); this.items.push(next); return old; }
  pop(): bigint | undefined { return this.items.pop(); }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const m = Object.is(n, -0) ? NaN : -0, text = "value:" + String(n), flag = Object.is(n, -0);
  const wide = flag ? -9007199254740993n : 9007199254740993n;
  const v0 = new NumberStack(n), v1 = new StringStack(text);
  const v2 = new BooleanStack(flag), v3 = new BigIntStack(wide);
  same(v0.read(), n); same(v0.replace(m), n); same(v0.read(), m);
  same(v0.pop(), m); same(v0.pop(), undefined);
  same(v1.read(), text); same(v1.replace(text + "!"), text); same(v1.read(), text + "!");
  same(v1.pop(), text + "!"); same(v1.pop(), undefined);
  same(v2.read(), flag); same(v2.replace(!flag), flag); same(v2.read(), !flag);
  same(v2.pop(), !flag); same(v2.pop(), undefined);
  same(v3.read(), wide); same(v3.replace(wide + 1n), wide); same(v3.read(), wide + 1n);
  same(v3.pop(), wide + 1n); same(v3.pop(), undefined);
}
