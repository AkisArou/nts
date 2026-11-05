/*---
description: "The same seeded four bytes yield exact unsigned and signed results under both Uint32 byte orders without a matching-width setter."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-readonly, ts-tuples, ts-destructuring]
---*/

// The same seeded four bytes yield exact unsigned and signed results under both Uint32 byte orders without a matching-width setter. Route: readonly byte populations and independent result tuples. Node prints integers-uint32-readonly-seeded-endian:ok.
type View = DataView;
const rows: readonly [readonly number[], readonly number[]][] = [
  [[137, 171, 205, 239], [2309737967, 4023233417, -1985229329, -271733879]],
  [[128, 0, 0, 1], [2147483649, 16777344, -2147483647, 16777344]],
  [[1, 0, 0, 128], [16777344, 2147483649, 16777344, -2147483647]],
  [[255, 255, 255, 254], [4294967294, 4278190079, -2, -16777217]]
];
for (const [seed, expected] of rows) {
  const view: View = new DataView(new ArrayBuffer(4)); for (let i = 0; i < 4; i++) view.setUint8(i, seed[i]);
  const actual: number[] = [view.getUint32(0, false), view.getUint32(0, true), view.getInt32(0, false), view.getInt32(0, true)];
  assert.compareArray(actual, expected);
  const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = view.getUint8(i); assert.compareArray(bytes, seed);
}
console.log("integers-uint32-readonly-seeded-endian:ok");
