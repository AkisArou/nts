/*---
description: "BigUint64 default and explicit false operations produce the same independently specified big-endian bytes and exact unsigned results."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-class, ts-interfaces, ts-readonly, ts-tuples, ts-destructuring]
---*/

// BigUint64 default and explicit false operations produce the same independently specified big-endian bytes and exact unsigned results. Route: an interface with default-order and explicit-order implementations. Node prints bigints-uint64-interface-default-equivalence:ok.
type View = DataView;
interface WideAccess { write(view: View, value: bigint): void; read(view: View): bigint; }
class DefaultWide implements WideAccess {
  write(view: View, value: bigint): void { view.setBigUint64(0, value); }
  read(view: View): bigint { return view.getBigUint64(0); }
}
class ExplicitWide implements WideAccess {
  write(view: View, value: bigint): void { view.setBigUint64(0, value, false); }
  read(view: View): bigint { return view.getBigUint64(0, false); }
}
const routes: readonly WideAccess[] = [new DefaultWide(), new ExplicitWide()];
const rows: readonly [bigint, bigint, readonly number[]][] = [
  [0x123456789abcdefn, 0x123456789abcdefn, [1, 35, 69, 103, 137, 171, 205, 239]],
  [0x8000000000000001n, 0x8000000000000001n, [128, 0, 0, 0, 0, 0, 0, 1]],
  [-0x1n, 0xffffffffffffffffn, [255, 255, 255, 255, 255, 255, 255, 255]],
  [0x10000000000000000n, 0x0n, [0, 0, 0, 0, 0, 0, 0, 0]],
  [0x10000000000000001n, 0x1n, [0, 0, 0, 0, 0, 0, 0, 1]]
];
for (const route of routes) for (const [value, expected, expectedBytes] of rows) {
  const view: View = new DataView(new ArrayBuffer(8)); for (let i = 0; i < 8; i++) view.setUint8(i, 165); route.write(view, value);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(route.read(view), expected);
}
console.log("bigints-uint64-interface-default-equivalence:ok");
