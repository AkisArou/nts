/*---
description: "With accepts the last negative index and rejects indices on either side of a two-element array. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-interfaces, ts-class, ts-tuples, ts-errors, ts-arrow-functions]
---*/

function localInt8Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localUint8Array(values: readonly number[]): number[] { return localInt8Array(values); }
function localWith(data: number[], index: number, value: number): number[] { index = Math.trunc(index); if (index < 0) index += data.length; if (index < 0 || index >= data.length) throw new RangeError("index"); const result: number[] = []; for (let i = 0; i < data.length; i++) result[i] = i === index ? value : data[i]; return result; }
// With accepts the last negative index and rejects indices on either side of a two-element array. Route: one interface with signed and unsigned implementations.
// Node prints conversion-with-bounds-interface:ok.
type Bytes = number[];
interface ReplacementStore { replace(index: number, value: number): Bytes; }
class SignedStore implements ReplacementStore { replace(index: number, value: number): Bytes { return localWith(localInt8Array([-1, 2]), index, value); } }
class UnsignedStore implements ReplacementStore { replace(index: number, value: number): Bytes { return localWith(localUint8Array([255, 2]), index, value); } }
const stores: readonly [ReplacementStore, number][] = [[new SignedStore(), -1], [new UnsignedStore(), 255]];
for (const [store, first] of stores) {
  for (const [index, expected] of [[-1, [first, 9]], [-2, [9, 2]], [1.7, [first, 9]]] as const) {
    const result = store.replace(index, 9), actual: number[] = [];
    for (let i = 0; i < result.length; i++) actual[i] = result[i]; assert.compareArray(actual, expected);
  }
  for (const index of [2, -3]) assert.throws(RangeError, () => store.replace(index, 9));
}
console.log("conversion-with-bounds-interface:ok");
