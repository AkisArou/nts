/*---
description: "The same seeded four bytes yield exact unsigned and signed results under both Uint32 byte orders without a matching-width setter. (control)"
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
function localGetUint32(bytes: number[], offset: number, little = false): number { return localGet(bytes, offset, 4, false, little); }
function localGetInt32(bytes: number[], offset: number, little = false): number { return localGet(bytes, offset, 4, true, little); }
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
// The same seeded four bytes yield exact unsigned and signed results under both Uint32 byte orders without a matching-width setter. Route: readonly byte populations and independent result tuples. Node prints integers-uint32-readonly-seeded-endian:ok.
type View = number[];
const rows: readonly [readonly number[], readonly number[]][] = [
  [[137, 171, 205, 239], [2309737967, 4023233417, -1985229329, -271733879]],
  [[128, 0, 0, 1], [2147483649, 16777344, -2147483647, 16777344]],
  [[1, 0, 0, 128], [16777344, 2147483649, 16777344, -2147483647]],
  [[255, 255, 255, 254], [4294967294, 4278190079, -2, -16777217]]
];
for (const [seed, expected] of rows) {
  const view: View = localDataView(localArrayBuffer(4)); for (let i = 0; i < 4; i++) localSetUint8(view, i, seed[i]);
  const actual: number[] = [localGetUint32(view, 0, false), localGetUint32(view, 0, true), localGetInt32(view, 0, false), localGetInt32(view, 0, true)];
  assert.compareArray(actual, expected);
  const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = localGetUint8(view, i); assert.compareArray(bytes, seed);
}
console.log("integers-uint32-readonly-seeded-endian:ok");
