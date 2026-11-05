/*---
description: "BigUint64 keeps exact low sixty-four bits of changing very wide positive and negative values in little-endian storage."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-closures, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring]
---*/

// BigUint64 keeps exact low sixty-four bits of changing very wide positive and negative values in little-endian storage. Route: a bigint let captured by typed writer and reader closures. Node prints bigints-uint64-captured-wide-modulo:ok.
type View = DataView;
const view: View = new DataView(new ArrayBuffer(8)); let value = 0n;
const write: () => void = () => { view.setBigUint64(0, value, true); };
const read: () => bigint = () => view.getBigUint64(0, true);
const rows: readonly [bigint, bigint, readonly number[]][] = [
  [0x400000000000000000123456789abcdefn, 0x123456789abcdefn, [239, 205, 171, 137, 103, 69, 35, 1]],
  [-0x400000000000000000123456789abcdefn, 0xfedcba9876543211n, [17, 50, 84, 118, 152, 186, 220, 254]],
  [0x400000000000000008000000000000001n, 0x8000000000000001n, [1, 0, 0, 0, 0, 0, 0, 128]],
  [-0x400000000000000000000000000000000n, 0x0n, [0, 0, 0, 0, 0, 0, 0, 0]],
  [-0x400000000000000000000000000000001n, 0xffffffffffffffffn, [255, 255, 255, 255, 255, 255, 255, 255]]
];
for (const [next, expected, expectedBytes] of rows) {
  value = next; for (let i = 0; i < 8; i++) view.setUint8(i, 165); write();
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(read(), expected);
}
console.log("bigints-uint64-captured-wide-modulo:ok");
