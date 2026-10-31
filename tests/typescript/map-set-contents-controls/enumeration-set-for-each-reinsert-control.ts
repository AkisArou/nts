/*---
description: Control for enumeration-set-for-each-reinsert; use one collection type for every writer and reader.
features: [ts-map-set-contents, ts-contents-enumeration, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unions, ts-unknown, ts-numbers, ts-strings, ts-unsound-bivariance, ts-this-parameter, ts-objects, ts-this]
---*/
// Paired case: ../map-set-contents/enumeration-set-for-each-reinsert.ts.
// Only the collection type is unified; writes, reads and expectations are unchanged.
function check(n: number): void {
  const set = new Set<number | string>([n, NaN, -0, n + 1]);
  const writer: Set<number | string> = set;
  writer.delete(n); writer.add("late:" + n); writer.add(n); writer.delete(NaN); writer.add(NaN);
  const state: { values: unknown[]; types: string[]; sizes: number[] } = { values: [], types: [], sizes: [] };
  set.forEach(function(this: { values: unknown[]; types: string[]; sizes: number[] }, value, again, owner): void {
    assert.sameValue(this, state); assert.sameValue(owner, set);
    assert.sameValue(value, again); assert.sameValue(typeof value, typeof again);
    this.values.push(value); this.types.push(typeof value); this.sizes.push(set.size);
  }, state);
  assert.compareArray(state.values, [0, n + 1, "late:" + n, n, NaN]);
  assert.compareArray(state.types, ["number", "number", "string", "number", "number"]);
  assert.compareArray(state.sizes, [5, 5, 5, 5, 5]);
  assert.sameValue(set.size, 5);
  assert.sameValue(set.has(NaN), true);
}
for (const n of [2, 9, 40]) check(n);
