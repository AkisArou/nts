/*---
description: Sorting a frozen number array through a mutable parameter throws TypeError without changing its slots.
features: [ts-sort-route-edges, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-arrow-functions, ts-errors]
---*/
// Numbers cross a mutable parameter; lengths >=2 are frozen and node throws on writeback; small mutable arrays return themselves.
function compare(a: number, b: number): number { return a - b; }
function order(values: number[]): number[] { return values.sort(compare); }
const inputs: number[][] = [[], [2], [1, 1, 2, 3], [3, 2, 1, 1], [2, 2, 2, 2], [3, 1, 2, 1, 3, 2]];
for (const length of [9, 10, 11, 31, 32, 33, 63, 64, 65]) {
  const values: number[] = [];
  for (let i = 0; i < length; i++) values.push([3, 1, 2, 1, 3, 2][i % 6]);
  inputs.push(values);
}
for (const input of inputs) {
  const values: number[] = input.slice(), alias = values, before = values.slice();
  if (values.length > 1) {
    Object.freeze(values);
    assert.throws(TypeError, () => { order(values); });
  } else assert.sameValue(order(values), values);
  assert.compareArray(values, before); assert.compareArray(alias, before);
}
