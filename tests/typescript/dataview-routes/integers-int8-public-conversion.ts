/*---
description: "setInt8 truncates and wraps finite values and stores nonfinite values as zero, with exact signed reads and bytes."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-class, ts-class-fields, ts-readonly, ts-tuples, ts-destructuring]
---*/

// setInt8 truncates and wraps finite values and stores nonfinite values as zero, with exact signed reads and bytes. Route: a public View field. Node prints integers-int8-public-conversion:ok.
type View = DataView;
class ByteSlot { view: View = new DataView(new ArrayBuffer(1)); }
const rows: readonly [number, number, readonly number[]][] = [
  [-129, 127, [127]], [-128, -128, [128]], [127, 127, [127]], [128, -128, [128]],
  [255, -1, [255]], [256, 0, [0]], [-1.9, -1, [255]], [-0.9, 0, [0]],
  [NaN, 0, [0]], [Infinity, 0, [0]], [-Infinity, 0, [0]]
];
for (const [value, expected, expectedBytes] of rows) {
  const slot = new ByteSlot(); slot.view.setUint8(0, 165); slot.view.setInt8(0, value);
  const bytes: number[] = []; for (let i = 0; i < 1; i++) bytes[i] = slot.view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(slot.view.getInt8(0), expected);
}
console.log("integers-int8-public-conversion:ok");
