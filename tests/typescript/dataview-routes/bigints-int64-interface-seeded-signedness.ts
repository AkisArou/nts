/*---
description: "The top bit distinguishes default BigInt64 and BigUint64 reads of independently seeded bytes while every byte stays unchanged."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-class, ts-interfaces, ts-readonly, ts-tuples, ts-destructuring]
---*/

// The top bit distinguishes default BigInt64 and BigUint64 reads of independently seeded bytes while every byte stays unchanged. Route: an interface with signed and unsigned reader implementations. Node prints bigints-int64-interface-seeded-signedness:ok.
type View = DataView;
interface WideReader { read(view: View): bigint; }
class SignedWide implements WideReader { read(view: View): bigint { return view.getBigInt64(0); } }
class UnsignedWide implements WideReader { read(view: View): bigint { return view.getBigUint64(0); } }
const routes: readonly WideReader[] = [new SignedWide(), new UnsignedWide()];
const rows: readonly [readonly number[], readonly bigint[]][] = [
  [[0, 0, 0, 0, 0, 0, 0, 0], [0x0n, 0x0n]],
  [[0, 0, 0, 0, 0, 0, 0, 1], [0x1n, 0x1n]],
  [[127, 255, 255, 255, 255, 255, 255, 255], [0x7fffffffffffffffn, 0x7fffffffffffffffn]],
  [[128, 0, 0, 0, 0, 0, 0, 0], [-0x8000000000000000n, 0x8000000000000000n]],
  [[128, 0, 0, 0, 0, 0, 0, 1], [-0x7fffffffffffffffn, 0x8000000000000001n]],
  [[255, 255, 255, 255, 255, 255, 255, 255], [-0x1n, 0xffffffffffffffffn]]
];
for (const [seed, expected] of rows) {
  const view: View = new DataView(new ArrayBuffer(8)); for (let i = 0; i < 8; i++) view.setUint8(i, seed[i]);
  const actual: bigint[] = []; for (let i = 0; i < routes.length; i++) actual[i] = routes[i].read(view);
  assert.compareArray(actual, expected);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = view.getUint8(i); assert.compareArray(bytes, seed);
}
console.log("bigints-int64-interface-seeded-signedness:ok");
