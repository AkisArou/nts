/*---
description: "ToReversed returns the same element kind over a fresh buffer and leaves the source independent through a public byte-array field."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-class, ts-class-fields, ts-readonly, ts-tuples, ts-instanceof, ts-destructuring]
---*/

// ToReversed returns the same element kind over a fresh buffer and leaves the source independent; route: a public byte-array field. Node prints copies-to-reversed-public-field:ok.
type View = Uint8Array;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
class CopyBox { data: View; constructor(input: readonly number[]) { this.data = new Uint8Array(input); } }
const rows: readonly [readonly number[], readonly number[]][] = [[[1, 9, 3, 7], [7, 3, 9, 1]], [[255, 0, 8, 128], [128, 8, 0, 255]]];
for (const [input, expected] of rows) {
  const box: CopyBox = new CopyBox(input), result: View = box.data.toReversed();
  assert.sameValue(result instanceof Uint8Array, true); assert.sameValue(result.buffer === box.data.buffer, false);
  assert.compareArray(elements(result), expected); assert.compareArray(elements(box.data), input);
  result[0] = 44; box.data[0] = 55;
  assert.compareArray(elements(result), [44, expected[1], expected[2], expected[3]]);
  assert.compareArray(elements(box.data), [55, input[1], input[2], input[3]]);
}
console.log("copies-to-reversed-public-field:ok");
