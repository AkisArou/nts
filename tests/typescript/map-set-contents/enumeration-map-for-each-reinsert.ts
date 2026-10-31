/*---
description: Map forEach preserves delete and reinsert order, zero and NaN through differently typed writers and readers.
features: [ts-map-set-contents, ts-contents-enumeration, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unions, ts-unknown, ts-numbers, ts-strings, ts-unsound-bivariance, ts-this-parameter, ts-objects, ts-this]
---*/
// Write through a union map alias; read narrow forEach; node keeps actual types and complete order.
function check(n: number): void {
  const map = new Map<string, number>([["zero", -0], ["item", n], ["nan", NaN], ["other", n + 1]]);
  const writer: Map<string, number | string> = map;
  writer.delete("item"); writer.set("item", "late:" + n); writer.delete("nan"); writer.set("nan", NaN);
  const state: { values: unknown[]; types: string[]; sizes: number[]; keys: string[] } = { values: [], types: [], sizes: [], keys: [] };
  map.forEach(function(this: { values: unknown[]; types: string[]; sizes: number[]; keys: string[] }, value, key, owner): void {
    assert.sameValue(this, state); assert.sameValue(owner, map);
    this.values.push(value); this.types.push(typeof value); this.sizes.push(map.size);
    this.keys.push(key);
  }, state);
  assert.compareArray(state.values, [-0, n + 1, "late:" + n, NaN]);
  assert.compareArray(state.types, ["number", "number", "string", "number"]);
  assert.compareArray(state.sizes, [4, 4, 4, 4]);
  assert.compareArray(state.keys, ["zero", "other", "item", "nan"]);
  assert.sameValue(map.size, 4);
  assert.sameValue(map.has("item"), true);
}
for (const n of [2, 9, 40]) check(n);
