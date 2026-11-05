/*---
description: "BigInt64 explicit false and true byte orders preserve signed wide values and emit independent exact byte sequences."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-class, ts-class-fields, ts-static, ts-readonly, ts-tuples, ts-destructuring]
---*/

// BigInt64 explicit false and true byte orders preserve signed wide values and emit independent exact byte sequences. Route: a static View field. Node prints bigints-int64-static-explicit-endian:ok.
type View = DataView;
class WideSlot { static view: View = new DataView(new ArrayBuffer(8)); }
const rows: readonly [bigint, bigint, readonly number[], readonly number[]][] = [
  [0x123456789abcdefn, 0x123456789abcdefn, [1, 35, 69, 103, 137, 171, 205, 239], [239, 205, 171, 137, 103, 69, 35, 1]],
  [-0x123456789abcdefn, -0x123456789abcdefn, [254, 220, 186, 152, 118, 84, 50, 17], [17, 50, 84, 118, 152, 186, 220, 254]],
  [-0x8000000000000000n, -0x8000000000000000n, [128, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 128]],
  [0x8000000000000001n, -0x7fffffffffffffffn, [128, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 0, 128]],
  [0x10000000000000001n, 0x1n, [0, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 0, 0]]
];
for (const [value, expected, big, little] of rows) for (const order of [false, true]) {
  for (let i = 0; i < 8; i++) WideSlot.view.setUint8(i, 165);
  WideSlot.view.setBigInt64(0, value, order);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = WideSlot.view.getUint8(i);
  assert.compareArray(bytes, order ? little : big); assert.sameValue(WideSlot.view.getBigInt64(0, order), expected);
}
console.log("bigints-int64-static-explicit-endian:ok");
