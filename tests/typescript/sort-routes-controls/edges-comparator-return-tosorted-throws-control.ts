/*---
description: Insertion-sort control for A returned throwing comparator leaves a toSorted source unchanged on success and failure.
features: [ts-sort-route-edges, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-arrow-functions, ts-function-types, ts-errors, ts-closures]
---*/
// Control uses stable insertion over a copy. Numbers use a comparator returned from a typed closure factory; node gives an independent order or throws with the source unchanged.
function comparator(fail: boolean, error: Error): (a: number, b: number) => number {
  return (a, b) => { if (fail && (a === 2 || b === 2)) throw error; return a - b; };
}
function copied(values: number[], compare: (a: number, b: number) => number): number[] {
  const copy = values.slice();
  for (let i = 1; i < copy.length; i++) {
    const value = copy[i]; let j = i;
    while (j > 0 && compare(copy[j - 1], value) > 0) { copy[j] = copy[j - 1]; j--; }
    copy[j] = value;
  }
  return copy;
}
const inputs: number[][] = [[], [2], [1, 1, 2, 3], [3, 2, 1, 1], [2, 2, 2, 2], [3, 1, 2, 1, 3, 2]];
for (const length of [9, 10, 11, 31, 32, 33, 63, 64, 65]) {
  const values: number[] = [];
  for (let i = 0; i < length; i++) values.push([3, 1, 2, 1, 3, 2][i % 6]);
  inputs.push(values);
}
for (const input of inputs) for (const fail of [false, true]) {
  const values = input.slice(), before = values.slice(), error = new Error("copy comparison stopped");
  const compare = comparator(fail, error), expected: number[] = [];
  for (const key of [1, 2, 3]) for (const value of input) if (value === key) expected.push(value);
  if (fail && values.length > 1) {
    assert.throws(Error, () => { try { copied(values, compare); } catch (caught) { assert.sameValue(caught, error); throw caught; } });
  } else {
    const result = copied(values, compare);
    assert.sameValue(result === values, false); assert.compareArray(result, expected);
  }
  assert.compareArray(values, before);
}
