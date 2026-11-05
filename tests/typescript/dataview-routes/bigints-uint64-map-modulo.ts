/*---
description: "BigUint64 reduces positive and negative multiples of sixty-four bits in little-endian storage and preserves all low bits."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-map-set, ts-strings, ts-narrowing, ts-errors, ts-readonly, ts-tuples, ts-destructuring]
---*/

// BigUint64 reduces positive and negative multiples of sixty-four bits in little-endian storage and preserves all low bits. Route: a View obtained through guarded Map.get. Node prints bigints-uint64-map-modulo:ok.
type View = DataView;
const views: Map<string, View> = new Map([["wide", new DataView(new ArrayBuffer(8))]]);
const rows: readonly [bigint, bigint, readonly number[]][] = [
  [-0x10000000000000001n, 0xffffffffffffffffn, [255, 255, 255, 255, 255, 255, 255, 255]],
  [-0x10000000000000000n, 0x0n, [0, 0, 0, 0, 0, 0, 0, 0]],
  [-0xffffffffffffffffn, 0x1n, [1, 0, 0, 0, 0, 0, 0, 0]],
  [0xffffffffffffffffn, 0xffffffffffffffffn, [255, 255, 255, 255, 255, 255, 255, 255]],
  [0x10000000000000000n, 0x0n, [0, 0, 0, 0, 0, 0, 0, 0]],
  [0x10000000000000001n, 0x1n, [1, 0, 0, 0, 0, 0, 0, 0]],
  [0x20000000000001234n, 0x1234n, [52, 18, 0, 0, 0, 0, 0, 0]],
  [-0x20000000000000002n, 0xfffffffffffffffen, [254, 255, 255, 255, 255, 255, 255, 255]]
];
for (const [value, expected, expectedBytes] of rows) {
  const view = views.get("wide"); if (view === undefined) throw new Error("missing view");
  for (let i = 0; i < 8; i++) view.setUint8(i, 165); view.setBigUint64(0, value, true);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(view.getBigUint64(0, true), expected);
}
console.log("bigints-uint64-map-modulo:ok");
