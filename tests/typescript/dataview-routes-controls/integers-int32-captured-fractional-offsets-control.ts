/*---
description: "Int32 access truncates reassigned fractional offsets and writes exact big-endian bytes at the first, middle and last fitting positions. (control)"
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-closures, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring]
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
function localSetInt32(bytes: number[], offset: number, value: number, little = false): void { localSet(bytes, offset, value, 4, little); }
function localGetInt32(bytes: number[], offset: number, little = false): number { return localGet(bytes, offset, 4, true, little); }
function localSetUint8(bytes: number[], offset: number, value: number): void { localSet(bytes, offset, value, 1); }
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
// Int32 access truncates reassigned fractional offsets and writes exact big-endian bytes at the first, middle and last fitting positions. Route: offset and value lets shared by writer and reader closures. Node prints integers-int32-captured-fractional-offsets:ok.
type View = number[];
const view: View = localDataView(localArrayBuffer(8)); let offset = 0, value = 0;
const write: () => void = () => { localSetInt32(view, offset, value, false); };
const read: () => number = () => localGetInt32(view, offset, false);
const rows: readonly [number, number, readonly number[]][] = [
  [-0.9, 305419896, [18, 52, 86, 120, 0, 0, 0, 0]],
  [1.9, -2147483647, [0, 128, 0, 0, 1, 0, 0, 0]],
  [4.9, 2147483647, [0, 0, 0, 0, 127, 255, 255, 255]]
];
for (const [nextOffset, nextValue, expectedBytes] of rows) {
  offset = nextOffset; value = nextValue; for (let i = 0; i < 8; i++) localSetUint8(view, i, 0);
  write(); const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(read(), value);
}
console.log("integers-int32-captured-fractional-offsets:ok");
