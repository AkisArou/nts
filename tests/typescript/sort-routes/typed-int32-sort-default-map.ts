/*---
description: Int32Array default sort through a typed map uses numeric order.
features: [ts-sort-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-map-set, ts-strings]
---*/
// Int32Array crosses a typed map; node uses numeric order.
const seeds: number[] = [-2147483648, -2, 2, 10, 2147483647, 9, 0, -10];
const inputs: number[][] = [
  [], [2], [-2147483648, -10, -2, 0, 2, 9, 10, 2147483647],
  [2147483647, 10, 9, 2, 0, -2, -10, -2147483648], [2, 2, 2, 2],
  [-2147483648, 10, -2147483648, -2, 10, -2, -2147483648, 10, 2, -2, 2, -2147483648]
];
for (const length of [9, 10, 11, 31, 32, 33, 63, 64, 65]) {
  const sample: number[] = [];
  for (let i = 0; i < length; i++) sample.push(seeds[(i * 7 + length) % seeds.length]);
  inputs.push(sample);
}
for (const sample of inputs) {
  const order: number[] = [-2147483648, -10, -2, 0, 2, 9, 10, 2147483647];
  const expected: number[] = [];
  for (const value of order) for (const item of sample) if (Object.is(item, value)) expected.push(item);
  const storage = new Map<string, Int32Array>();
  storage.set("values", new Int32Array(sample));
  const view = storage.get("values");
  if (view === undefined) throw new Error("missing values");
  const result = view.sort();
  assert.sameValue(result === view, true);
  assert.compareArray(Array.from(result), expected);
}
