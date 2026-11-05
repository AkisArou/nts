/*---
description: "With accepts the last negative index and rejects indices on either side of a two-element array."
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-interfaces, ts-class, ts-tuples, ts-errors, ts-arrow-functions]
---*/

// With accepts the last negative index and rejects indices on either side of a two-element array. Route: one interface with signed and unsigned implementations.
// Node prints conversion-with-bounds-interface:ok.
type Bytes = Int8Array | Uint8Array;
interface ReplacementStore { replace(index: number, value: number): Bytes; }
class SignedStore implements ReplacementStore { replace(index: number, value: number): Bytes { return new Int8Array([-1, 2]).with(index, value); } }
class UnsignedStore implements ReplacementStore { replace(index: number, value: number): Bytes { return new Uint8Array([255, 2]).with(index, value); } }
const stores: readonly [ReplacementStore, number][] = [[new SignedStore(), -1], [new UnsignedStore(), 255]];
for (const [store, first] of stores) {
  for (const [index, expected] of [[-1, [first, 9]], [-2, [9, 2]], [1.7, [first, 9]]] as const) {
    const result = store.replace(index, 9), actual: number[] = [];
    for (let i = 0; i < result.length; i++) actual[i] = result[i]; assert.compareArray(actual, expected);
  }
  for (const index of [2, -3]) assert.throws(RangeError, () => store.replace(index, 9));
}
console.log("conversion-with-bounds-interface:ok");
