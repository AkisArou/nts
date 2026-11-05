/*---
description: "BigInt64 truncates captured fractional offsets at the first, middle and last fitting positions while writing exact big-endian bytes."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-closures, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring]
---*/

// BigInt64 truncates captured fractional offsets at the first, middle and last fitting positions while writing exact big-endian bytes. Route: reassigned offset and bigint lets captured by reader and writer closures. Node prints bigints-int64-captured-fractional-offsets:ok.
type View = DataView;
const view: View = new DataView(new ArrayBuffer(12)); let offset = 0, value = 0n;
const write: () => void = () => { view.setBigInt64(offset, value, false); };
const read: () => bigint = () => view.getBigInt64(offset, false);
const rows: readonly [number, bigint, readonly number[]][] = [
  [-0.9, 0x0123456789abcdefn, [1, 35, 69, 103, 137, 171, 205, 239, 0, 0, 0, 0]],
  [1.9, -0x8000000000000000n, [0, 128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  [4.9, -2n, [0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 254]]
];
for (const [nextOffset, nextValue, expectedBytes] of rows) {
  offset = nextOffset; value = nextValue; for (let i = 0; i < 12; i++) view.setUint8(i, 0);
  write(); const bytes: number[] = []; for (let i = 0; i < 12; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(read(), value);
}
console.log("bigints-int64-captured-fractional-offsets:ok");
