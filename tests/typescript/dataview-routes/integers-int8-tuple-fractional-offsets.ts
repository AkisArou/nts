/*---
description: "Int8 offsets truncate toward zero at the first, middle and last fitting byte without changing neighboring bytes."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Int8 offsets truncate toward zero at the first, middle and last fitting byte without changing neighboring bytes. Route: readonly tuples carrying offsets and signed values. Node prints integers-int8-tuple-fractional-offsets:ok.
type View = DataView;
const rows: readonly [number, number, readonly number[]][] = [
  [-0.9, -7, [249, 0, 0, 0]], [0.9, 127, [127, 0, 0, 0]],
  [1.9, -128, [0, 128, 0, 0]], [3.9, -1, [0, 0, 0, 255]]
];
for (const [offset, value, expectedBytes] of rows) {
  const view: View = new DataView(new ArrayBuffer(4)); view.setInt8(offset, value);
  const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(view.getInt8(offset), value);
}
console.log("integers-int8-tuple-fractional-offsets:ok");
