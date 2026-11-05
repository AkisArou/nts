/*---
description: "setInt8 truncates and wraps finite values and stores nonfinite values as zero, with exact signed reads and bytes. (control)"
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-class, ts-class-fields, ts-readonly, ts-tuples, ts-destructuring]
---*/

function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localGet(bytes: number[], offset: number, width: number, signed: boolean, little = false): number {
  offset -= offset % 1; let value = 0; for (let i = 0; i < width; i++) value = value * 256 + bytes[offset + (little ? width - 1 - i : i)];
  return signed && value >= 256 ** width / 2 ? value - 256 ** width : value;
}
function localSet(bytes: number[], offset: number, value: number, width: number, little = false): void {
  offset -= offset % 1; const modulus = 256 ** width; if (value !== value || value === Infinity || value === -Infinity) value = 0;
  value -= value % 1; value = (value % modulus + modulus) % modulus;
  for (let i = 0; i < width; i++) { bytes[offset + (little ? i : width - 1 - i)] = value % 256; value = (value - value % 256) / 256; }
}
function localSetUint8(bytes: number[], offset: number, value: number): void { localSet(bytes, offset, value, 1); }
function localSetInt8(bytes: number[], offset: number, value: number): void { localSet(bytes, offset, value, 1); }
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
function localGetInt8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, true); }
// setInt8 truncates and wraps finite values and stores nonfinite values as zero, with exact signed reads and bytes. Route: a public View field. Node prints integers-int8-public-conversion:ok.
type View = number[];
class ByteSlot { view: View = localDataView(localArrayBuffer(1)); }
const rows: readonly [number, number, readonly number[]][] = [
  [-129, 127, [127]], [-128, -128, [128]], [127, 127, [127]], [128, -128, [128]],
  [255, -1, [255]], [256, 0, [0]], [-1.9, -1, [255]], [-0.9, 0, [0]],
  [NaN, 0, [0]], [Infinity, 0, [0]], [-Infinity, 0, [0]]
];
for (const [value, expected, expectedBytes] of rows) {
  const slot = new ByteSlot(); localSetUint8(slot.view, 0, 165); localSetInt8(slot.view, 0, value);
  const bytes: number[] = []; for (let i = 0; i < 1; i++) bytes[i] = localGetUint8(slot.view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(localGetInt8(slot.view, 0), expected);
}
console.log("integers-int8-public-conversion:ok");
