/*---
description: Float32Array comparator sort through a typed comparator map preserves the original order of distinct equal-key values with both zero signs and NaN checked.
features: [ts-sort-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-function-types, ts-map-set, ts-strings, ts-arrow-functions]
---*/
// Float32Array crosses a typed comparator map; node preserves the original order of distinct equal-key values with both zero signs and NaN checked.
function key(value: number): number { return Number.isNaN(value) ? 3 : value < 0 ? 0 : value === 0 ? 1 : 2; }
const comparators = new Map<string, (a: number, b: number) => number>();
comparators.set("groups", (a, b) => { const x = key(a), y = key(b); return x === y ? 0 : x < y ? -0.25 : 0.25; });
const compare = comparators.get("groups");
if (compare === undefined) throw new Error("missing comparator");
const seeds: number[] = [-Infinity, -1.5, 0, 2, Infinity, NaN, 10, 1.5, -0, -2];
const inputs: number[][] = [
  [], [2], [-Infinity, -2, -1.5, -0, 0, 1.5, 2, 10, Infinity, NaN],
  [NaN, Infinity, 10, 2, 1.5, 0, -0, -1.5, -2, -Infinity], [2, 2, 2, 2],
  [-Infinity, 2, -Infinity, -1.5, 2, -1.5, -Infinity, 2, 0, -1.5, 0, -Infinity]
];
for (const length of [9, 10, 11, 31, 32, 33, 63, 64, 65]) {
  const sample: number[] = [];
  for (let i = 0; i < length; i++) sample.push(seeds[(i * 7 + length) % seeds.length]);
  inputs.push(sample);
}
for (const sample of inputs) {
  const buckets: number[][] = [[-Infinity, -2, -1.5], [-0, 0], [1.5, 2, 10, Infinity], [NaN]];
  const expected: number[] = [];
  for (const bucket of buckets) for (const item of sample) {
    for (const value of bucket) if (Object.is(item, value)) { expected.push(item); break; }
  }
  const view: Float32Array = new Float32Array(sample);
  const result = view.sort(compare);
  assert.sameValue(result === view, true);
  assert.compareArray(Array.from(result), expected);
}
