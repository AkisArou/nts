/*---
description: "BigInt64 reads both byte orders directly from asymmetric seed bytes and preserves full signed precision."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-generics, ts-generic-constraints, ts-interfaces, ts-objects, ts-strings, ts-readonly, ts-tuples, ts-destructuring]
---*/

// BigInt64 reads both byte orders directly from asymmetric seed bytes and preserves full signed precision. Route: a constrained helper instantiated with plain and named byte records. Node prints bigints-int64-generic-seeded-endian:ok.
type View = DataView;
interface RawWide { bytes: readonly number[]; }
interface NamedWide extends RawWide { label: string; }
function check<T extends RawWide>(input: T, expected: readonly bigint[]): void {
  const view: View = new DataView(new ArrayBuffer(8)); for (let i = 0; i < 8; i++) view.setUint8(i, input.bytes[i]);
  const actual: bigint[] = [view.getBigInt64(0, false), view.getBigInt64(0, true)];
  assert.compareArray(actual, expected);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = view.getUint8(i); assert.compareArray(bytes, input.bytes);
}
const rows: readonly [readonly number[], readonly bigint[]][] = [
  [[1, 35, 69, 103, 137, 171, 205, 239], [0x123456789abcdefn, -0x1032547698badcffn]],
  [[128, 0, 0, 0, 0, 0, 0, 1], [-0x7fffffffffffffffn, 0x100000000000080n]],
  [[1, 0, 0, 0, 0, 0, 0, 128], [0x100000000000080n, -0x7fffffffffffffffn]],
  [[255, 255, 255, 255, 255, 255, 255, 254], [-0x2n, -0x100000000000001n]]
];
for (const [bytes, expected] of rows) { check<RawWide>({ bytes }, expected); check<NamedWide>({ bytes, label: "wide" }, expected); }
console.log("bigints-int64-generic-seeded-endian:ok");
