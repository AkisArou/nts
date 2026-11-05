/*---
description: "Omitted endian arguments write big endian bytes at both floating widths through declared callback fields."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields]
---*/

// Omitted endian arguments write big endian bytes at both floating widths; route: declared callback fields. Node prints floats-default-orders-callback-fields:ok.
type View = DataView;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
class DefaultWriters {
  narrow: (view: View, value: number) => void = (view, value) => view.setFloat32(1, value);
  wide: (view: View, value: number) => void = (view, value) => view.setFloat64(1, value);
}
const writers: DefaultWriters = new DefaultWriters();
const plans: readonly [number, readonly number[], readonly number[]][] = [
  [0.1, [0, 61, 204, 204, 205, 0], [0, 63, 185, 153, 153, 153, 153, 153, 154, 0]],
  [-2.5, [0, 192, 32, 0, 0, 0], [0, 192, 4, 0, 0, 0, 0, 0, 0, 0]],
];
for (const [value, expected32, expected64] of plans) {
  const narrow: View = new DataView(new ArrayBuffer(6)), wide: View = new DataView(new ArrayBuffer(10));
  writers.narrow(narrow, value); writers.wide(wide, value);
  assert.compareArray(readBytes(narrow), expected32);
  assert.compareArray(readBytes(wide), expected64);
}
console.log("floats-default-orders-callback-fields:ok");
