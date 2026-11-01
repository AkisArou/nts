/*---
description: Control for classes-cell-primitives; write out each class specialization.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-accessors]
---*/
// Write out one non-generic class per type argument; preserve every input, operation and assertion.
class NumberCell {
  private current: number; constructor(value: number) { this.current = value; }
  get value(): number { return this.current; }
  set value(next: number) { this.current = next; }
  replace(next: number): number { const old = this.value; this.value = next; return old; }
}
class StringCell {
  private current: string; constructor(value: string) { this.current = value; }
  get value(): string { return this.current; }
  set value(next: string) { this.current = next; }
  replace(next: string): string { const old = this.value; this.value = next; return old; }
}
class BooleanCell {
  private current: boolean; constructor(value: boolean) { this.current = value; }
  get value(): boolean { return this.current; }
  set value(next: boolean) { this.current = next; }
  replace(next: boolean): boolean { const old = this.value; this.value = next; return old; }
}
class BigIntCell {
  private current: bigint; constructor(value: bigint) { this.current = value; }
  get value(): bigint { return this.current; }
  set value(next: bigint) { this.current = next; }
  replace(next: bigint): bigint { const old = this.value; this.value = next; return old; }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const m = Object.is(n, -0) ? NaN : -0, text = "value:" + String(n), flag = Object.is(n, -0);
  const wide = flag ? -9007199254740993n : 9007199254740993n;
  const v0 = new NumberCell(n), v1 = new StringCell(text);
  const v2 = new BooleanCell(flag), v3 = new BigIntCell(wide);
  same(v0.value, n); same(v0.replace(m), n); same(v0.value, m);
  same(v1.value, text); same(v1.replace(text + "!"), text); same(v1.value, text + "!");
  same(v2.value, flag); same(v2.replace(!flag), flag); same(v2.value, !flag);
  same(v3.value, wide); same(v3.replace(wide + 1n), wide); same(v3.value, wide + 1n);
}
