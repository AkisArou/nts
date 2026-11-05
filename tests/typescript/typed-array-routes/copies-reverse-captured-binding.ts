/*---
description: "Reverse changes the selected array in place and returns the same object for empty single odd and even lengths through a reassigned captured byte-array binding."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-closures, ts-readonly, ts-tuples, ts-destructuring, ts-arrow-functions]
---*/

// Reverse changes the selected array in place and returns the same object for empty single odd and even lengths; route: a reassigned captured byte-array binding. Node prints copies-reverse-captured-binding:ok.
type View = Uint8Array;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
let current: View = new Uint8Array([]);
const flip = (): View => current.reverse();
const rows: readonly [readonly number[], readonly number[]][] = [
  [[], []], [[255], [255]], [[1, 9, 3, 7], [7, 3, 9, 1]], [[0, 128, 255], [255, 128, 0]],
];
for (const [input, expected] of rows) {
  current = new Uint8Array(input);
  const original: View = current, buffer = current.buffer, result: View = flip();
  assert.sameValue(result, original); assert.sameValue(result.buffer, buffer);
  assert.compareArray(elements(current), expected); assert.compareArray(elements(result), expected);
}
console.log("copies-reverse-captured-binding:ok");
