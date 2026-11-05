/*---
description: "BigInt64 discards complete sixty-four-bit multiples before signed interpretation, including values immediately around each multiple."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-readonly, ts-tuples, ts-destructuring]
---*/

// BigInt64 discards complete sixty-four-bit multiples before signed interpretation, including values immediately around each multiple. Route: readonly bigint input and expected-byte tuples. Node prints bigints-int64-readonly-modulo:ok.
type View = DataView;
const rows: readonly [bigint, bigint, readonly number[]][] = [
  [-0x10000000000000001n, -0x1n, [255, 255, 255, 255, 255, 255, 255, 255]],
  [-0x10000000000000000n, 0x0n, [0, 0, 0, 0, 0, 0, 0, 0]],
  [-0xffffffffffffffffn, 0x1n, [0, 0, 0, 0, 0, 0, 0, 1]],
  [0xffffffffffffffffn, -0x1n, [255, 255, 255, 255, 255, 255, 255, 255]],
  [0x10000000000000000n, 0x0n, [0, 0, 0, 0, 0, 0, 0, 0]],
  [0x10000000000000001n, 0x1n, [0, 0, 0, 0, 0, 0, 0, 1]],
  [0x20000000000001234n, 0x1234n, [0, 0, 0, 0, 0, 0, 18, 52]],
  [-0x20000000000000002n, -0x2n, [255, 255, 255, 255, 255, 255, 255, 254]]
];
for (const [value, expected, expectedBytes] of rows) {
  const view: View = new DataView(new ArrayBuffer(8)); for (let i = 0; i < 8; i++) view.setUint8(i, 165);
  view.setBigInt64(0, value, false);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(view.getBigInt64(0, false), expected);
}
console.log("bigints-int64-readonly-modulo:ok");
