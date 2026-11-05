/*---
description: "Slice retains each receiver kind and exact signed zero or NaN while allocating independent buffers through a constrained generic at two array type arguments."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-generics, ts-generic-constraints, ts-unions, ts-instanceof]
---*/

// Slice retains each receiver kind and exact signed zero or NaN while allocating independent buffers; route: a constrained generic at two array type arguments. Node prints copies-slice-kinds-constrained-generic:ok.
type Short = Int16Array;
type Wide = Float64Array;
type View = Short | Wide;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
function clone<T extends Short | Wide>(view: T): Short | Wide { return view.slice(0); }
const short: Short = new Int16Array([-32768, 7, 32767]), wide: Wide = new Float64Array([-0, NaN, Infinity]);
const first = clone<Short>(short), second = clone<Wide>(wide);
assert.sameValue(first instanceof Int16Array, true); assert.sameValue(second instanceof Float64Array, true);
assert.sameValue(first.buffer === short.buffer, false); assert.sameValue(second.buffer === wide.buffer, false);
assert.compareArray(elements(first), [-32768, 7, 32767]); assert.compareArray(elements(second), [-0, NaN, Infinity]);
first[1] = 99; second[0] = 1.5;
assert.compareArray(elements(first), [-32768, 99, 32767]); assert.compareArray(elements(second), [1.5, NaN, Infinity]);
assert.compareArray(elements(short), [-32768, 7, 32767]); assert.compareArray(elements(wide), [-0, NaN, Infinity]);
console.log("copies-slice-kinds-constrained-generic:ok");
