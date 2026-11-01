/*---
description: Insertion-sort control for A throwing comparator field preserves the original number array and its alias.
features: [ts-sort-route-edges, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-arrow-functions, ts-class, ts-class-fields, ts-function-types, ts-errors]
---*/
// Control uses stable insertion over a copy. Numbers reach sort through a comparator field; node returns the source on success and keeps every original slot on throw.
class EdgeComparator {
  compare: (a: number, b: number) => number;
  constructor(fail: boolean, error: Error) { this.compare = (a, b) => { if (fail && (a === 2 || b === 2)) throw error; return a - b; }; }
}
function order(values: number[], compare: (a: number, b: number) => number): number[] {
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
for (const input of inputs) for (const fail of [false, true]) {
  const values = input.slice(), alias: number[] = values, before = values.slice();
  const error = new Error("comparison stopped"), holder = new EdgeComparator(fail, error);
  const expected: number[] = [];
  for (const key of [1, 2, 3]) for (const value of input) if (value === key) expected.push(value);
  if (fail && values.length > 1) {
    assert.throws(Error, () => { try { order(values, holder.compare); } catch (caught) { assert.sameValue(caught, error); throw caught; } });
    assert.compareArray(values, before); assert.compareArray(alias, before);
  } else {
    assert.sameValue(order(values, holder.compare), values);
    assert.compareArray(values, expected); assert.compareArray(alias, expected);
  }
}
