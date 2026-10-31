/*---
description: Control for enumeration-map-for-each-live; use one collection type for every writer and reader.
features: [ts-map-set-contents, ts-contents-enumeration, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unions, ts-unknown, ts-numbers, ts-strings, ts-unsound-bivariance, ts-null-undefined, ts-this-parameter, ts-objects, ts-this]
---*/
// Paired case: ../map-set-contents/enumeration-map-for-each-live.ts.
// Only the collection type is unified; writes, reads and expectations are unchanged.
function check(n: number): void {
  const map = new Map<string, number | string | undefined>([["first", n], ["gone", n + 1], ["zero", -0]]);
  const writer: Map<string, number | string | undefined> = map;
  const state: { values: unknown[]; types: string[]; sizes: number[]; keys: string[] } = { values: [], types: [], sizes: [], keys: [] };
  map.forEach(function(this: { values: unknown[]; types: string[]; sizes: number[]; keys: string[] }, value, key, owner): void {
    assert.sameValue(this, state); assert.sameValue(owner, map);
    this.values.push(value); this.types.push(typeof value); this.sizes.push(map.size);
    this.keys.push(key);
    if (this.values.length === 1) { writer.delete("gone"); writer.set("late", "late:" + n); writer.set("empty", undefined); }
  }, state);
  assert.compareArray(state.values, [n, -0, "late:" + n, undefined]);
  assert.compareArray(state.types, ["number", "number", "string", "undefined"]);
  assert.compareArray(state.sizes, [3, 4, 4, 4]);
  assert.compareArray(state.keys, ["first", "zero", "late", "empty"]);
  assert.sameValue(map.size, 4);
  assert.sameValue(map.has("gone"), false);
  assert.sameValue(map.has("empty"), true);
  assert.sameValue<unknown>(map.get("empty"), undefined);
  assert.sameValue(map.has("missing"), false);
  assert.sameValue<unknown>(map.get("missing"), undefined);
}
for (const n of [2, 9, 40]) check(n);
