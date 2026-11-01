/*---
description: A union-typed field preserves undefined for invalid typed-array indices.
features: [ts-absent-routes, ts-absent-route-bounds, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-arrays, ts-interfaces, ts-unions, ts-numbers, ts-objects, ts-tuples]
---*/
// A union field carries floating and byte views; node gives undefined for invalid numeric indices while retaining -0 and NaN in range.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
interface BoundsView { data: Float64Array | Uint8Array; }
function read(holder: BoundsView, index: number): number | undefined { return holder.data[index]; }
const rows: [Float64Array | Uint8Array, number[], string][] = [[new Float64Array([-0, NaN, 0]), [-0, NaN, 0], '{"0":0,"1":null,"2":0}'], [new Uint8Array([0, 255, 17]), [0, 255, 17], '{"0":0,"1":255,"2":17}']];
const positions: [number, number][] = [[-1, -1], [-0, 0], [0.5, -1], [1, 1], [2, 2], [3, -1], [8, -1], [NaN, -1]];
for (const [data, expected, json] of rows) {
  const holder: BoundsView = { data }, keys = Object.keys(holder.data);
  assert.compareArray(keys, ["0", "1", "2"]); same(JSON.stringify(holder.data), json);
  for (const [index, slot] of positions) {
    same(read(holder, index), slot < 0 ? undefined : expected[slot]);
    same(index in holder.data, slot >= 0); same(Object.hasOwn(holder.data, index), slot >= 0);
  }
  same(holder.data.length, 3);
}
