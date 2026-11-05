/*---
description: "Omitted endian arguments write big endian bytes at both floating widths through declared callback fields. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
const localFloat32: readonly [number, number, readonly number[]][] = [
  [0.1, 0.10000000149011612, [61, 204, 204, 205]],
  [-2.5, -2.5, [192, 32, 0, 0]],
];
function localSetFloat32(bytes: number[], offset: number, value: number, little: boolean = false): void {
  for (const entry of localFloat32) if (Object.is(value, entry[0])) {
    for (let i = 0; i < 4; i++) bytes[offset + i] = entry[2][little ? 3 - i : i]; return;
  }
  throw new RangeError("unlisted float input");
}
const localFloat64: readonly [number, number, readonly number[]][] = [
  [0.1, 0.1, [63, 185, 153, 153, 153, 153, 153, 154]],
  [-2.5, -2.5, [192, 4, 0, 0, 0, 0, 0, 0]],
];
function localSetFloat64(bytes: number[], offset: number, value: number, little: boolean = false): void {
  for (const entry of localFloat64) if (Object.is(value, entry[0])) {
    for (let i = 0; i < 8; i++) bytes[offset + i] = entry[2][little ? 7 - i : i]; return;
  }
  throw new RangeError("unlisted float input");
}
// Omitted endian arguments write big endian bytes at both floating widths; route: declared callback fields. Node prints floats-default-orders-callback-fields:ok.
type View = number[];
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGetUint8(view, i); return result;
}
class DefaultWriters {
  narrow: (view: View, value: number) => void = (view, value) => localSetFloat32(view, 1, value);
  wide: (view: View, value: number) => void = (view, value) => localSetFloat64(view, 1, value);
}
const writers: DefaultWriters = new DefaultWriters();
const plans: readonly [number, readonly number[], readonly number[]][] = [
  [0.1, [0, 61, 204, 204, 205, 0], [0, 63, 185, 153, 153, 153, 153, 153, 154, 0]],
  [-2.5, [0, 192, 32, 0, 0, 0], [0, 192, 4, 0, 0, 0, 0, 0, 0, 0]],
];
for (const [value, expected32, expected64] of plans) {
  const narrow: View = localDataView(localArrayBuffer(6)), wide: View = localDataView(localArrayBuffer(10));
  writers.narrow(narrow, value); writers.wide(wide, value);
  assert.compareArray(readBytes(narrow), expected32);
  assert.compareArray(readBytes(wide), expected64);
}
console.log("floats-default-orders-callback-fields:ok");
