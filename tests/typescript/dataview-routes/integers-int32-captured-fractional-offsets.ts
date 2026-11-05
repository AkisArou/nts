/*---
description: "Int32 access truncates reassigned fractional offsets and writes exact big-endian bytes at the first, middle and last fitting positions."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-closures, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Int32 access truncates reassigned fractional offsets and writes exact big-endian bytes at the first, middle and last fitting positions. Route: offset and value lets shared by writer and reader closures. Node prints integers-int32-captured-fractional-offsets:ok.
type View = DataView;
const view: View = new DataView(new ArrayBuffer(8)); let offset = 0, value = 0;
const write: () => void = () => { view.setInt32(offset, value, false); };
const read: () => number = () => view.getInt32(offset, false);
const rows: readonly [number, number, readonly number[]][] = [
  [-0.9, 305419896, [18, 52, 86, 120, 0, 0, 0, 0]],
  [1.9, -2147483647, [0, 128, 0, 0, 1, 0, 0, 0]],
  [4.9, 2147483647, [0, 0, 0, 0, 127, 255, 255, 255]]
];
for (const [nextOffset, nextValue, expectedBytes] of rows) {
  offset = nextOffset; value = nextValue; for (let i = 0; i < 8; i++) view.setUint8(i, 0);
  write(); const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(read(), value);
}
console.log("integers-int32-captured-fractional-offsets:ok");
