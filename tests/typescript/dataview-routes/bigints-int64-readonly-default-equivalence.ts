/*---
description: "Omitted and explicit false byte order produce the same independent BigInt64 bytes and signed values in adjacent words."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Omitted and explicit false byte order produce the same independent BigInt64 bytes and signed values in adjacent words. Route: readonly bigint and expected-byte tuples. Node prints bigints-int64-readonly-default-equivalence:ok.
type View = DataView;
const rows: readonly [bigint, bigint, readonly number[]][] = [
  [0x123456789abcdefn, 0x123456789abcdefn, [1, 35, 69, 103, 137, 171, 205, 239, 1, 35, 69, 103, 137, 171, 205, 239]],
  [-0x8000000000000000n, -0x8000000000000000n, [128, 0, 0, 0, 0, 0, 0, 0, 128, 0, 0, 0, 0, 0, 0, 0]],
  [-0x1n, -0x1n, [255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]],
  [0x10000000000000001n, 0x1n, [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]]
];
for (const [value, expected, expectedBytes] of rows) {
  const view: View = new DataView(new ArrayBuffer(16)); for (let i = 0; i < 16; i++) view.setUint8(i, 165);
  view.setBigInt64(0, value); view.setBigInt64(8, value, false);
  const bytes: number[] = []; for (let i = 0; i < 16; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(view.getBigInt64(0), expected); assert.sameValue(view.getBigInt64(8, false), expected);
}
console.log("bigints-int64-readonly-default-equivalence:ok");
