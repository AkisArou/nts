/*---
description: "Int8 sign-extends and Uint8 zero-extends the same independently seeded bytes without changing their contents."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-class, ts-interfaces, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Int8 sign-extends and Uint8 zero-extends the same independently seeded bytes without changing their contents. Route: an interface with signed and unsigned reader implementations. Node prints integers-int8-interface-seeded-signedness:ok.
type View = DataView;
interface ByteReader { read(view: View, offset: number): number; }
class SignedByte implements ByteReader { read(view: View, offset: number): number { return view.getInt8(offset); } }
class UnsignedByte implements ByteReader { read(view: View, offset: number): number { return view.getUint8(offset); } }
const seed: readonly number[] = [0, 1, 127, 128, 254, 255], view: View = new DataView(new ArrayBuffer(6));
for (let i = 0; i < seed.length; i++) view.setUint8(i, seed[i]);
const routes: readonly [ByteReader, readonly number[]][] = [
  [new SignedByte(), [0, 1, 127, -128, -2, -1]], [new UnsignedByte(), [0, 1, 127, 128, 254, 255]]
];
for (const [route, expected] of routes) {
  const actual: number[] = []; for (let i = 0; i < seed.length; i++) actual[i] = route.read(view, i);
  assert.compareArray(actual, expected);
}
const bytes: number[] = []; for (let i = 0; i < 6; i++) bytes[i] = view.getUint8(i);
assert.compareArray(bytes, [0, 1, 127, 128, 254, 255]);
console.log("integers-int8-interface-seeded-signedness:ok");
