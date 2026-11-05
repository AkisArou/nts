/*---
description: "Saved subarrays retain their old buffer while a closure reads the newly assigned parent through a replaced captured byte-array binding."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-closures, ts-arrow-functions]
---*/

// Saved subarrays retain their old buffer while a closure reads the newly assigned parent; route: a replaced captured byte-array binding. Node prints copies-subarray-captured-parent-replacement:ok.
type View = Uint8Array;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
let current: View = new Uint8Array([1, 2, 3, 4]);
const take = (): View => current.subarray(1, 3);
const saved: View = take(), original: View = current;
current = new Uint8Array([10, 20, 30, 40]);
const recent: View = take();
saved[0] = 91; recent[1] = 81;
assert.sameValue(saved.buffer, original.buffer); assert.sameValue(recent.buffer, current.buffer);
assert.sameValue(saved.buffer === recent.buffer, false);
assert.compareArray(elements(original), [1, 91, 3, 4]); assert.compareArray(elements(current), [10, 20, 81, 40]);
assert.compareArray(elements(saved), [91, 3]); assert.compareArray(elements(recent), [20, 81]);
console.log("copies-subarray-captured-parent-replacement:ok");
