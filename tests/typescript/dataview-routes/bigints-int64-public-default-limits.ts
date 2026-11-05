/*---
description: "BigInt64 default byte order is big endian and signed-limit inputs wrap with exact bytes and signed results."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-class, ts-class-fields, ts-readonly, ts-tuples, ts-destructuring]
---*/

// BigInt64 default byte order is big endian and signed-limit inputs wrap with exact bytes and signed results. Route: a public View field. Node prints bigints-int64-public-default-limits:ok.
type View = DataView;
class WideSlot { view: View = new DataView(new ArrayBuffer(8)); }
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
  const slot = new WideSlot(); for (let i = 0; i < 8; i++) slot.view.setUint8(i, 165);
  slot.view.setBigInt64(0, value);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = slot.view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(slot.view.getBigInt64(0), expected);
}
console.log("bigints-int64-public-default-limits:ok");
