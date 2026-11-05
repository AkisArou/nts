/*---
description: "BigUint64 explicit byte orders preserve full unsigned magnitudes and modulo results with exact independent bytes. (control)"
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-generics, ts-generic-constraints, ts-unions, ts-objects, ts-typeof-operator, ts-narrowing, ts-readonly, ts-tuples, ts-destructuring]
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
function localSetBigUint64(bytes: number[], offset: number, value: bigint, little = false): void { localBigSet(bytes, offset, value, little); }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
function localGetBigUint64(bytes: number[], offset: number, little = false): bigint { return localBigGet(bytes, offset, false, little); }
// BigUint64 explicit byte orders preserve full unsigned magnitudes and modulo results with exact independent bytes. Route: a constrained byte-order helper at boolean and record type arguments. Node prints bigints-uint64-generic-explicit-endian:ok.
type View = number[];
function check<T extends boolean | { little: boolean }>(input: T, value: bigint, expected: bigint, expectedBytes: readonly number[]): void {
  const little = typeof input === "boolean" ? input : input.little, view: View = localDataView(localArrayBuffer(8));
  for (let i = 0; i < 8; i++) localSetUint8(view, i, 165); localSetBigUint64(view, 0, value, little);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(localGetBigUint64(view, 0, little), expected);
}
const rows: readonly [bigint, bigint, readonly number[], readonly number[]][] = [
  [0x123456789abcdefn, 0x123456789abcdefn, [1, 35, 69, 103, 137, 171, 205, 239], [239, 205, 171, 137, 103, 69, 35, 1]],
  [0x89abcdef01234567n, 0x89abcdef01234567n, [137, 171, 205, 239, 1, 35, 69, 103], [103, 69, 35, 1, 239, 205, 171, 137]],
  [-0x2n, 0xfffffffffffffffen, [255, 255, 255, 255, 255, 255, 255, 254], [254, 255, 255, 255, 255, 255, 255, 255]],
  [0x10000000000000000n, 0x0n, [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]],
  [0x10000000000000001n, 0x1n, [0, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 0, 0]]
];
for (const [value, expected, big, little] of rows) for (const order of [false, true]) {
  check<boolean>(order, value, expected, order ? little : big);
  check<{ little: boolean }>({ little: order }, value, expected, order ? little : big);
}
console.log("bigints-uint64-generic-explicit-endian:ok");
