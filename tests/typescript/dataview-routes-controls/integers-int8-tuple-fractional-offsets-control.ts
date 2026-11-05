/*---
description: "Int8 offsets truncate toward zero at the first, middle and last fitting byte without changing neighboring bytes. (control)"
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-readonly, ts-tuples, ts-destructuring]
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
function localSetInt8(bytes: number[], offset: number, value: number): void { localSet(bytes, offset, value, 1); }
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
function localGetInt8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, true); }
// Int8 offsets truncate toward zero at the first, middle and last fitting byte without changing neighboring bytes. Route: readonly tuples carrying offsets and signed values. Node prints integers-int8-tuple-fractional-offsets:ok.
type View = number[];
const rows: readonly [number, number, readonly number[]][] = [
  [-0.9, -7, [249, 0, 0, 0]], [0.9, 127, [127, 0, 0, 0]],
  [1.9, -128, [0, 128, 0, 0]], [3.9, -1, [0, 0, 0, 255]]
];
for (const [offset, value, expectedBytes] of rows) {
  const view: View = localDataView(localArrayBuffer(4)); localSetInt8(view, offset, value);
  const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(localGetInt8(view, offset), value);
}
console.log("integers-int8-tuple-fractional-offsets:ok");
