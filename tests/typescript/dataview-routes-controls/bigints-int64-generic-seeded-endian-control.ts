/*---
description: "BigInt64 reads both byte orders directly from asymmetric seed bytes and preserves full signed precision. (control)"
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-generics, ts-generic-constraints, ts-interfaces, ts-objects, ts-strings, ts-readonly, ts-tuples, ts-destructuring]
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
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
function localGetBigInt64(bytes: number[], offset: number, little = false): bigint { return localBigGet(bytes, offset, true, little); }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
// BigInt64 reads both byte orders directly from asymmetric seed bytes and preserves full signed precision. Route: a constrained helper instantiated with plain and named byte records. Node prints bigints-int64-generic-seeded-endian:ok.
type View = number[];
interface RawWide { bytes: readonly number[]; }
interface NamedWide extends RawWide { label: string; }
function check<T extends RawWide>(input: T, expected: readonly bigint[]): void {
  const view: View = localDataView(localArrayBuffer(8)); for (let i = 0; i < 8; i++) localSetUint8(view, i, input.bytes[i]);
  const actual: bigint[] = [localGetBigInt64(view, 0, false), localGetBigInt64(view, 0, true)];
  assert.compareArray(actual, expected);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = localGetUint8(view, i); assert.compareArray(bytes, input.bytes);
}
const rows: readonly [readonly number[], readonly bigint[]][] = [
  [[1, 35, 69, 103, 137, 171, 205, 239], [0x123456789abcdefn, -0x1032547698badcffn]],
  [[128, 0, 0, 0, 0, 0, 0, 1], [-0x7fffffffffffffffn, 0x100000000000080n]],
  [[1, 0, 0, 0, 0, 0, 0, 128], [0x100000000000080n, -0x7fffffffffffffffn]],
  [[255, 255, 255, 255, 255, 255, 255, 254], [-0x2n, -0x100000000000001n]]
];
for (const [bytes, expected] of rows) { check<RawWide>({ bytes }, expected); check<NamedWide>({ bytes, label: "wide" }, expected); }
console.log("bigints-int64-generic-seeded-endian:ok");
