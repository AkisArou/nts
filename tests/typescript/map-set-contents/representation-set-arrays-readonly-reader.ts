/*---
description: A readonly Set of readonly arrays retains distinct array identities and observes later element writes.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-numbers, ts-spread, ts-arrow-functions]
---*/
// Write: Set<number[]>.add; read: a readonly Set with readonly array elements.
// Node preserves the exact stored values, runtime kinds and insertion order.
function check(n: number): void {
  const first = [n, -0, NaN], second = [n + 1];
  const set = new Set<number[]>(); set.add(first); set.add(second);
  const reader: ReadonlySet<readonly number[]> = set;
  first.push(n + 2);
  const seen = [...reader];
  assert.sameValue(reader.size, 2); assert.sameValue(reader.has(first), true);
  assert.compareArray<unknown>(seen, [first, second]);
  assert.compareArray(seen.map(value => typeof value), ["object", "object"]);
  assert.sameValue(Array.isArray(seen[0]), true);
  assert.compareArray(seen[0], [n, -0, NaN, n + 2]);
  assert.compareArray(seen[1], [n + 1]);
}
for (const n of [-3, 0, 7]) check(n);
