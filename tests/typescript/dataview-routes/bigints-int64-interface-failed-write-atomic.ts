/*---
description: "A failed BigInt64 write changes no bytes in either byte order, while a valid write changes exactly the final fitting word."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-class, ts-interfaces, ts-readonly, ts-tuples, ts-destructuring, ts-errors, ts-arrow-functions]
---*/

// A failed BigInt64 write changes no bytes in either byte order, while a valid write changes exactly the final fitting word. Route: an interface with big-endian and little-endian writer implementations. Node prints bigints-int64-interface-failed-write-atomic:ok.
type View = DataView;
interface WideWriter { write(view: View, offset: number, value: bigint): void; }
class BigWide implements WideWriter { write(view: View, offset: number, value: bigint): void { view.setBigInt64(offset, value, false); } }
class LittleWide implements WideWriter { write(view: View, offset: number, value: bigint): void { view.setBigInt64(offset, value, true); } }
const routes: readonly [WideWriter, readonly number[]][] = [
  [new BigWide(), [1, 2, 3, 4, 1, 35, 69, 103, 137, 171, 205, 239]],
  [new LittleWide(), [1, 2, 3, 4, 239, 205, 171, 137, 103, 69, 35, 1]]
];
const seed: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
for (const [route, expected] of routes) {
  const view: View = new DataView(new ArrayBuffer(12)); for (let i = 0; i < 12; i++) view.setUint8(i, seed[i]);
  for (const offset of [-1, 5, 12]) {
    assert.throws(RangeError, () => route.write(view, offset, 0x0123456789abcdefn));
    const bytes: number[] = []; for (let i = 0; i < 12; i++) bytes[i] = view.getUint8(i); assert.compareArray(bytes, seed);
  }
  route.write(view, 4, 0x0123456789abcdefn);
  const finalBytes: number[] = []; for (let j = 0; j < 12; j++) finalBytes[j] = view.getUint8(j); assert.compareArray(finalBytes, expected);
}
console.log("bigints-int64-interface-failed-write-atomic:ok");
