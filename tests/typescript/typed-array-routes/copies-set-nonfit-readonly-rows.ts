/*---
description: "Set rejects negative or nonfitting destinations before any write while accepting exact-end and empty sources through readonly source and destination tuples."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-null-undefined, ts-destructuring, ts-arrow-functions, ts-errors]
---*/

// Set rejects negative or nonfitting destinations before any write while accepting exact-end and empty sources; route: readonly source and destination tuples. Node prints copies-set-nonfit-readonly-rows:ok.
type View = Uint8Array;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
const target: View = new Uint8Array([13, 27]);
const rows: readonly [readonly number[], number][] = [[[1, 2, 3], 0], [[9], 2], [[7, 8], 1], [[9], -1]];
for (const [source, offset] of rows) {
  assert.throws(RangeError, () => target.set(source, offset));
  assert.compareArray(elements(target), [13, 27]);
}
const tooLong: View = new Uint8Array([1, 2, 3]);
assert.throws(RangeError, () => target.set(tooLong, 0));
assert.compareArray(elements(target), [13, 27]); assert.compareArray(elements(tooLong), [1, 2, 3]);
assert.sameValue(target.set([99], 1), undefined); assert.compareArray(elements(target), [13, 99]);
assert.sameValue(target.set([], 2), undefined); assert.compareArray(elements(target), [13, 99]);
console.log("copies-set-nonfit-readonly-rows:ok");
