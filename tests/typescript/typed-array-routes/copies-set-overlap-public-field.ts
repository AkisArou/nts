/*---
description: "Set snapshots a same-kind source view before an overlapping write changes that shared source through a public byte-array field."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-class, ts-class-fields, ts-readonly, ts-tuples, ts-null-undefined, ts-destructuring]
---*/

// Set snapshots a same-kind source view before an overlapping write changes that shared source; route: a public byte-array field. Node prints copies-set-overlap-public-field:ok.
type View = Uint8Array;
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
class CopyBox { data: View; constructor(input: readonly number[]) { this.data = new Uint8Array(input); } }
const rows: readonly [readonly number[], readonly number[]][] = [
  [[1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 1, 2, 3, 4, 7, 8]],
  [[200, 7, 128, 9, 77, 88, 99, 111], [200, 7, 200, 7, 128, 9, 99, 111]],
];
for (const [input, expected] of rows) {
  const box: CopyBox = new CopyBox(input), source: View = box.data.subarray(0, 4), buffer = box.data.buffer;
  const result: void = box.data.set(source, 2);
  assert.sameValue(result, undefined); assert.sameValue(box.data.buffer, buffer); assert.sameValue(source.buffer, buffer);
  assert.compareArray(elements(box.data), expected);
  assert.compareArray(elements(source), [expected[0], expected[1], expected[2], expected[3]]);
}
console.log("copies-set-overlap-public-field:ok");
