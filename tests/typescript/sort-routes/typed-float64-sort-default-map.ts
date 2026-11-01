/*---
description: Float64Array default sort through a typed map uses numeric order with both zero signs and NaN checked.
features: [ts-sort-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-map-set, ts-strings]
---*/
// Float64Array crosses a typed map; node uses numeric order with both zero signs and NaN checked.
const seeds: number[] = [-Infinity, -1.5, 0, 2, 10, NaN, Infinity, 9, 1.5, -0, -10];
const inputs: number[][] = [
  [], [2], [-Infinity, -10, -1.5, -0, 0, 1.5, 2, 9, 10, Infinity, NaN],
  [NaN, Infinity, 10, 9, 2, 1.5, 0, -0, -1.5, -10, -Infinity], [2, 2, 2, 2],
  [-Infinity, 2, -Infinity, -1.5, 2, -1.5, -Infinity, 2, 0, -1.5, 0, -Infinity]
];
for (const length of [9, 10, 11, 31, 32, 33, 63, 64, 65]) {
  const sample: number[] = [];
  for (let i = 0; i < length; i++) sample.push(seeds[(i * 7 + length) % seeds.length]);
  inputs.push(sample);
}
for (const sample of inputs) {
  const order: number[] = [-Infinity, -10, -1.5, -0, 0, 1.5, 2, 9, 10, Infinity, NaN];
  const expected: number[] = [];
  for (const value of order) for (const item of sample) if (Object.is(item, value)) expected.push(item);
  const storage = new Map<string, Float64Array>();
  storage.set("values", new Float64Array(sample));
  const view = storage.get("values");
  if (view === undefined) throw new Error("missing values");
  const result = view.sort();
  assert.sameValue(result === view, true);
  assert.compareArray(Array.from(result), expected);
}
