/*---
description: Set forEach preserves live deletions, later additions and current size through differently typed writers and readers.
features: [ts-map-set-contents, ts-contents-enumeration, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unions, ts-unknown, ts-numbers, ts-strings, ts-unsound-bivariance, ts-null-undefined, ts-this-parameter, ts-objects, ts-this]
---*/
// Write through a union set alias; read narrow forEach; node keeps actual types and complete order.
function check(n: number): void {
  const set = new Set<number>([n, n + 1, -0]);
  const writer: Set<number | string | undefined> = set;
  const state: { values: unknown[]; types: string[]; sizes: number[] } = { values: [], types: [], sizes: [] };
  set.forEach(function(this: { values: unknown[]; types: string[]; sizes: number[] }, value, again, owner): void {
    assert.sameValue(this, state); assert.sameValue(owner, set);
    assert.sameValue(value, again); assert.sameValue(typeof value, typeof again);
    this.values.push(value); this.types.push(typeof value); this.sizes.push(set.size);
    if (this.values.length === 1) { writer.delete(n + 1); writer.add("late:" + n); writer.add(undefined); }
  }, state);
  assert.compareArray(state.values, [n, 0, "late:" + n, undefined]);
  assert.compareArray(state.types, ["number", "number", "string", "undefined"]);
  assert.compareArray(state.sizes, [3, 4, 4, 4]);
  assert.sameValue(set.size, 4);
  assert.sameValue(set.has(n + 1), false);
  assert.sameValue(writer.has(undefined), true);
}
for (const n of [2, 9, 40]) check(n);
