/*---
description: Control for stability-successive-key-sorts; successive sorts by secondary and primary keys preserve both stable layers.
features: [ts-sort-route-stability, ts-arrays, ts-numbers, ts-objects, ts-iteration, ts-arrow-functions, ts-strings, ts-interfaces, ts-functions, ts-function-types]
---*/
// Control: stable insertion over a copy keeps the same typed comparison. Records in a declared array sort by minor then major; node preserves minor order inside each major group and original positions for double ties.
interface SortRecord { major: number; minor: number; id: string; position: number; }
function observe(result: SortRecord[], original: SortRecord[], order: number[]): void {
  assert.compareArray(result, order.map(index => original[index]));
  assert.compareArray(result.map(item => item.id), order.map(index => "row-" + index));
  assert.compareArray(result.map(item => item.position), order);
}
function inserted(values: SortRecord[], compare: (a: SortRecord, b: SortRecord) => number): SortRecord[] {
  const copy = values.slice();
  for (let i = 1; i < copy.length; i++) {
    const item = copy[i]; let j = i;
    while (j > 0 && compare(copy[j - 1], item) > 0) { copy[j] = copy[j - 1]; j--; }
    copy[j] = item;
  }
  for (let i = 0; i < copy.length; i++) values[i] = copy[i];
  return values;
}
const inputs: number[][] = [];
// Shapes are ordered, reversed, equal-key and interleaved duplicates at every length.
for (const length of [0, 1, 9, 10, 11, 31, 32, 33, 63, 64, 65]) for (const shape of [0, 1, 2, 3]) {
  const input: number[] = [];
  for (let i = 0; i < length; i++) input.push(shape === 0 ? Math.floor(i * 6 / length) : shape === 1 ? 5 - Math.floor(i * 6 / length) : shape === 2 ? 1 : (i * 7 + length) % 6);
  inputs.push(input);
}
for (const sample of inputs) {
  const original: SortRecord[] = sample.map((key, position) => ({ major: Math.floor(key / 3), minor: key % 3, id: "row-" + position, position }));
  const values: SortRecord[] = original.slice(), secondary: number[] = [], primary: number[] = [];
  for (const key of [0, 1, 2]) for (let i = 0; i < sample.length; i++) if (sample[i] % 3 === key) secondary.push(i);
  for (const key of [0, 1, 2, 3, 4, 5]) for (let i = 0; i < sample.length; i++) if (sample[i] === key) primary.push(i);
  const first = inserted(values, (a, b) => a.minor - b.minor);
  assert.sameValue(first, values); observe(first, original, secondary);
  const result = inserted(values, (a, b) => a.major - b.major);
  assert.sameValue(result, values); observe(result, original, primary);
}
