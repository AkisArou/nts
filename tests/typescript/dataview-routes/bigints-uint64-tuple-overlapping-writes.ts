/*---
description: "Overlapping BigUint64 writes replace exactly eight bytes in each requested byte order and preserve all remaining bytes."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Overlapping BigUint64 writes replace exactly eight bytes in each requested byte order and preserve all remaining bytes. Route: readonly offset, bigint and byte-order tuples. Node prints bigints-uint64-tuple-overlapping-writes:ok.
type View = DataView;
const view: View = new DataView(new ArrayBuffer(16));
const rows: readonly [number, bigint, boolean, readonly number[]][] = [
  [0, 0x0123456789abcdefn, false, [1, 35, 69, 103, 137, 171, 205, 239, 0, 0, 0, 0, 0, 0, 0, 0]],
  [4, 0xfedcba9876543210n, true, [1, 35, 69, 103, 16, 50, 84, 118, 152, 186, 220, 254, 0, 0, 0, 0]],
  [8, 1n, false, [1, 35, 69, 103, 16, 50, 84, 118, 0, 0, 0, 0, 0, 0, 0, 1]]
];
for (const [offset, value, little, expectedBytes] of rows) {
  view.setBigUint64(offset, value, little);
  const bytes: number[] = []; for (let i = 0; i < 16; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(view.getBigUint64(offset, little), value);
}
console.log("bigints-uint64-tuple-overlapping-writes:ok");
