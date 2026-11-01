/*---
description: Insertion-sort control for Sorting a frozen number array through a mutable parameter throws TypeError without changing its slots.
features: [ts-sort-route-edges, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-arrow-functions, ts-errors]
---*/
// Control uses stable insertion over a copy. Numbers cross a mutable parameter; lengths >=2 are frozen and node throws on writeback; small mutable arrays return themselves.
function compare(a: number, b: number): number { return a - b; }
function order(values: number[]): number[] {
  const copy = values.slice();
  for (let i = 1; i < copy.length; i++) {
    const value = copy[i]; let j = i;
    while (j > 0 && compare(copy[j - 1], value) > 0) { copy[j] = copy[j - 1]; j--; }
    copy[j] = value;
  }
  for (let i = 0; i < copy.length; i++) values[i] = copy[i];
  return values;
}
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
