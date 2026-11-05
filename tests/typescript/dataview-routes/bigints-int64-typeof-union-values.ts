/*---
description: "BigInt64 stores both narrowed bigint and record payloads with the same exact low bits and signed little-endian result."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-unions, ts-objects, ts-typeof-operator, ts-narrowing, ts-readonly, ts-tuples, ts-destructuring]
---*/

// BigInt64 stores both narrowed bigint and record payloads with the same exact low bits and signed little-endian result. Route: a bigint-or-record union narrowed by typeof. Node prints bigints-int64-typeof-union-values:ok.
type View = DataView;
function check(input: bigint | { value: bigint }, expected: bigint, expectedBytes: readonly number[]): void {
  const view: View = new DataView(new ArrayBuffer(8));
  if (typeof input === "bigint") view.setBigInt64(0, input, true); else view.setBigInt64(0, input.value, true);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(view.getBigInt64(0, true), expected);
}
const rows: readonly [bigint, bigint, readonly number[]][] = [
  [-0x8000000000000001n, 0x7fffffffffffffffn, [255, 255, 255, 255, 255, 255, 255, 127]],
  [0x8000000000000001n, -0x7fffffffffffffffn, [1, 0, 0, 0, 0, 0, 0, 128]],
  [0x123456789abcdefn, 0x123456789abcdefn, [239, 205, 171, 137, 103, 69, 35, 1]],
  [-0x10000000000000001n, -0x1n, [255, 255, 255, 255, 255, 255, 255, 255]]
];
for (const [value, expected, bytes] of rows) { check(value, expected, bytes); check({ value }, expected, bytes); }
console.log("bigints-int64-typeof-union-values:ok");
