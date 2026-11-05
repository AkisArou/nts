/*---
description: "setUint32 uses big endian by default and wraps wide or negative values while truncating fractions and clearing nonfinite inputs."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-map-set, ts-strings, ts-narrowing, ts-errors, ts-readonly, ts-tuples, ts-destructuring]
---*/

// setUint32 uses big endian by default and wraps wide or negative values while truncating fractions and clearing nonfinite inputs. Route: a View retrieved through guarded Map.get. Node prints integers-uint32-map-default-conversion:ok.
type View = DataView;
const views: Map<string, View> = new Map([["word", new DataView(new ArrayBuffer(4))]]);
const rows: readonly [number, number, readonly number[]][] = [
  [-4294967297, 4294967295, [255, 255, 255, 255]], [-1, 4294967295, [255, 255, 255, 255]],
  [2147483648, 2147483648, [128, 0, 0, 0]], [4294967295, 4294967295, [255, 255, 255, 255]],
  [4294967296, 0, [0, 0, 0, 0]], [4294967297, 1, [0, 0, 0, 1]],
  [-1.9, 4294967295, [255, 255, 255, 255]], [305419896.9, 305419896, [18, 52, 86, 120]], [-0.9, 0, [0, 0, 0, 0]],
  [NaN, 0, [0, 0, 0, 0]], [Infinity, 0, [0, 0, 0, 0]], [-Infinity, 0, [0, 0, 0, 0]]
];
for (const [value, expected, expectedBytes] of rows) {
  const view = views.get("word"); if (view === undefined) throw new Error("missing view");
  for (let i = 0; i < 4; i++) view.setUint8(i, 165);
  view.setUint32(0, value);
  const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(view.getUint32(0), expected);
}
console.log("integers-uint32-map-default-conversion:ok");
