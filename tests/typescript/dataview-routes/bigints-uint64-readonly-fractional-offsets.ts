/*---
description: "BigUint64 truncates fractional offsets before little-endian access and preserves bytes outside the selected eight-byte word."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-readonly, ts-tuples, ts-destructuring]
---*/

// BigUint64 truncates fractional offsets before little-endian access and preserves bytes outside the selected eight-byte word. Route: readonly offset and bigint tuples. Node prints bigints-uint64-readonly-fractional-offsets:ok.
type View = DataView;
const rows: readonly [number, bigint, readonly number[]][] = [
  [-0.9, 0x0123456789abcdefn, [239, 205, 171, 137, 103, 69, 35, 1, 0, 0, 0, 0]],
  [1.9, 0x8000000000000001n, [0, 1, 0, 0, 0, 0, 0, 0, 128, 0, 0, 0]],
  [4.9, 0xfffffffffffffffen, [0, 0, 0, 0, 254, 255, 255, 255, 255, 255, 255, 255]]
];
for (const [offset, value, expectedBytes] of rows) {
  const view: View = new DataView(new ArrayBuffer(12)); view.setBigUint64(offset, value, true);
  const bytes: number[] = []; for (let i = 0; i < 12; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(view.getBigUint64(offset, true), value);
}
console.log("bigints-uint64-readonly-fractional-offsets:ok");
