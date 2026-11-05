/*---
description: "ToReversed preserves clamped or floating receiver kind and exact special values across dispatch through an interface with two array-backed implementations."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-interfaces, ts-class, ts-class-fields, ts-unions, ts-readonly, ts-tuples, ts-instanceof, ts-destructuring]
---*/

// ToReversed preserves clamped or floating receiver kind and exact special values across dispatch; route: an interface with two array-backed implementations. Node prints copies-to-reversed-interface-kinds:ok.
type Bytes = Uint8ClampedArray;
type Wide = Float64Array;
type View = Bytes | Wide;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
interface CopyStore { data: View; copy(): View; }
class ByteStore implements CopyStore { data: Bytes = new Uint8ClampedArray([0, 255, 7]); copy(): View { return this.data.toReversed(); } }
class WideStore implements CopyStore { data: Wide = new Float64Array([-0, NaN, 1.5]); copy(): View { return this.data.toReversed(); } }
const rows: readonly [CopyStore, boolean, readonly number[], readonly number[]][] = [
  [new ByteStore(), true, [0, 255, 7], [7, 255, 0]], [new WideStore(), false, [-0, NaN, 1.5], [1.5, NaN, -0]],
];
for (const [store, bytes, input, expected] of rows) {
  const result: View = store.copy();
  assert.sameValue(result instanceof Uint8ClampedArray, bytes); assert.sameValue(result instanceof Float64Array, !bytes);
  assert.sameValue(result.buffer === store.data.buffer, false); assert.sameValue(result === store.data, false);
  assert.compareArray(elements(result), expected); assert.compareArray(elements(store.data), input);
}
console.log("copies-to-reversed-interface-kinds:ok");
