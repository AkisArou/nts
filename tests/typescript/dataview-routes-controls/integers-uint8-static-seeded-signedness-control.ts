/*---
description: "Uint8 reads retain each seeded high bit as an unsigned value while Int8 reads give the corresponding signed values. (control)"
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
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
function localGetInt8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, true); }
// Uint8 reads retain each seeded high bit as an unsigned value while Int8 reads give the corresponding signed values. Route: a static View field reused across different byte populations. Node prints integers-uint8-static-seeded-signedness:ok.
type View = number[];
class ByteBank { static view: View = localDataView(localArrayBuffer(4)); }
const rows: readonly [readonly number[], readonly number[]][] = [
  [[0, 1, 128, 255], [0, 1, -128, -1]], [[127, 129, 254, 42], [127, -127, -2, 42]]
];
for (const [seed, signed] of rows) {
  for (let i = 0; i < 4; i++) localSetUint8(ByteBank.view, i, seed[i]);
  const unsigned: number[] = [], actualSigned: number[] = [];
  for (let i = 0; i < 4; i++) { unsigned[i] = localGetUint8(ByteBank.view, i); actualSigned[i] = localGetInt8(ByteBank.view, i); }
  assert.compareArray(unsigned, seed); assert.compareArray(actualSigned, signed);
}
console.log("integers-uint8-static-seeded-signedness:ok");
