/*---
description: Control for stability-tuple-element-copy; copying sort by a tuple element preserves tuple identity and duplicate-key positions.
features: [ts-sort-route-stability, ts-arrays, ts-numbers, ts-objects, ts-iteration, ts-arrow-functions, ts-strings, ts-tuples, ts-tuple-labels, ts-type-aliases, ts-function-types]
---*/
// Control: stable insertion over a copy keeps the same typed comparison. Labeled tuples reach toSorted through a declared tuple array; node keeps tied tuple identities and positions while leaving the source unchanged.
type RankedTuple = [key: number, id: string, position: number];
const inputs: number[][] = [];
// Shapes are ordered, reversed, equal-key and interleaved duplicates at every length.
for (const length of [0, 1, 9, 10, 11, 31, 32, 33, 63, 64, 65]) for (const shape of [0, 1, 2, 3]) {
  const input: number[] = [];
  for (let i = 0; i < length; i++) input.push(shape === 0 ? Math.floor(i * 3 / length) : shape === 1 ? 2 - Math.floor(i * 3 / length) : shape === 2 ? 1 : (i * 7 + length) % 3);
  inputs.push(input);
}
for (const sample of inputs) {
  const original: RankedTuple[] = sample.map((key, position) => [key, "row-" + position, position]);
  const values: RankedTuple[] = original.slice(), order: number[] = [];
  for (const key of [0, 1, 2]) for (let i = 0; i < sample.length; i++) if (sample[i] === key) order.push(i);
  const compare = (a: RankedTuple, b: RankedTuple): number => a[0] - b[0];
  const copy = values.slice();
  for (let i = 1; i < copy.length; i++) {
    const item = copy[i]; let j = i;
    while (j > 0 && compare(copy[j - 1], item) > 0) { copy[j] = copy[j - 1]; j--; }
    copy[j] = item;
  }
  const result = copy;
  assert.sameValue(result === values, false); assert.compareArray(values, original);
  assert.compareArray(result, order.map(index => original[index]));
  assert.compareArray(result.map(item => item[1]), order.map(index => "row-" + index));
  assert.compareArray(result.map(item => item[2]), order);
}
