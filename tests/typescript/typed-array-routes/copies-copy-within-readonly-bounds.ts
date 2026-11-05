/*---
description: "CopyWithin snapshots overlapping source elements in either direction and normalizes negative or empty ranges through readonly start end and target tuples."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-unions, ts-null-undefined, ts-destructuring]
---*/

// CopyWithin snapshots overlapping source elements in either direction and normalizes negative or empty ranges; route: readonly start end and target tuples. Node prints copies-copy-within-readonly-bounds:ok.
type View = Uint8Array;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
const rows: readonly [number, number, number | undefined, readonly number[]][] = [
  [1, 0, 3, [11, 11, 22, 33, 55]], [0, 2, undefined, [33, 44, 55, 44, 55]],
  [-2, 0, 2, [11, 22, 33, 11, 22]], [0, 4, 2, [11, 22, 33, 44, 55]],
];
for (const [target, start, end, expected] of rows) {
  const source: View = new Uint8Array([11, 22, 33, 44, 55]), buffer = source.buffer;
  const result: View = source.copyWithin(target, start, end);
  assert.sameValue(result, source); assert.sameValue(result.buffer, buffer);
  assert.compareArray(elements(source), expected); assert.compareArray(elements(result), expected);
}
console.log("copies-copy-within-readonly-bounds:ok");
