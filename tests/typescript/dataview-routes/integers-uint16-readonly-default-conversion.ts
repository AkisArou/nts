/*---
description: "setUint16 uses big endian by default after truncation and modulo conversion, including one-past limits and nonfinite zeroes."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-readonly, ts-tuples, ts-destructuring]
---*/

// setUint16 uses big endian by default after truncation and modulo conversion, including one-past limits and nonfinite zeroes. Route: readonly tuples of numeric inputs and independent expected bytes. Node prints integers-uint16-readonly-default-conversion:ok.
type View = DataView;
const rows: readonly [number, number, readonly number[]][] = [
  [-65537, 65535, [255, 255]], [-1, 65535, [255, 255]], [0, 0, [0, 0]],
  [32768, 32768, [128, 0]], [65535, 65535, [255, 255]], [65536, 0, [0, 0]], [65537, 1, [0, 1]],
  [-1.9, 65535, [255, 255]], [4660.9, 4660, [18, 52]], [-0.9, 0, [0, 0]],
  [NaN, 0, [0, 0]], [Infinity, 0, [0, 0]], [-Infinity, 0, [0, 0]]
];
for (const [value, expected, expectedBytes] of rows) {
  const view: View = new DataView(new ArrayBuffer(2)); for (let i = 0; i < 2; i++) view.setUint8(i, 165);
  view.setUint16(0, value);
  const bytes: number[] = []; for (let i = 0; i < 2; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(view.getUint16(0), expected);
}
console.log("integers-uint16-readonly-default-conversion:ok");
