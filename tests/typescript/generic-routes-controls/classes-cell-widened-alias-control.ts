/*---
description: Control for classes-cell-widened-alias; write out each class specialization.
features: [ts-generic-routes, ts-generic-route-classes, ts-class, ts-class-fields, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-objects, ts-unions, ts-unknown, ts-null-undefined, ts-arrays, ts-structural-typing, ts-unsound-generic-widening]
---*/
// Write NumberCell, MixedCell and UnknownCell separately, retaining the same structural aliases, method bodies, stores and assertions.
class NumberCell {
  value: number; constructor(value: number) { this.value = value; }
  read(): number { return this.value; }
  replace(next: number): number { const old = this.value; this.value = next; return old; }
}
class MixedCell {
  value: number | string; constructor(value: number | string) { this.value = value; }
  read(): number | string { return this.value; }
  replace(next: number | string): number | string { const old = this.value; this.value = next; return old; }
}
class UnknownCell {
  value: unknown; constructor(value: unknown) { this.value = value; }
  read(): unknown { return this.value; }
  replace(next: unknown): unknown { const old = this.value; this.value = next; return old; }
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 1.25]) {
  const text = "value:" + String(n), point = { id: n };
  const source = new NumberCell(n);
  const mixed: MixedCell = source;
  const erased: UnknownCell = source;
  same(source, mixed); same(source, erased);
  for (const actual of [source.read(), mixed.read(), erased.read()]) same(actual, n);
  same(mixed.replace(text), n);
  for (const actual of [source.read(), mixed.read(), erased.read()]) same(actual, text);
  let previous: unknown = text;
  for (const next of [point, undefined, -0, NaN]) {
    same(erased.replace(next), previous);
    for (const actual of [source.read(), mixed.read(), erased.read(), source.value, mixed.value, erased.value]) same(actual, next);
    previous = next;
  }
}
