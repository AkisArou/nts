/*---
description: A readonly array of interface records produces a stable fresh toSorted result without changing the source.
features: [ts-sort-route-edges, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-arrow-functions, ts-interfaces, ts-readonly, ts-objects, ts-strings]
---*/
// Interface records cross a readonly parameter; node keeps equal-key ids and original positions while returning a fresh array.
interface EdgeRecord { key: number; id: string; position: number; }
function compare(a: EdgeRecord, b: EdgeRecord): number { return a.key - b.key; }
function copied(values: readonly EdgeRecord[]): EdgeRecord[] { return values.toSorted(compare); }
const inputs: number[][] = [[], [2], [1, 1, 2, 3], [3, 2, 1, 1], [2, 2, 2, 2], [3, 1, 2, 1, 3, 2]];
for (const length of [9, 10, 11, 31, 32, 33, 63, 64, 65]) {
  const values: number[] = [];
  for (let i = 0; i < length; i++) values.push([3, 1, 2, 1, 3, 2][i % 6]);
  inputs.push(values);
}
for (const input of inputs) {
  const values: EdgeRecord[] = input.map((key, position) => ({ key, id: "record-" + position, position }));
  const source: readonly EdgeRecord[] = values, before = values.slice(), expected: EdgeRecord[] = [];
  for (const key of [1, 2, 3]) for (const value of values) if (value.key === key) expected.push(value);
  const result = copied(source);
  assert.sameValue(result === source, false); assert.compareArray(result, expected);
  assert.compareArray(result.map(value => value.id), expected.map(value => value.id));
  assert.compareArray(result.map(value => value.position), expected.map(value => value.position));
  assert.compareArray(source, before); assert.compareArray(source.map(value => value.position), input.map((_, position) => position));
}
