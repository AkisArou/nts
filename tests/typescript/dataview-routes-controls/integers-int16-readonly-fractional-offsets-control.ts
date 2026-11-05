/*---
description: "Int16 fractional offsets truncate before little-endian access at the first, middle and last fitting positions. (control)"
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
function localSetInt16(bytes: number[], offset: number, value: number, little = false): void { localSet(bytes, offset, value, 2, little); }
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
function localGetInt16(bytes: number[], offset: number, little = false): number { return localGet(bytes, offset, 2, true, little); }
// Int16 fractional offsets truncate before little-endian access at the first, middle and last fitting positions. Route: readonly offset and value tuples. Node prints integers-int16-readonly-fractional-offsets:ok.
type View = number[];
const rows: readonly [number, number, readonly number[]][] = [
  [-0.9, 4660, [52, 18, 0, 0, 0, 0]], [1.9, -2, [0, 254, 255, 0, 0, 0]],
  [2.9, 32767, [0, 0, 255, 127, 0, 0]], [4.9, -32768, [0, 0, 0, 0, 0, 128]]
];
for (const [offset, value, expectedBytes] of rows) {
  const view: View = localDataView(localArrayBuffer(6)); localSetInt16(view, offset, value, true);
  const bytes: number[] = []; for (let i = 0; i < 6; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(localGetInt16(view, offset, true), value);
}
console.log("integers-int16-readonly-fractional-offsets:ok");
