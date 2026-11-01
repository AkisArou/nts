/*---
description: An interface-held record array retains original positions for every equal key.
features: [ts-sort-route-stability, ts-arrays, ts-numbers, ts-objects, ts-iteration, ts-arrow-functions, ts-strings, ts-interfaces, ts-functions, ts-function-types]
---*/
// Ranked records pass through an interface field and parameter; node returns that same array with equal-key identifiers in original order.
interface RankedRecord { key: number; id: string; position: number; }
interface RecordBatch { records: RankedRecord[]; }
function arrange(batch: RecordBatch): RankedRecord[] { return batch.records.sort((a, b) => a.key - b.key); }
const inputs: number[][] = [];
// Shapes are ordered, reversed, equal-key and interleaved duplicates at every length.
for (const length of [0, 1, 9, 10, 11, 31, 32, 33, 63, 64, 65]) for (const shape of [0, 1, 2, 3]) {
  const input: number[] = [];
  for (let i = 0; i < length; i++) input.push(shape === 0 ? Math.floor(i * 3 / length) : shape === 1 ? 2 - Math.floor(i * 3 / length) : shape === 2 ? 1 : (i * 7 + length) % 3);
  inputs.push(input);
}
for (const sample of inputs) {
  const original: RankedRecord[] = sample.map((key, position) => ({ key, id: "row-" + position, position }));
  const batch: RecordBatch = { records: original.slice() }, order: number[] = [];
  for (const key of [0, 1, 2]) for (let i = 0; i < sample.length; i++) if (sample[i] === key) order.push(i);
  const result = arrange(batch);
  assert.sameValue(result, batch.records);
  assert.compareArray(result, order.map(index => original[index]));
  assert.compareArray(result.map(item => item.id), order.map(index => "row-" + index));
  assert.compareArray(result.map(item => item.position), order);
}
