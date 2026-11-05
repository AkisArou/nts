/*---
description: "BigInt64 explicit false and true byte orders preserve signed wide values and emit independent exact byte sequences. (control)"
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-class, ts-class-fields, ts-static, ts-readonly, ts-tuples, ts-destructuring]
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
// BigInt64 explicit false and true byte orders preserve signed wide values and emit independent exact byte sequences. Route: a static View field. Node prints bigints-int64-static-explicit-endian:ok.
type View = number[];
class WideSlot { static view: View = localDataView(localArrayBuffer(8)); }
const rows: readonly [bigint, bigint, readonly number[], readonly number[]][] = [
  [0x123456789abcdefn, 0x123456789abcdefn, [1, 35, 69, 103, 137, 171, 205, 239], [239, 205, 171, 137, 103, 69, 35, 1]],
  [-0x123456789abcdefn, -0x123456789abcdefn, [254, 220, 186, 152, 118, 84, 50, 17], [17, 50, 84, 118, 152, 186, 220, 254]],
  [-0x8000000000000000n, -0x8000000000000000n, [128, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 128]],
  [0x8000000000000001n, -0x7fffffffffffffffn, [128, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 0, 128]],
  [0x10000000000000001n, 0x1n, [0, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 0, 0]]
];
for (const [value, expected, big, little] of rows) for (const order of [false, true]) {
  for (let i = 0; i < 8; i++) localSetUint8(WideSlot.view, i, 165);
  localSetBigInt64(WideSlot.view, 0, value, order);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = localGetUint8(WideSlot.view, i);
  assert.compareArray(bytes, order ? little : big); assert.sameValue(localGetBigInt64(WideSlot.view, 0, order), expected);
}
console.log("bigints-int64-static-explicit-endian:ok");
