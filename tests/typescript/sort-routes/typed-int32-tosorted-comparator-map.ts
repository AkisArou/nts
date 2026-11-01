/*---
description: Int32Array comparator toSorted through a typed comparator map preserves the original order of distinct equal-key values, and leaves its source unchanged.
features: [ts-sort-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-function-types, ts-map-set, ts-strings, ts-arrow-functions]
---*/
// Int32Array crosses a typed comparator map; node preserves the original order of distinct equal-key values, and leaves its source unchanged.
function key(value: number): number { return Math.abs(value) % 3; }
const comparators = new Map<string, (a: number, b: number) => number>();
comparators.set("groups", (a, b) => { const x = key(a), y = key(b); return x === y ? 0 : x < y ? -Infinity : Infinity; });
const compare = comparators.get("groups");
if (compare === undefined) throw new Error("missing comparator");
const seeds: number[] = [-6, 0, 1, -8, 5, 2, 7, -4, 3];
const inputs: number[][] = [
  [], [2], [-6, 3, 0, -4, 1, 7, -8, 2, 5],
  [5, 2, -8, 7, 1, -4, 0, 3, -6], [2, 2, 2, 2],
  [-6, -8, -6, 0, -8, 0, -6, -8, 1, 0, 1, -6]
];
for (const length of [9, 10, 11, 31, 32, 33, 63, 64, 65]) {
  const sample: number[] = [];
  for (let i = 0; i < length; i++) sample.push(seeds[(i * 7 + length) % seeds.length]);
  inputs.push(sample);
}
for (const sample of inputs) {
  const buckets: number[][] = [[-6, 3, 0], [-4, 1, 7], [-8, 2, 5]];
  const expected: number[] = [];
  for (const bucket of buckets) for (const item of sample) {
    for (const value of bucket) if (Object.is(item, value)) { expected.push(item); break; }
  }
  const view: Int32Array = new Int32Array(sample);
  const result = view.toSorted(compare);
  assert.sameValue(result === view, false);
  assert.compareArray(Array.from(result), expected);
  assert.sameValue(result.buffer === view.buffer, false);
  assert.compareArray(Array.from(view), sample);
}
