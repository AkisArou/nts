/*---
description: Control for classes-box-primitives; write out each class specialization.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint]
---*/
// Write out one non-generic class per type argument; preserve every input, operation and assertion.
class NumberBox {
  private current: number; constructor(value: number) { this.current = value; }
  read(): number { return this.current; }
  replace(next: number): number { const old = this.current; this.current = next; return old; }
}
class StringBox {
  private current: string; constructor(value: string) { this.current = value; }
  read(): string { return this.current; }
  replace(next: string): string { const old = this.current; this.current = next; return old; }
}
class BooleanBox {
  private current: boolean; constructor(value: boolean) { this.current = value; }
  read(): boolean { return this.current; }
  replace(next: boolean): boolean { const old = this.current; this.current = next; return old; }
}
class BigIntBox {
  private current: bigint; constructor(value: bigint) { this.current = value; }
  read(): bigint { return this.current; }
  replace(next: bigint): bigint { const old = this.current; this.current = next; return old; }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const m = Object.is(n, -0) ? NaN : -0, text = "value:" + String(n), flag = Object.is(n, -0);
  const wide = flag ? -9007199254740993n : 9007199254740993n;
  const v0 = new NumberBox(n), v1 = new StringBox(text);
  const v2 = new BooleanBox(flag), v3 = new BigIntBox(wide);
  same(v0.read(), n); same(v0.replace(m), n); same(v0.read(), m);
  same(v1.read(), text); same(v1.replace(text + "!"), text); same(v1.read(), text + "!");
  same(v2.read(), flag); same(v2.replace(!flag), flag); same(v2.read(), !flag);
  same(v3.read(), wide); same(v3.replace(wide + 1n), wide); same(v3.read(), wide + 1n);
}
