/*---
description: Stable insertion sort over a copy controls Uint8Array default toSorted through a typed map.
features: [ts-sort-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-map-set, ts-strings]
---*/
// Uint8Array crosses a typed map; node uses numeric order, and leaves its source unchanged.
// Control: stable insertion sort on a copy, then copy back only for sort.
function compare(a: number, b: number): number { return a < b ? -1 : a > b ? 1 : 0; }
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
  const storage = new Map<string, Uint8Array>();
  storage.set("values", new Uint8Array(sample));
  const view = storage.get("values");
  if (view === undefined) throw new Error("missing values");
  const copy = Array.from(view);
  for (let i = 1; i < copy.length; i++) {
    const value = copy[i]; let j = i;
    while (j > 0 && compare(copy[j - 1], value) > 0) { copy[j] = copy[j - 1]; j--; }
    copy[j] = value;
  }
  const result: Uint8Array = new Uint8Array(copy);
  assert.sameValue(result === view, false);
  assert.compareArray(Array.from(result), expected);
  assert.sameValue(result.buffer === view.buffer, false);
  assert.compareArray(Array.from(view), sample);
}
