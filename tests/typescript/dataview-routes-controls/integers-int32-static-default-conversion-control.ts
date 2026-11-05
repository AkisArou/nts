/*---
description: "setInt32 uses big endian by default and wraps at both signed limits while truncating fractions and clearing nonfinite inputs. (control)"
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-class, ts-class-fields, ts-static, ts-readonly, ts-tuples, ts-destructuring]
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
function localSetInt32(bytes: number[], offset: number, value: number, little = false): void { localSet(bytes, offset, value, 4, little); }
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
function localGetInt32(bytes: number[], offset: number, little = false): number { return localGet(bytes, offset, 4, true, little); }
// setInt32 uses big endian by default and wraps at both signed limits while truncating fractions and clearing nonfinite inputs. Route: a static View field. Node prints integers-int32-static-default-conversion:ok.
type View = number[];
class WordSlot { static view: View = localDataView(localArrayBuffer(4)); }
const rows: readonly [number, number, readonly number[]][] = [
  [-2147483649, 2147483647, [127, 255, 255, 255]], [-2147483648, -2147483648, [128, 0, 0, 0]],
  [2147483647, 2147483647, [127, 255, 255, 255]], [2147483648, -2147483648, [128, 0, 0, 0]],
  [4294967295, -1, [255, 255, 255, 255]], [4294967296, 0, [0, 0, 0, 0]], [4294967297, 1, [0, 0, 0, 1]],
  [-1.9, -1, [255, 255, 255, 255]], [-0.9, 0, [0, 0, 0, 0]],
  [NaN, 0, [0, 0, 0, 0]], [Infinity, 0, [0, 0, 0, 0]], [-Infinity, 0, [0, 0, 0, 0]]
];
for (const [value, expected, expectedBytes] of rows) {
  for (let i = 0; i < 4; i++) localSetUint8(WordSlot.view, i, 165);
  localSetInt32(WordSlot.view, 0, value);
  const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = localGetUint8(WordSlot.view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(localGetInt32(WordSlot.view, 0), expected);
}
console.log("integers-int32-static-default-conversion:ok");
