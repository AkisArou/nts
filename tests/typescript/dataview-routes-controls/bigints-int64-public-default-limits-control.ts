/*---
description: "BigInt64 default byte order is big endian and signed-limit inputs wrap with exact bytes and signed results. (control)"
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-class, ts-class-fields, ts-readonly, ts-tuples, ts-destructuring]
---*/

function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localIndex(bytes: number[], offset: number): number {
  if (offset === Infinity || offset === -Infinity) throw new RangeError(); offset = offset !== offset ? 0 : offset - offset % 1;
  if (offset < 0 || offset + 8 > bytes.length) throw new RangeError(); return offset;
}
function localBigGet(bytes: number[], offset: number, signed: boolean, little = false): bigint {
  offset = localIndex(bytes, offset); let value = 0n; for (let i = 0; i < 8; i++) value = value * 256n + BigInt(bytes[offset + (little ? 7 - i : i)]);
  return signed && value >= 0x8000000000000000n ? value - 0x10000000000000000n : value;
}
function localBigSet(bytes: number[], offset: number, value: bigint, little = false): void {
  offset = localIndex(bytes, offset); const modulus = 0x10000000000000000n; value = (value % modulus + modulus) % modulus;
  for (let i = 0; i < 8; i++) { bytes[offset + (little ? i : 7 - i)] = Number(value % 256n); value /= 256n; }
}
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
function localSetBigInt64(bytes: number[], offset: number, value: bigint, little = false): void { localBigSet(bytes, offset, value, little); }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
function localGetBigInt64(bytes: number[], offset: number, little = false): bigint { return localBigGet(bytes, offset, true, little); }
// BigInt64 default byte order is big endian and signed-limit inputs wrap with exact bytes and signed results. Route: a public View field. Node prints bigints-int64-public-default-limits:ok.
type View = number[];
class WideSlot { view: View = localDataView(localArrayBuffer(8)); }
const rows: readonly [bigint, bigint, readonly number[]][] = [
  [-0x8000000000000001n, 0x7fffffffffffffffn, [127, 255, 255, 255, 255, 255, 255, 255]],
  [-0x8000000000000000n, -0x8000000000000000n, [128, 0, 0, 0, 0, 0, 0, 0]],
  [-0x7fffffffffffffffn, -0x7fffffffffffffffn, [128, 0, 0, 0, 0, 0, 0, 1]],
  [-0x1n, -0x1n, [255, 255, 255, 255, 255, 255, 255, 255]],
  [0x0n, 0x0n, [0, 0, 0, 0, 0, 0, 0, 0]],
  [0x1n, 0x1n, [0, 0, 0, 0, 0, 0, 0, 1]],
  [0x7fffffffffffffffn, 0x7fffffffffffffffn, [127, 255, 255, 255, 255, 255, 255, 255]],
  [0x8000000000000000n, -0x8000000000000000n, [128, 0, 0, 0, 0, 0, 0, 0]],
  [0x8000000000000001n, -0x7fffffffffffffffn, [128, 0, 0, 0, 0, 0, 0, 1]]
];
for (const [value, expected, expectedBytes] of rows) {
  const slot = new WideSlot(); for (let i = 0; i < 8; i++) localSetUint8(slot.view, i, 165);
  localSetBigInt64(slot.view, 0, value);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = localGetUint8(slot.view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(localGetBigInt64(slot.view, 0), expected);
}
console.log("bigints-int64-public-default-limits:ok");
