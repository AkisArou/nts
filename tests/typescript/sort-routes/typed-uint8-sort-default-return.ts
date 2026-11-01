/*---
description: Uint8Array default sort through a typed return uses numeric order.
features: [ts-sort-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-functions]
---*/
// Uint8Array crosses a typed return; node uses numeric order.
function acquire(values: number[]): Uint8Array { return new Uint8Array(values); }
const seeds: number[] = [0, 2, 10, 254, 255, 128, 9, 1];
const inputs: number[][] = [
  [], [2], [0, 1, 2, 9, 10, 128, 254, 255],
  [255, 254, 128, 10, 9, 2, 1, 0], [2, 2, 2, 2],
  [0, 254, 0, 2, 254, 2, 0, 254, 10, 2, 10, 0]
];
for (const length of [9, 10, 11, 31, 32, 33, 63, 64, 65]) {
  const sample: number[] = [];
  for (let i = 0; i < length; i++) sample.push(seeds[(i * 7 + length) % seeds.length]);
  inputs.push(sample);
}
for (const sample of inputs) {
  const order: number[] = [0, 1, 2, 9, 10, 128, 254, 255];
  const expected: number[] = [];
  for (const value of order) for (const item of sample) if (Object.is(item, value)) expected.push(item);
  const view: Uint8Array = acquire(sample);
  const result = view.sort();
  assert.sameValue(result === view, true);
  assert.compareArray(Array.from(result), expected);
}
