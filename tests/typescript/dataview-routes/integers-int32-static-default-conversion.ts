/*---
description: "setInt32 uses big endian by default and wraps at both signed limits while truncating fractions and clearing nonfinite inputs."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-class, ts-class-fields, ts-static, ts-readonly, ts-tuples, ts-destructuring]
---*/

// setInt32 uses big endian by default and wraps at both signed limits while truncating fractions and clearing nonfinite inputs. Route: a static View field. Node prints integers-int32-static-default-conversion:ok.
type View = DataView;
class WordSlot { static view: View = new DataView(new ArrayBuffer(4)); }
const rows: readonly [number, number, readonly number[]][] = [
  [-2147483649, 2147483647, [127, 255, 255, 255]], [-2147483648, -2147483648, [128, 0, 0, 0]],
  [2147483647, 2147483647, [127, 255, 255, 255]], [2147483648, -2147483648, [128, 0, 0, 0]],
  [4294967295, -1, [255, 255, 255, 255]], [4294967296, 0, [0, 0, 0, 0]], [4294967297, 1, [0, 0, 0, 1]],
  [-1.9, -1, [255, 255, 255, 255]], [-0.9, 0, [0, 0, 0, 0]],
  [NaN, 0, [0, 0, 0, 0]], [Infinity, 0, [0, 0, 0, 0]], [-Infinity, 0, [0, 0, 0, 0]]
];
for (const [value, expected, expectedBytes] of rows) {
  for (let i = 0; i < 4; i++) WordSlot.view.setUint8(i, 165);
  WordSlot.view.setInt32(0, value);
  const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = WordSlot.view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(WordSlot.view.getInt32(0), expected);
}
console.log("integers-int32-static-default-conversion:ok");
