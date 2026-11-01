/*---
description: Float32Array default sort through a typed field uses numeric order with both zero signs and NaN checked.
features: [ts-sort-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-class, ts-class-fields]
---*/
// Float32Array crosses a typed field; node uses numeric order with both zero signs and NaN checked.
class TypedBox { values: Float32Array; constructor(values: number[]) { this.values = new Float32Array(values); } }
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
  const holder = new TypedBox(sample); const view: Float32Array = holder.values;
  const result = view.sort();
  assert.sameValue(result === view, true);
  assert.compareArray(Array.from(result), expected);
}
