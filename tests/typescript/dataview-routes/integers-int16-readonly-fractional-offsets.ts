/*---
description: "Int16 fractional offsets truncate before little-endian access at the first, middle and last fitting positions."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Int16 fractional offsets truncate before little-endian access at the first, middle and last fitting positions. Route: readonly offset and value tuples. Node prints integers-int16-readonly-fractional-offsets:ok.
type View = DataView;
const rows: readonly [number, number, readonly number[]][] = [
  [-0.9, 4660, [52, 18, 0, 0, 0, 0]], [1.9, -2, [0, 254, 255, 0, 0, 0]],
  [2.9, 32767, [0, 0, 255, 127, 0, 0]], [4.9, -32768, [0, 0, 0, 0, 0, 128]]
];
for (const [offset, value, expectedBytes] of rows) {
  const view: View = new DataView(new ArrayBuffer(6)); view.setInt16(offset, value, true);
  const bytes: number[] = []; for (let i = 0; i < 6; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(view.getInt16(offset, true), value);
}
console.log("integers-int16-readonly-fractional-offsets:ok");
