/*---
description: "setUint16 uses big endian by default after truncation and modulo conversion, including one-past limits and nonfinite zeroes. (control)"
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
function localSetUint8(bytes: number[], offset: number, value: number): void { localSet(bytes, offset, value, 1); }
function localSetUint16(bytes: number[], offset: number, value: number, little = false): void { localSet(bytes, offset, value, 2, little); }
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
function localGetUint16(bytes: number[], offset: number, little = false): number { return localGet(bytes, offset, 2, false, little); }
// setUint16 uses big endian by default after truncation and modulo conversion, including one-past limits and nonfinite zeroes. Route: readonly tuples of numeric inputs and independent expected bytes. Node prints integers-uint16-readonly-default-conversion:ok.
type View = number[];
const rows: readonly [number, number, readonly number[]][] = [
  [-65537, 65535, [255, 255]], [-1, 65535, [255, 255]], [0, 0, [0, 0]],
  [32768, 32768, [128, 0]], [65535, 65535, [255, 255]], [65536, 0, [0, 0]], [65537, 1, [0, 1]],
  [-1.9, 65535, [255, 255]], [4660.9, 4660, [18, 52]], [-0.9, 0, [0, 0]],
  [NaN, 0, [0, 0]], [Infinity, 0, [0, 0]], [-Infinity, 0, [0, 0]]
];
for (const [value, expected, expectedBytes] of rows) {
  const view: View = localDataView(localArrayBuffer(2)); for (let i = 0; i < 2; i++) localSetUint8(view, i, 165);
  localSetUint16(view, 0, value);
  const bytes: number[] = []; for (let i = 0; i < 2; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(localGetUint16(view, 0), expected);
}
console.log("integers-uint16-readonly-default-conversion:ok");
