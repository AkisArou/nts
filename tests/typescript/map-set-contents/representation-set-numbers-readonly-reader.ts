/*---
description: A readonly unknown-element Set reader preserves NaN and wide numbers while returning canonical positive zero.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-numbers, ts-spread, ts-arrow-functions]
---*/
// Write: Set<number>.add; read: a readonly unknown-element view.
// Node preserves the exact stored values, runtime kinds and insertion order.
function check(n: number): void {
  const set = new Set<number>();
  set.add(n); set.add(42.5); set.add(n);
  const reader: ReadonlySet<unknown> = set;
  const expected = n === 0 ? 0 : n;
  assert.sameValue(reader.size, 2);
  assert.sameValue(reader.has(n), true);
  assert.compareArray<unknown>([...reader], [expected, 42.5]);
  assert.compareArray([...reader].map(value => typeof value), ["number", "number"]);
}
for (const n of [-0, 0, NaN, 1.5, 2147483648, 4294967297, 9007199254740994, -9007199254740994]) check(n);
