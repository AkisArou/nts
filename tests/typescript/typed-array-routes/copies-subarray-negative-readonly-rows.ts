/*---
description: "Negative and clipped subarray bounds retain exact offsets including empty reversed ranges through readonly bound and expected-value tuples."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-unions, ts-null-undefined, ts-destructuring]
---*/

// Negative and clipped subarray bounds retain exact offsets including empty reversed ranges; route: readonly bound and expected-value tuples. Node prints copies-subarray-negative-readonly-rows:ok.
type View = Uint8Array;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
const source: View = new Uint8Array([11, 22, 33, 44, 55]);
const rows: readonly [number, number | undefined, number, readonly number[]][] = [
  [-2, undefined, 3, [44, 55]], [-4, -1, 1, [22, 33, 44]], [3, 1, 3, []],
  [-20, 20, 0, [11, 22, 33, 44, 55]], [5, undefined, 5, []],
];
for (const [start, end, offset, expected] of rows) {
  const part: View = source.subarray(start, end);
  assert.sameValue(part.buffer, source.buffer); assert.sameValue(part.byteOffset, offset);
  assert.sameValue(part.length, expected.length); assert.compareArray(elements(part), expected);
  assert.compareArray(elements(source), [11, 22, 33, 44, 55]);
}
console.log("copies-subarray-negative-readonly-rows:ok");
